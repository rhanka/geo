/**
 * t2-emit-northup-gcp.ts — emit the NORTH-UP orientation candidate's GCP file
 * from an auto-seed run that was rejected for the 180° point-symmetry artifact.
 *
 * WHY: `t2-autogcp --auto-seed` refuses to serve when ≥2 isometric, non-mirror
 * fits pass residual+holdout but disagree on page-right bearing by ~180° (a
 * point-symmetric parcel pattern fits both ways numerically). Its lot-assignment
 * disambiguator resolves this from the served labels — but on a GLYPH plan
 * (labels are outlined vector, pdftotext = 0 words) the coverage is 0/0 and the
 * disambiguation is structurally undecidable, so the whole slug is SKIPPed even
 * though ONE candidate is provably north-up (page-right = East, page-down =
 * South) and the other is the upside-down twin.
 *
 * This wrapper re-runs the SAME `deriveAutoSeedGcps` and, when the human/agent
 * has INDEPENDENTLY confirmed the drawn plan is north-up (title block up, north
 * arrow up, known neighbouring munis in the right cardinal position), writes the
 * gcp_file of the orientation candidate whose page-right bearing is closest to
 * EAST (within --orientation-tol-deg, default 20°). It is a THIN selector over
 * an already-gated fit — it invents nothing: the emitted GCP is exactly the
 * refined-corner fit that already cleared residual+holdout+isotropy+non-mirror
 * on REAL cadastre parcel corners. The downstream serve (t2-build) still applies
 * every anti-invention gate, and a wrong flip would collapse the served lot
 * coverage — so this only shortcuts the label-blind disambiguation, never a gate.
 *
 * USAGE:
 *   npx tsx acquisition/src/t2-emit-northup-gcp.ts --slug <slug> --pdf <local.pdf> \
 *     --page 1 --out-gcp work/gcp/<slug>.gcp.json [--report <file.json>] \
 *     [--cadastre <local.geojson>] [--max-residual-m 30] [--min-gcps 12] \
 *     [--max-candidate-m 450] [--orientation-tol-deg 20] [--fit affine|similarity]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { execSync } from "node:child_process";
import type { FeatureCollection } from "geojson";

import { getBytes, s3Client } from "./lib/s3.js";
import type { LabelRegionFrac } from "./lib/t1-labels.js";
import { deriveAutoSeedGcps, type FitMode, type OrientationCandidate } from "./lib/t2-autogcp.js";
import type { GcpFile } from "./lib/t2-georef.js";

interface Args {
  slug: string;
  pdf: string;
  page: number;
  outGcp: string;
  report?: string;
  cadastre?: string;
  maxCandidateM: number;
  maxResidualM: number;
  minGcps: number;
  maxGcps: number;
  orientationTolDeg: number;
  fit: FitMode;
  /**
   * Page-fraction boxes masked out of label extraction, written into the emitted
   * GcpFile so every downstream builder inherits them.
   *
   * Needed because a title block INSIDE the neatline can print REAL zone codes at
   * a FALSE position: matane's amendment table (top-left) lists "Zone 49-C",
   * "109-C", "110-R" — all verbatim in the by-law dict, so the dict filter cannot
   * catch them, and each would plant a spurious label metres from the town's NW
   * corner. The neatline gate does not help: the table is drawn inside the frame.
   */
  excludeRegions?: LabelRegionFrac[];
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
  if (!a["slug"] || !a["pdf"] || !a["out-gcp"]) {
    throw new Error("required: --slug <slug> --pdf <local.pdf> --out-gcp <file.gcp.json>");
  }
  if (a["fit"] !== undefined && a["fit"] !== "affine" && a["fit"] !== "similarity") {
    throw new Error(`--fit must be "affine" or "similarity", got "${String(a["fit"])}"`);
  }
  return {
    slug: String(a["slug"]),
    pdf: String(a["pdf"]),
    page: a["page"] ? Number(a["page"]) : 1,
    outGcp: String(a["out-gcp"]),
    report: a["report"] ? String(a["report"]) : undefined,
    cadastre: a["cadastre"] ? String(a["cadastre"]) : undefined,
    maxCandidateM: a["max-candidate-m"] ? Number(a["max-candidate-m"]) : 450,
    maxResidualM: a["max-residual-m"] ? Number(a["max-residual-m"]) : 30,
    minGcps: a["min-gcps"] ? Number(a["min-gcps"]) : 12,
    maxGcps: a["max-gcps"] ? Number(a["max-gcps"]) : 48,
    orientationTolDeg: a["orientation-tol-deg"] ? Number(a["orientation-tol-deg"]) : 20,
    fit: a["fit"] === "similarity" ? "similarity" : "affine",
    excludeRegions: parseExcludeRegions(a["exclude-region"]),
  };
}

/**
 * `--exclude-region fx0,fy0,fx1,fy1[;fx0,fy0,fx1,fy1...]` (page fractions, y down).
 *
 * Fractions may exceed 1: on a sheet stored portrait with /Rotate 90, poppler
 * reports the UNROTATED MediaBox as the page size but emits word boxes in the
 * ROTATED frame, so a word's x/pageW legitimately reaches ~1.41 (3370/2384).
 * That skew is self-cancelling — `extractLabelsFromWords` compares a region
 * against the very same ratio — so measure regions with `_pdf-word-locate.ts`
 * (which divides by the same page size) and pass them through verbatim. Hence the
 * bound is a sanity check (≤2), not a [0,1] clamp that would reject a valid mask.
 */
function parseExcludeRegions(raw: string | boolean | undefined): LabelRegionFrac[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const regions = raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const f = s.split(",").map(Number);
      if (f.length !== 4 || !f.every((n) => Number.isFinite(n) && n >= 0 && n <= 2)) {
        throw new Error(`--exclude-region expects 4 page fractions in [0,2]: "${s}"`);
      }
      return { fx0: f[0]!, fy0: f[1]!, fx1: f[2]!, fy1: f[3]! };
    });
  return regions.length ? regions : undefined;
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
  const pm =
    info.match(new RegExp(`Page\\s+${escaped}\\s+size:\\s*([\\d.]+)\\s*x\\s*([\\d.]+)`)) ??
    info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
  if (!pm) throw new Error("pdfinfo: could not read page size");
  return { pageW: Number(pm[1]), pageH: Number(pm[2]) };
}

/** Angular distance (deg) of a bearing from EAST (0°), in [0,180]. */
function offFromEast(bearingDeg: number): number {
  let d = Math.abs(((bearingDeg % 360) + 360) % 360);
  if (d > 180) d = 360 - d;
  return d;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.pdf)) throw new Error(`--pdf must be a local cached path: ${args.pdf}`);
  const { pageW, pageH } = pdfPageSize(args.pdf, args.page);
  const cadastre = await readCadastre(args.slug, args.cadastre);

  const report = await deriveAutoSeedGcps({
    slug: args.slug,
    pdfPath: args.pdf,
    page: args.page,
    pageW,
    pageH,
    cadastre,
    maxCandidateDistanceM: args.maxCandidateM,
    maxResidualM: args.maxResidualM,
    minGcps: args.minGcps,
    maxGcps: args.maxGcps,
    fit: args.fit,
  });

  let chosen: { gcp: GcpFile; how: string; bearing: number | null } | null = null;

  if (report.pass && report.gcp_file) {
    // Clean north-up winner already — just emit it.
    chosen = { gcp: report.gcp_file, how: "clean-pass", bearing: null };
  } else if (report.orientation_candidates && report.orientation_candidates.length >= 1) {
    // Pick the candidate whose page-right bearing is closest to EAST (north-up).
    const cands = report.orientation_candidates as OrientationCandidate[];
    const ranked = [...cands].sort((a, b) => offFromEast(a.bearing_right_deg) - offFromEast(b.bearing_right_deg));
    const top = ranked[0]!;
    const off = offFromEast(top.bearing_right_deg);
    if (off > args.orientationTolDeg) {
      throw new Error(
        `no north-up orientation candidate: closest page-right bearing ${top.bearing_right_deg}° ` +
          `is Δ${off.toFixed(1)}° from East > tol ${args.orientationTolDeg}° — do NOT force (would fabricate orientation)`,
      );
    }
    chosen = {
      gcp: top.gcp_file,
      how: `northup-candidate rot${top.rotation}° extent=${top.extent} bearing_right=${top.bearing_right_deg}°`,
      bearing: top.bearing_right_deg,
    };
  } else {
    throw new Error(
      `auto-seed produced no servable orientation candidate (reason: ${report.reason ?? "unknown"}); ` +
        `svg_points=${report.svg_points}. Nothing to emit — this is NOT a north-up recalage case.`,
    );
  }

  // Carry the title-block masks into the emitted GcpFile: an in-neatline
  // amendment table prints REAL dict codes at a FALSE position, and no dict
  // filter downstream can tell those apart from the map's own labels.
  const emitted: GcpFile = args.excludeRegions?.length
    ? { ...chosen.gcp, excludeRegions: [...(chosen.gcp.excludeRegions ?? []), ...args.excludeRegions] }
    : chosen.gcp;

  mkdirSync(dirname(args.outGcp), { recursive: true });
  writeFileSync(args.outGcp, JSON.stringify(emitted, null, 2));
  console.error(
    `[t2-emit-northup-gcp] wrote ${args.outGcp} (${emitted.gcps.length} GCPs) via ${chosen.how}` +
      (args.excludeRegions?.length ? ` | ${args.excludeRegions.length} exclude-region(s)` : ""),
  );

  if (args.report) {
    mkdirSync(dirname(args.report), { recursive: true });
    writeFileSync(
      args.report,
      JSON.stringify(
        {
          slug: args.slug,
          pdf: args.pdf,
          page: args.page,
          selected: chosen.how,
          bearing_right_deg: chosen.bearing,
          n_gcps: chosen.gcp.gcps.length,
          auto_seed_pass: report.pass,
          auto_seed_reason: report.reason ?? null,
          svg_points: report.svg_points,
          orientation_candidate_bearings: (report.orientation_candidates ?? []).map((c) => ({
            extent: c.extent,
            rotation: c.rotation,
            bearing_right_deg: c.bearing_right_deg,
            residual_max_m: c.residual_max_m,
            holdout_max_m: c.holdout_max_m,
            selected_gcps: c.selected_gcps,
          })),
        },
        null,
        2,
      ),
    );
    console.error(`[t2-emit-northup-gcp] report → ${args.report}`);
  }
}

main().catch((e) => {
  console.error(`[t2-emit-northup-gcp] ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
