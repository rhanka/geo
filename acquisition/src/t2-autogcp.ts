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
import { isTrivialContiguousSequence, numericDictSet } from "./lib/numeric-codes.js";
import { deriveAutoSeedGcps, deriveAutonomousGcps, type FitMode } from "./lib/t2-autogcp.js";
import { loadClaudeReads } from "./lib/t1-labels-claude.js";
import {
  decideAnisoArbitration,
  decideRotation,
  measureRotationLotAssignment,
  type MeasureContext,
  type MeasuredRotation,
} from "./lib/t2-rotation-disambig.js";
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
  /** When set, re-open the MODERATE-anisotropy iso-gate reject via lot-coverage confirmation. */
  anisoLotArbitrate: boolean;
  /** Upper anisotropy bound of the arbitration band (hard reject above). Default 1.5. */
  anisoArbitrateMax: number;
  /** Serving-cutoff (1500 m) lot-coverage (%) floor to confirm the stretch is real. Default 85. */
  anisoServingCoverageFloor: number;
  /** Distinct lettered codes floor for an arbitrated fit. Default 3. */
  anisoMinDistinctCodes: number;
  /** Authoritative by-law code list (JSON array) — MANDATORY for --allow-numeric-codes. */
  dict?: string;
  /** SAFE, dict-gated relaxation (§7.5) applied to the lot-coverage MEASUREMENT. */
  allowNumericCodes: boolean;
  /**
   * GLYPH plans: agent vision reads ({labels:[{code,x,y}]}, x/y normalized in the
   * crop) feeding the lot-coverage MEASUREMENT instead of pdftotext. REQUIRES
   * --dict (anti-invention: a read outside the by-law dict is rejected).
   */
  visionReads?: string;
  /** Page-point crop the vision reads' normalized x/y refer to: "x0,y0,x1,y1". Default = full page. */
  visionRegion?: [number, number, number, number];
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
  // §7.5 contract: the numeric relaxation NEVER runs without an authoritative
  // dictionary. Fail loudly rather than silently measuring lettered-only.
  if (Boolean(a["allow-numeric-codes"]) && !a["dict"]) {
    throw new Error("--allow-numeric-codes REQUIRES --dict <codes.json> (anti-#74: no dict, no numeric codes)");
  }
  // Same contract for the glyph/vision measurement lane: no dict, no vision reads.
  if (a["vision-reads"] && !a["dict"]) {
    throw new Error("--vision-reads REQUIRES --dict <codes.json> (anti-invention: reads are validated verbatim, never snapped-in)");
  }
  let visionRegion: [number, number, number, number] | undefined;
  if (a["vision-region"]) {
    const parts = String(a["vision-region"]).split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`--vision-region must be "x0,y0,x1,y1" in PDF points, got "${String(a["vision-region"])}"`);
    }
    visionRegion = parts as [number, number, number, number];
  }
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
    anisoLotArbitrate: Boolean(a["aniso-lot-arbitrate"]),
    anisoArbitrateMax: a["aniso-arbitrate-max"] ? Number(a["aniso-arbitrate-max"]) : 1.5,
    anisoServingCoverageFloor: a["aniso-serving-coverage-floor"] ? Number(a["aniso-serving-coverage-floor"]) : 85,
    anisoMinDistinctCodes: a["aniso-min-distinct-codes"] ? Number(a["aniso-min-distinct-codes"]) : 3,
    dict: a["dict"] ? String(a["dict"]) : undefined,
    allowNumericCodes: Boolean(a["allow-numeric-codes"]),
    visionReads: a["vision-reads"] ? String(a["vision-reads"]) : undefined,
    ...(visionRegion ? { visionRegion } : {}),
  };
}

/**
 * GLYPH lane: the agent's positioned vision reads + the authoritative dict that
 * validates them, for the lot-coverage MEASUREMENT (lib/t2-rotation-disambig
 * `visionReads`). Absent → pdftotext measurement, bit-for-bit.
 */
function loadVisionReads(args: Args): MeasureContext["visionReads"] {
  if (!args.visionReads) return undefined;
  const raw = JSON.parse(readFileSync(args.dict!, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`--dict must be a JSON array of codes: ${args.dict}`);
  const dict = raw.map((c) => String(c));
  const reads = loadClaudeReads(args.visionReads);
  console.error(
    `[t2-autogcp] GLYPH measurement lane ON: ${reads.length} agent vision reads from ${args.visionReads}, ` +
      `validated against ${dict.length} dict codes from ${args.dict}`,
  );
  return {
    reads,
    dict,
    ...(args.visionRegion ? { region: args.visionRegion } : {}),
    ...(args.allowNumericCodes ? { allowNumeric: true } : {}),
  };
}

/**
 * Build the pure-numeric admission set for the lot-coverage measurement, under
 * the §7.5 guards: dict MANDATORY, dict must carry a real numeric grille, and it
 * must not be a trivial contiguous 1..N run (an OBJECTID fingerprint). Any guard
 * failing ABORTS — a measurement is never quietly widened.
 */
function loadNumericDict(args: Args): Set<string> | undefined {
  if (!args.allowNumericCodes || !args.dict) return undefined;
  const raw = JSON.parse(readFileSync(args.dict, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`--dict must be a JSON array of codes: ${args.dict}`);
  const codes = raw.map((c) => String(c));
  const set = numericDictSet(codes);
  if (set.size < 3) {
    throw new Error(
      `--dict carries only ${set.size} pure-numeric codes (< 3) — not an authoritative numeric grille; refusing to relax`,
    );
  }
  if (isTrivialContiguousSequence([...set].map(Number))) {
    throw new Error(
      `--dict numeric codes form a trivial contiguous 1..N run — indistinguishable from an OBJECTID sequence; refusing to relax`,
    );
  }
  console.error(`[t2-autogcp] numeric relaxation ON: ${set.size} dict-backed numeric codes from ${args.dict}`);
  return set;
}

/**
 * The NUMBER-DOMINANCE codes of `--dict`, for the lot-coverage MEASUREMENT.
 *
 * Unlike the numeric relaxation this needs no opt-in flag: a composite (`17-R`)
 * is a LETTERED code, so it never touches the anti-#74 rule — the dict only
 * teaches the reader that the muni prints the two parts as separate tokens.
 * Absent/empty → historical behaviour, bit-for-bit.
 */
function loadCompositeDict(args: Args): Set<string> | undefined {
  if (!args.dict) return undefined;
  const raw = JSON.parse(readFileSync(args.dict, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`--dict must be a JSON array of codes: ${args.dict}`);
  const set = new Set(
    raw.map((c) => String(c).trim().toUpperCase()).filter((c) => /^\d{1,3}-[A-Z]{1,3}$/.test(c)),
  );
  if (set.size === 0) return undefined;
  console.error(`[t2-autogcp] composite relaxation ON: ${set.size} dict-backed NUMBER-DOMINANCE codes from ${args.dict}`);
  return set;
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
  const numericDict = loadNumericDict(args);
  const compositeDict = loadCompositeDict(args);
  const visionReads = loadVisionReads(args);

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
      ...(args.anisoLotArbitrate
        ? { anisoLotArbitrate: true, anisoArbitrateMaxAnisotropy: args.anisoArbitrateMax }
        : {}),
    });

    // Winning GCP file (either the direct auto-seed winner, or the rotation the
    // lot-assignment disambiguator decisively selects on an orientation-only reject).
    let winnerGcp: GcpFile | undefined = report.gcp_file;
    let disambiguation: unknown;
    let anisoArbitration: unknown;

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
          numericDict,
          compositeDict,
          visionReads,
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
        // Provenance of the GLYPH lane: which reads/dict fed the measurement
        // (null = historical pdftotext-only extraction).
        label_source: visionReads ? "claude-4.8-vision-dict-validated" : "pdftotext",
        vision_reads: args.visionReads ?? null,
        vision_reads_count: visionReads ? visionReads.reads.length : null,
        vision_dict: visionReads ? args.dict : null,
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

    // Moderate-anisotropy arbitration: a partial-extent / CAD-stretched sheet
    // (arundel ≈1.2) whose honest affine is legitimately anisotropic is served
    // ONLY if the cadastre confirms the stretch is real (tight lot-coverage ≥
    // floor). Anisotropy above the band (saint-cesaire 2.6, sainte-brigide 2.3)
    // never reaches here — it is hard-rejected upstream.
    if (
      !report.pass &&
      args.anisoLotArbitrate &&
      report.aniso_arbitrate_candidates &&
      report.aniso_arbitrate_candidates.length >= 1
    ) {
      console.error(
        `[t2-autogcp] moderate-anisotropy reject → tight lot-coverage arbitration over ` +
          `${report.aniso_arbitrate_candidates.length} north-up candidate(s) in band (>maxAniso, ≤${args.anisoArbitrateMax}]`,
      );
      const measured: MeasuredRotation[] = [];
      for (const cand of report.aniso_arbitrate_candidates) {
        const m = measureRotationLotAssignment(cand, {
          pdfPath,
          page,
          pageW: size.pageW,
          pageH: size.pageH,
          cadastre,
          discriminationCutoffM: args.disambigCutoffM,
          numericDict,
          compositeDict,
          visionReads,
        });
        console.error(
          `[t2-autogcp]   ${cand.extent}/rot${m.rotation}° (${m.selected_gcps} GCPs, residual ${m.residual_max_m}m): ` +
            `tight ${m.coverage_pct}% / serving ${m.serving_coverage_pct}% lots, ${m.n_distinct_codes} codes, ${m.n_empty_labels} empty`,
        );
        measured.push(m);
      }
      const decision = decideAnisoArbitration(measured, {
        servingCoverageFloorPct: args.anisoServingCoverageFloor,
        minDistinctCodes: args.anisoMinDistinctCodes,
      });
      console.error(`[t2-autogcp] aniso-arbitration: ${decision.serve ? "SERVE" : "SKIP"} — ${decision.reason}`);
      anisoArbitration = {
        method: "moderate-anisotropy-lot-coverage",
        serve: decision.serve,
        reason: decision.reason,
        tight_diagnostic_cutoff_m: args.disambigCutoffM,
        aniso_arbitrate_max: args.anisoArbitrateMax,
        serving_coverage_floor_pct: args.anisoServingCoverageFloor,
        min_distinct_codes: args.anisoMinDistinctCodes,
        // Provenance of the §7.5 relaxation: which dict admitted numeric labels
        // into the coverage measurement (null = historical lettered-only).
        numeric_dict: args.allowNumericCodes ? args.dict : null,
        numeric_dict_codes: numericDict ? numericDict.size : null,
        winner: decision.winner ? { rotation: decision.winner.rotation, extent: decision.winner.extent } : undefined,
        ranking: decision.ranking.map((r) => ({ ...r, gcp_file: undefined })),
      };
      if (decision.serve && decision.winner) {
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

    const outReport = { ...report, rotation_disambiguation: disambiguation, aniso_arbitration: anisoArbitration };
    if (args.outGcp && winnerGcp) {
      mkdirSync(dirname(args.outGcp), { recursive: true });
      writeFileSync(args.outGcp, JSON.stringify(winnerGcp, null, 2));
    }
    if (args.report) {
      mkdirSync(dirname(args.report), { recursive: true });
      writeFileSync(
        args.report,
        JSON.stringify(
          { ...outReport, gcp_file: undefined, orientation_candidates: undefined, aniso_arbitrate_candidates: undefined },
          null,
          2,
        ),
      );
    }
    console.log(
      JSON.stringify({ ...outReport, orientation_candidates: undefined, aniso_arbitrate_candidates: undefined }, null, 2),
    );
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
