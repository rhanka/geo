/**
 * CLI wrapper for local-only raster image-registration GCP derivation.
 *
 * Unlike t2-autogcp, this wrapper intentionally has no S3 fallback. The caller
 * must provide a local PDF and local cadastre GeoJSON so failed reports never
 * hide a network dependency.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { FeatureCollection } from "geojson";

import { deriveRasterRegistration, type RasterRegisterReport } from "./lib/t2-raster-register.js";
import type { GcpFile } from "./lib/t2-georef.js";

interface Args {
  slug: string;
  gcp: string;
  cadastre: string;
  pdf?: string;
  outGcp?: string;
  report?: string;
  dpi: number;
  maxCandidateM: number;
  maxResidualM: number;
  minGcps: number;
  maxGcps: number;
  maxPlanCorners: number;
  minPatchScore: number;
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
  if (!a["slug"] || !a["gcp"] || !a["cadastre"]) {
    throw new Error("required: --slug <slug> --gcp <seed.gcp.json> --cadastre <local-cadastre.geojson>");
  }
  return {
    slug: String(a["slug"]),
    gcp: String(a["gcp"]),
    cadastre: String(a["cadastre"]),
    pdf: a["pdf"] ? String(a["pdf"]) : undefined,
    outGcp: a["out-gcp"] ? String(a["out-gcp"]) : undefined,
    report: a["report"] ? String(a["report"]) : undefined,
    dpi: a["dpi"] ? Number(a["dpi"]) : 72,
    maxCandidateM: a["max-candidate-m"] ? Number(a["max-candidate-m"]) : 18,
    maxResidualM: a["max-residual-m"] ? Number(a["max-residual-m"]) : 30,
    minGcps: a["min-gcps"] ? Number(a["min-gcps"]) : 12,
    maxGcps: a["max-gcps"] ? Number(a["max-gcps"]) : 48,
    maxPlanCorners: a["max-plan-corners"] ? Number(a["max-plan-corners"]) : 4000,
    minPatchScore: a["min-patch-score"] ? Number(a["min-patch-score"]) : 0.18,
  };
}

function failureReport(slug: string, reason: string, args: Args): RasterRegisterReport {
  return {
    slug,
    method: "cadastre-raster-corner-image-registration",
    pass: false,
    reason,
    dpi: args.dpi,
    plan_raster_corners: 0,
    reference_raster_corners: 0,
    cadastre_vertices: 0,
    seed_candidate_matches: 0,
    patch_verified_matches: 0,
    selected_gcps: 0,
    residual_max_m: null,
    residual_rms_m: null,
    holdout_max_m: null,
    holdout_rms_m: null,
    max_candidate_distance_m: args.maxCandidateM,
    min_patch_score: args.minPatchScore,
    max_residual_gate_m: args.maxResidualM,
  };
}

function writeReport(path: string | undefined, report: RasterRegisterReport): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...report, gcp_file: undefined }, null, 2));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.gcp)) {
    const r = failureReport(args.slug, `local seed GCP file not found: ${args.gcp}`, args);
    writeReport(args.report, r);
    console.log(JSON.stringify(r, null, 2));
    process.exit(2);
  }
  const seed = JSON.parse(readFileSync(args.gcp, "utf8")) as GcpFile;
  const pdfPath = args.pdf ?? seed.pdf;
  if (!pdfPath || /^https?:/i.test(pdfPath) || !existsSync(pdfPath)) {
    const r = failureReport(args.slug, `local PDF not staged: ${pdfPath || "(none)"}`, args);
    writeReport(args.report, r);
    console.log(JSON.stringify(r, null, 2));
    process.exit(2);
  }
  const page = seed.page ?? 1;
  const pageW = seed.pageW;
  const pageH = seed.pageH;
  if (!(pageW && pageH)) {
    const r = failureReport(args.slug, "seed GCP file lacks pageW/pageH; provide a measured seed file", args);
    writeReport(args.report, r);
    console.log(JSON.stringify(r, null, 2));
    process.exit(2);
  }
  if (seed.gcps.length < 3) {
    const r = failureReport(args.slug, `seed GCP file has ${seed.gcps.length} controls; need >=3 coarse controls before raster matching`, args);
    writeReport(args.report, r);
    console.log(JSON.stringify(r, null, 2));
    process.exit(2);
  }
  if (!existsSync(args.cadastre)) {
    const r = failureReport(args.slug, `local cadastre GeoJSON not staged: ${args.cadastre}`, args);
    writeReport(args.report, r);
    console.log(JSON.stringify(r, null, 2));
    process.exit(2);
  }
  const cadastre = JSON.parse(readFileSync(args.cadastre, "utf8")) as FeatureCollection;
  const report = await deriveRasterRegistration({
    slug: args.slug,
    pdfPath,
    page,
    pageW,
    pageH,
    seed,
    cadastre,
    dpi: args.dpi,
    maxCandidateDistanceM: args.maxCandidateM,
    maxResidualM: args.maxResidualM,
    minGcps: args.minGcps,
    maxGcps: args.maxGcps,
    maxPlanCorners: args.maxPlanCorners,
    minPatchScore: args.minPatchScore,
  });
  if (args.outGcp && report.gcp_file) {
    mkdirSync(dirname(args.outGcp), { recursive: true });
    writeFileSync(args.outGcp, JSON.stringify(report.gcp_file, null, 2));
  }
  writeReport(args.report, report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
