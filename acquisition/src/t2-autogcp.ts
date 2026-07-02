/**
 * CLI wrapper for autonomous T2 GCP derivation.
 *
 * Produces a real-GCP file only when independent cadastre parcel/linework
 * matches pass the residual gate. A failed run is still useful evidence: it
 * reports coordinate-tick attempts and the numeric reject reason.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { FeatureCollection } from "geojson";

import { getBytes, s3Client } from "./lib/s3.js";
import { deriveAutoSeedGcps, deriveAutonomousGcps } from "./lib/t2-autogcp.js";
import type { GcpFile } from "./lib/t2-georef.js";

interface Args {
  slug: string;
  gcp?: string;
  autoSeed: boolean;
  pdf?: string;
  page?: number;
  cadastre?: string;
  outGcp?: string;
  report?: string;
  maxCandidateM?: number;
  maxResidualM: number;
  minGcps: number;
  maxGcps: number;
}

function parseArgs(argv: string[]): Args {
  const a: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) a[key] = true;
      else {
        a[key] = next;
        i++;
      }
    }
  }
  const autoSeed = Boolean(a["auto-seed"]);
  if (!a["slug"]) throw new Error("required: --slug <slug>");
  if (autoSeed) {
    if (!a["pdf"]) throw new Error("--auto-seed requires --pdf <local pdf path>");
  } else if (!a["gcp"]) {
    throw new Error("required: --slug <slug> --gcp <seed.gcp.json> (or --auto-seed --pdf <path>)");
  }
  return {
    slug: String(a["slug"]),
    gcp: a["gcp"] ? String(a["gcp"]) : undefined,
    autoSeed,
    pdf: a["pdf"] ? String(a["pdf"]) : undefined,
    page: a["page"] ? Number(a["page"]) : undefined,
    cadastre: a["cadastre"] ? String(a["cadastre"]) : undefined,
    outGcp: a["out-gcp"] ? String(a["out-gcp"]) : undefined,
    report: a["report"] ? String(a["report"]) : undefined,
    maxCandidateM: a["max-candidate-m"] ? Number(a["max-candidate-m"]) : undefined,
    maxResidualM: a["max-residual-m"] ? Number(a["max-residual-m"]) : 30,
    minGcps: a["min-gcps"] ? Number(a["min-gcps"]) : 12,
    maxGcps: a["max-gcps"] ? Number(a["max-gcps"]) : 48,
  };
}

async function readCadastre(slug: string, path?: string): Promise<FeatureCollection> {
  if (path && existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as FeatureCollection;
  const s3 = s3Client();
  const key = path ?? `normalized/qc-cadastre-lots/${slug}.geojson`;
  return JSON.parse((await getBytes(s3, key)).toString("utf8")) as FeatureCollection;
}

function pdfPageSize(pdfPath: string, page = 1): { pageW: number; pageH: number } {
  const info = execSync(`pdfinfo -f ${page} -l ${page} ${JSON.stringify(pdfPath)}`, { encoding: "utf8" });
  const escaped = String(page).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pm =
    info.match(new RegExp(`Page\\s+${escaped}\\s+size:\\s*([\\d.]+)\\s*x\\s*([\\d.]+)`)) ??
    info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
  if (!pm) throw new Error("pdfinfo: could not read page size");
  return { pageW: Number(pm[1]), pageH: Number(pm[2]) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.autoSeed) {
    const pdfPath = args.pdf!;
    if (!existsSync(pdfPath)) throw new Error(`--auto-seed PDF must be a local cached path: ${pdfPath}`);
    const page = args.page ?? 1;
    const size = pdfPageSize(pdfPath, page);
    const cadastre = await readCadastre(args.slug, args.cadastre);
    const report = await deriveAutoSeedGcps({
      slug: args.slug,
      pdfPath,
      page,
      pageW: size.pageW,
      pageH: size.pageH,
      cadastre,
      maxCandidateDistanceM: args.maxCandidateM ?? 450,
      maxResidualM: args.maxResidualM,
      minGcps: args.minGcps,
      maxGcps: args.maxGcps,
    });
    if (args.outGcp && report.gcp_file) {
      mkdirSync(dirname(args.outGcp), { recursive: true });
      writeFileSync(args.outGcp, JSON.stringify(report.gcp_file, null, 2));
    }
    if (args.report) {
      mkdirSync(dirname(args.report), { recursive: true });
      writeFileSync(args.report, JSON.stringify({ ...report, gcp_file: undefined }, null, 2));
    }
    console.log(JSON.stringify(report, null, 2));
    if (!report.pass) process.exitCode = 2;
    return;
  }

  const seed = JSON.parse(readFileSync(args.gcp!, "utf8")) as GcpFile;
  const page = seed.page ?? 1;
  const pdfPath = seed.pdf;
  if (!pdfPath || !existsSync(pdfPath)) throw new Error(`seed PDF must be a local cached path for autonomous matching: ${pdfPath}`);
  const size = seed.pageW && seed.pageH ? { pageW: seed.pageW, pageH: seed.pageH } : pdfPageSize(pdfPath, page);
  const cadastre = await readCadastre(args.slug, args.cadastre);
  const report = await deriveAutonomousGcps({
    slug: args.slug,
    pdfPath,
    page,
    pageW: size.pageW,
    pageH: size.pageH,
    seed,
    cadastre,
    maxCandidateDistanceM: args.maxCandidateM ?? 12,
    maxResidualM: args.maxResidualM,
    minGcps: args.minGcps,
    maxGcps: args.maxGcps,
  });
  if (args.outGcp && report.gcp_file) {
    mkdirSync(dirname(args.outGcp), { recursive: true });
    writeFileSync(args.outGcp, JSON.stringify(report.gcp_file, null, 2));
  }
  if (args.report) {
    mkdirSync(dirname(args.report), { recursive: true });
    writeFileSync(args.report, JSON.stringify({ ...report, gcp_file: undefined }, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
