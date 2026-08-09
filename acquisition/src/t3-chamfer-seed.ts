/**
 * CLI: derive a COARSE seed registration for a RASTER zoning plan, by matching
 * the real cadastre against the linework the plan itself prints.
 *
 * This fills the hole between T2 and T3. `t2-autogcp --auto-seed` cannot seed a
 * pasted-image plan (`svg_points = 0` — no vector corners to pair), and
 * `t2-raster-register` REFINES a seed rather than creating one (its default
 * search radius is 18 m). Neither can start. This produces the prior T3 needs.
 *
 * The emitted GCP file is a SEED, never a calibration: every control is
 * `independent: false` / `cadastre-chamfer-seed`, so the independence gate
 * refuses to count it as evidence. The proof remains downstream — T3 must
 * re-derive independent, patch-verified controls under residual + holdout
 * gates, and lot-coverage arbitrates the serve (spec section 8).
 *
 * A sheet often carries an INSET map at another scale: pass --neatline to bound
 * the search to the main frame, or the fit may lock onto the inset.
 *
 * $0: poppler + pure TS. No model, no OCR, no paid call.
 *
 * Usage:
 *   npx tsx acquisition/src/t3-chamfer-seed.ts --slug <slug> --pdf <local.pdf> --page 110 \
 *     --neatline 0.06,0.07,0.68,0.56 --out-gcp work/gcp/<slug>-seed.gcp.json \
 *     --report work/gcp/<slug>-chamfer.report.json [--dump-cadastre work/cadastre/<slug>.geojson]
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { FeatureCollection } from "geojson";

import { getBytes, s3Client } from "./lib/s3.js";
import { deriveChamferSeed } from "./lib/t3-chamfer-seed.js";
import type { NeatlineFrac } from "./lib/t2-georef.js";

interface Args {
  slug: string;
  pdf: string;
  page: number;
  cadastre?: string;
  dumpCadastre?: string;
  neatline?: NeatlineFrac;
  outGcp?: string;
  report?: string;
  dpi: number;
  rotationsDeg: number[];
  minScaleRatio: number;
  maxScaleRatio: number;
  modelPoints: number;
  truncM: number;
  inlierM: number;
  seedGcps: number;
}

function parseNeatline(raw: string): NeatlineFrac {
  const f = raw.split(",").map(Number);
  if (f.length !== 4 || !f.every((n) => Number.isFinite(n))) {
    throw new Error("--neatline must be fx0,fy0,fx1,fy1 (page fractions)");
  }
  for (const n of f) if (n < 0 || n > 1) throw new Error(`--neatline fractions must be within [0,1], got ${raw}`);
  return { fx0: f[0]!, fy0: f[1]!, fx1: f[2]!, fy1: f[3]! };
}

function parseArgs(argv: string[]): Args {
  const a: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (!t.startsWith("--")) continue;
    const key = t.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) a[key] = true;
    else {
      a[key] = next;
      i++;
    }
  }
  if (!a["slug"] || !a["pdf"]) throw new Error("required: --slug <slug> --pdf <local pdf path>");
  const pdf = String(a["pdf"]);
  if (/^https?:/i.test(pdf) || !existsSync(pdf)) {
    throw new Error(`--pdf must be a local cached path (stage it first): ${pdf}`);
  }
  return {
    slug: String(a["slug"]),
    pdf,
    page: a["page"] ? Number(a["page"]) : 1,
    cadastre: a["cadastre"] ? String(a["cadastre"]) : undefined,
    dumpCadastre: a["dump-cadastre"] ? String(a["dump-cadastre"]) : undefined,
    neatline: a["neatline"] ? parseNeatline(String(a["neatline"])) : undefined,
    outGcp: a["out-gcp"] ? String(a["out-gcp"]) : undefined,
    report: a["report"] ? String(a["report"]) : undefined,
    dpi: a["dpi"] ? Number(a["dpi"]) : 150,
    rotationsDeg: a["rotations"]
      ? String(a["rotations"])
          .split(",")
          .map((s) => Number(s.trim()))
      : [0],
    minScaleRatio: a["min-scale-ratio"] ? Number(a["min-scale-ratio"]) : 0.3,
    maxScaleRatio: a["max-scale-ratio"] ? Number(a["max-scale-ratio"]) : 1.2,
    modelPoints: a["model-points"] ? Number(a["model-points"]) : 2500,
    truncM: a["trunc-m"] ? Number(a["trunc-m"]) : 300,
    inlierM: a["inlier-m"] ? Number(a["inlier-m"]) : 25,
    seedGcps: a["seed-gcps"] ? Number(a["seed-gcps"]) : 12,
  };
}

async function readCadastre(slug: string, path?: string): Promise<FeatureCollection> {
  if (path && existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as FeatureCollection;
  const s3 = s3Client();
  const key = path ?? `normalized/qc-cadastre-lots/${slug}.geojson`;
  return JSON.parse((await getBytes(s3, key)).toString("utf8")) as FeatureCollection;
}

function pdfPageSize(pdfPath: string, page: number): { pageW: number; pageH: number } {
  const info = execSync(`pdfinfo -f ${page} -l ${page} ${JSON.stringify(pdfPath)}`, { encoding: "utf8" });
  const escaped = String(page).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m =
    info.match(new RegExp(`Page\\s+${escaped}\\s+size:\\s*([\\d.]+)\\s*x\\s*([\\d.]+)`)) ??
    info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
  if (!m) throw new Error("pdfinfo: could not read page size");
  return { pageW: Number(m[1]), pageH: Number(m[2]) };
}

function writeJson(path: string | undefined, value: unknown): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const size = pdfPageSize(args.pdf, args.page);
  const cadastre = await readCadastre(args.slug, args.cadastre);
  if (args.dumpCadastre) {
    // t2-raster-register is deliberately local-only; hand it the same bytes we
    // matched against, so the refine step cannot drift onto another vintage.
    writeJson(args.dumpCadastre, cadastre);
    console.error(`[t3-chamfer-seed] cadastre staged locally: ${args.dumpCadastre} (${cadastre.features.length} features)`);
  }
  if (!args.neatline) {
    console.error(
      "[t3-chamfer-seed] WARNING: no --neatline. A sheet with an INSET map at another scale can lock the fit onto the inset.",
    );
  }

  const report = await deriveChamferSeed({
    slug: args.slug,
    pdfPath: args.pdf,
    page: args.page,
    pageW: size.pageW,
    pageH: size.pageH,
    cadastre,
    dpi: args.dpi,
    ...(args.neatline ? { neatline: args.neatline } : {}),
    rotationsDeg: args.rotationsDeg,
    minScaleRatio: args.minScaleRatio,
    maxScaleRatio: args.maxScaleRatio,
    modelPoints: args.modelPoints,
    truncM: args.truncM,
    inlierM: args.inlierM,
    seedGcps: args.seedGcps,
  });

  if (args.outGcp && report.gcp_file) writeJson(args.outGcp, report.gcp_file);
  writeJson(args.report, { ...report, gcp_file: undefined });
  console.log(JSON.stringify({ ...report, gcp_file: undefined }, null, 2));
  if (!report.pass) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
