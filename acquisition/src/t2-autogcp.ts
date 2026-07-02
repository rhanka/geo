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
import { deriveAutoSeedGcps, deriveAutonomousGcps, type FitMode } from "./lib/t2-autogcp.js";
import { decideRotation, measureRotationLotAssignment, type MeasuredRotation } from "./lib/t2-rotation-disambig.js";
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
  /** Page→ground model fitted & gated: "affine" (default) or "similarity". */
  fit: FitMode;
  /** When "lots", resolve an orientation-ambiguity reject via cadastre lot-assignment. */
  rotationDisambig?: string;
  /** Tight cutoff (m) for the discrimination coverage (the orientation signal). Default 300. */
  disambigCutoffM: number;
  disambigCoverageFloor: number;
  disambigMarginPct: number;
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
  if (a["fit"] !== undefined && a["fit"] !== "affine" && a["fit"] !== "similarity") {
    throw new Error(`--fit must be "affine" or "similarity", got "${String(a["fit"])}"`);
  }
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
    fit: a["fit"] === "similarity" ? "similarity" : "affine",
    rotationDisambig: a["rotation-disambig"] ? String(a["rotation-disambig"]) : undefined,
    disambigCutoffM: a["disambig-cutoff-m"] ? Number(a["disambig-cutoff-m"]) : 300,
    disambigCoverageFloor: a["disambig-coverage-floor"] ? Number(a["disambig-coverage-floor"]) : 70,
    disambigMarginPct: a["disambig-margin-pct"] ? Number(a["disambig-margin-pct"]) : 15,
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
      fit: args.fit,
    });

    // Winning GCP file (either the direct auto-seed winner, or the rotation the
    // lot-assignment disambiguator decisively selects on an orientation-only reject).
    let winnerGcp: GcpFile | undefined = report.gcp_file;
    let disambiguation: unknown;

    if (
      !report.pass &&
      args.rotationDisambig === "lots" &&
      report.orientation_candidates &&
      report.orientation_candidates.length >= 2
    ) {
      console.error(
        `[t2-autogcp] orientation-only reject → lot-assignment disambiguation over ` +
          `${report.orientation_candidates.length} candidate orientation(s)`,
      );
      const measured: MeasuredRotation[] = [];
      for (const cand of report.orientation_candidates) {
        const m = measureRotationLotAssignment(cand, {
          pdfPath,
          page,
          pageW: size.pageW,
          pageH: size.pageH,
          cadastre,
          discriminationCutoffM: args.disambigCutoffM,
        });
        console.error(
          `[t2-autogcp]   rot${m.rotation}° (bearing ${m.bearing_right_deg}°, ${m.selected_gcps} GCPs, ` +
            `residual ${m.residual_max_m}m): tight ${m.coverage_pct}% / serving ${m.serving_coverage_pct}% lots, ` +
            `${m.n_distinct_codes} codes, ${m.n_empty_labels} empty, spatial ${m.spatial_km}km`,
        );
        measured.push(m);
      }
      const decision = decideRotation(measured, {
        coverageFloorPct: args.disambigCoverageFloor,
        marginPct: args.disambigMarginPct,
      });
      console.error(`[t2-autogcp] disambiguation: ${decision.decisive ? "DECISIVE" : "SKIP"} — ${decision.reason}`);
      // Keep the ranking (without bulky per-candidate GCP files) in the report.
      disambiguation = {
        method: "lot-assignment",
        decisive: decision.decisive,
        reason: decision.reason,
        discrimination_cutoff_m: args.disambigCutoffM,
        coverage_floor_pct: args.disambigCoverageFloor,
        margin_pct: args.disambigMarginPct,
        coverage_margin_pct: decision.coverage_margin_pct,
        winner: decision.winner ? { rotation: decision.winner.rotation, extent: decision.winner.extent } : undefined,
        ranking: decision.ranking.map((r) => ({ ...r, gcp_file: undefined })),
      };
      if (decision.decisive && decision.winner) {
        winnerGcp = decision.winner.gcp_file;
        report.pass = true;
        report.reason = undefined;
        report.best = { extent: decision.winner.extent, rotation: decision.winner.rotation };
        report.gcp_file = decision.winner.gcp_file;
        report.residual_max_m = decision.winner.residual_max_m;
        report.holdout_max_m = decision.winner.holdout_max_m;
        report.selected_gcps = decision.winner.selected_gcps;
      }
    }

    const outReport = { ...report, rotation_disambiguation: disambiguation };
    if (args.outGcp && winnerGcp) {
      mkdirSync(dirname(args.outGcp), { recursive: true });
      writeFileSync(args.outGcp, JSON.stringify(winnerGcp, null, 2));
    }
    if (args.report) {
      mkdirSync(dirname(args.report), { recursive: true });
      writeFileSync(
        args.report,
        JSON.stringify({ ...outReport, gcp_file: undefined, orientation_candidates: undefined }, null, 2),
      );
    }
    console.log(JSON.stringify({ ...outReport, orientation_candidates: undefined }, null, 2));
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
    fit: args.fit,
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
