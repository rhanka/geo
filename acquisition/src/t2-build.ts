/**
 * t2-build.ts — T2 zoning end-to-end via MANUAL 3-GCP georeferencing.
 *
 *   T2 PDF (labels but NO embedded georef)  +  3+ human GCPs  +  province cadastre
 *      → manual affine page→WGS84 transform   (t2-georef.buildGeoRefFromGcps)
 *      → georeferenced zone-code labels        (t1-labels: pdftotext text, or
 *                                                t2-labels-ocr: tesseract glyphs)
 *      → cadastre line-of-sight nearest-label aggregation  (t1-zones, UNCHANGED)
 *      → 1 MultiPolygon / distinct zone_code, WGS84  →  qc-zonage-<slug>.geojson
 *
 * This is the T2 sibling of `t1-build.ts`: it swaps ONLY the georef source
 * (manual GCPs instead of the embedded /GPTS) and otherwise reuses the exact
 * committed T1 pipeline + serving contract (lib/zone-serve). The whole point of
 * the gcp3 tool is this single substitution — the human supplies WHERE the plan
 * sits on Earth; everything downstream is the proven, anti-invention recipe.
 *
 * Anti-invention gates (a failing gate ABORTS, never fabricates):
 *   - ≥3 GCPs, non-collinear, calibration residual below threshold,
 *   - ≥ min-codes distinct lettered zone codes (anti-#74), no affectation/CMM,
 *   - label centroid within spatial-km of the cadastre footprint,
 *   - every output ring is a real cadastral lot; every zone_code verbatim PDF.
 *
 * Usage:
 *   tsx src/t2-build.ts --slug saint-constant --gcp work/gcp/saint-constant.gcp.json \
 *        [--pdf <url|path>] [--page 8] [--labels text|ocr] [--ocr-reviewed] [--dry-run] [--out <dir>]
 *        [--cutoff-m 1500] [--min-codes 10] [--max-residual-m 50] [--spatial-km 8]
 *        [--cadastre <path>] [--ocr-dpi 200]
 *
 * The --gcp file is a `GcpFile` (see lib/t2-georef.ts); --pdf overrides its `pdf`.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FeatureCollection } from "geojson";

import { extractLabels, type ExtractLabelsResult } from "./lib/t1-labels.js";
import { buildZones } from "./lib/t1-zones.js";
import { buildGeoRefFromGcpsCrs, type GcpFile } from "./lib/t2-georef.js";
import { s3Client, getBytes, putBytes, BUCKET } from "./lib/s3.js";
import { haversineKm, bboxCenter, mergeByZoneCode } from "./lib/zone-serve.js";

interface Args {
  slug: string;
  gcp: string;
  pdf?: string;
  page?: number;
  labels: "text" | "ocr";
  ocrReviewed: boolean;
  dryRun: boolean;
  out?: string;
  cutoffM: number;
  minCodes: number;
  maxResidualM: number;
  spatialKm: number;
  cadastre?: string;
  ocrDpi: number;
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
  if (!a["slug"] || !a["gcp"]) throw new Error("required: --slug <slug> --gcp <file.gcp.json>");
  const labels = String(a["labels"] ?? "text");
  if (labels !== "text" && labels !== "ocr") throw new Error("--labels must be text|ocr");
  return {
    slug: String(a["slug"]),
    gcp: String(a["gcp"]),
    pdf: a["pdf"] ? String(a["pdf"]) : undefined,
    page: a["page"] ? Number(a["page"]) : undefined,
    labels,
    ocrReviewed: Boolean(a["ocr-reviewed"]),
    dryRun: Boolean(a["dry-run"]),
    out: a["out"] ? String(a["out"]) : undefined,
    cutoffM: a["cutoff-m"] ? Number(a["cutoff-m"]) : 1500,
    minCodes: a["min-codes"] ? Number(a["min-codes"]) : 10,
    maxResidualM: a["max-residual-m"] ? Number(a["max-residual-m"]) : 50,
    spatialKm: a["spatial-km"] ? Number(a["spatial-km"]) : 8,
    cadastre: a["cadastre"] ? String(a["cadastre"]) : undefined,
    ocrDpi: a["ocr-dpi"] ? Number(a["ocr-dpi"]) : 200,
  };
}

async function resolvePdf(pdf: string): Promise<string> {
  if (!/^https?:/.test(pdf)) {
    if (!existsSync(pdf)) throw new Error(`pdf not found: ${pdf}`);
    return pdf;
  }
  const path = join(tmpdir(), `t2-${Date.now()}.pdf`);
  execSync(`curl -sL -A "Mozilla/5.0" ${JSON.stringify(pdf)} -o ${JSON.stringify(path)}`);
  return path;
}

/** Page size in PDF points via pdfinfo (MediaBox). */
export function pdfPageSize(pdfPath: string, page = 1): { pageW: number; pageH: number } {
  const info = execSync(`pdfinfo -f ${page} -l ${page} ${JSON.stringify(pdfPath)}`, { encoding: "utf8" });
  const escaped = String(page).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pm =
    info.match(new RegExp(`Page\\s+${escaped}\\s+size:\\s*([\\d.]+)\\s*x\\s*([\\d.]+)`)) ??
    info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
  if (!pm) throw new Error("pdfinfo: could not read page size");
  return { pageW: Number(pm[1]), pageH: Number(pm[2]) };
}

function fail(msg: string): never {
  console.error(`\n[t2-build] ABORT (anti-invention): ${msg}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  // 0. GCP calibration file ---------------------------------------------------
  const gcpFile = JSON.parse(readFileSync(args.gcp, "utf8")) as GcpFile;
  const pdfArg = args.pdf ?? gcpFile.pdf;
  if (!pdfArg) fail("no PDF given (neither --pdf nor gcp file `pdf`)");
  const page = args.page ?? gcpFile.page ?? 1;
  console.error(`[t2-build] slug=${args.slug} gcp=${args.gcp} pdf=${pdfArg} page=${page} labels=${args.labels}`);

  // 1. PDF + page size + manual georef ---------------------------------------
  const pdfPath = await resolvePdf(pdfArg);
  const { pageW, pageH } = gcpFile.pageW && gcpFile.pageH
    ? { pageW: gcpFile.pageW, pageH: gcpFile.pageH }
    : pdfPageSize(pdfPath, page);

  let cal;
  try {
    cal = buildGeoRefFromGcpsCrs(gcpFile.gcps, pageW, pageH, gcpFile.crs, gcpFile.neatline);
  } catch (e) {
    fail(`GCP calibration failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const geo = cal.geo;
  console.error(
    `[t2-build] georef: ${gcpFile.gcps.length} GCPs | calibration residual ` +
      `max ${cal.maxResidualM.toFixed(2)} m, rms ${cal.rmsResidualM.toFixed(2)} m | ` +
      `scale ${geo.scaleMPerPt.toFixed(3)} m/pt`,
  );
  cal.residualsM.forEach((r, i) =>
    console.error(`           GCP#${i + 1}${gcpFile.gcps[i]!.note ? ` (${gcpFile.gcps[i]!.note})` : ""}: ${r.toFixed(2)} m`),
  );
  if (cal.maxResidualM > args.maxResidualM) {
    fail(`GCP calibration residual ${cal.maxResidualM.toFixed(1)} m > ${args.maxResidualM} m — recheck the GCP picks`);
  }

  // 2. Labels (text via pdftotext, or glyphs via positioned OCR) -------------
  let lab: ExtractLabelsResult;
  if (args.labels === "ocr") {
    const { extractLabelsOcr } = await import("./lib/t2-labels-ocr.js");
    lab = await extractLabelsOcr(pdfPath, geo, { dpi: args.ocrDpi, page });
    console.error(
      "[t2-build] NOTE: OCR label path is EXPERIMENTAL (tesseract glyph reading). " +
        "Codes MUST be human-reviewed before serving; pass --ocr-reviewed only after that check.",
    );
  } else {
    lab = extractLabels(pdfPath, geo, { page, excludeRegions: gcpFile.excludeRegions });
  }
  const distinct = new Set(lab.codePoints.map((c) => c.code));
  const minCodes = Math.max(3, args.minCodes);
  console.error(
    `[t2-build] labels: ${lab.nWords} words, ${lab.nCodeLike} code-like, ` +
      `${lab.nInsideFrame} in-frame (${lab.rejectedOutsideFrame} rejected outside), ` +
      `${distinct.size} distinct codes`,
  );
  if (distinct.size < minCodes) {
    fail(
      `only ${distinct.size} distinct zone codes (< ${minCodes}); ` +
        (args.labels === "text" ? "labels may be glyphs → retry with --labels ocr" : "OCR yield too low"),
    );
  }
  // anti-#74 + anti-affectation: every code lettered + no banned tokens.
  const banned = /^(affectation|cmm|mrc|sad|pmad)/i;
  const nonLettered = [...distinct].filter((c) => !/[A-Za-z]/.test(c) || !/\d/.test(c));
  const bannedHit = [...distinct].filter((c) => banned.test(c));
  if (nonLettered.length > 0) fail(`non-lettered (sequential?) codes present: ${nonLettered.slice(0, 8).join(", ")}`);
  if (bannedHit.length > 0) fail(`affectation/CMM tokens present: ${bannedHit.join(", ")}`);

  // 3. Cadastre --------------------------------------------------------------
  const s3 = s3Client();
  const cadKey = args.cadastre ?? `normalized/qc-cadastre-lots/${args.slug}.geojson`;
  let cadBuf: Buffer;
  if (args.cadastre && existsSync(args.cadastre)) cadBuf = readFileSync(args.cadastre);
  else cadBuf = await getBytes(s3, cadKey);
  const cadastre = JSON.parse(cadBuf.toString("utf8")) as FeatureCollection;
  const { center: cadCenter, bbox: cadBbox } = bboxCenter(cadastre);
  const lat0 = (cadBbox[1] + cadBbox[3]) / 2;
  console.error(
    `[t2-build] cadastre: ${cadastre.features.length} lots, center ` +
      `${cadCenter[0].toFixed(4)},${cadCenter[1].toFixed(4)}`,
  );

  // 3b. spatial gate: labels must sit inside the cadastre footprint.
  const labCenter: [number, number] = lab.codePoints.reduce(
    (acc, c) => [acc[0] + c.lon / lab.codePoints.length, acc[1] + c.lat / lab.codePoints.length],
    [0, 0] as [number, number],
  );
  const spatialKm = haversineKm(labCenter, cadCenter);
  console.error(`[t2-build] spatial: label-centroid vs cadastre-centroid = ${spatialKm.toFixed(2)} km`);
  if (spatialKm > args.spatialKm) {
    fail(`labels ${spatialKm.toFixed(1)} km from cadastre (> ${args.spatialKm} km) — GCP georef mismatch`);
  }
  const inBbox = lab.codePoints.filter(
    (c) => c.lon >= cadBbox[0] && c.lon <= cadBbox[2] && c.lat >= cadBbox[1] && c.lat <= cadBbox[3],
  ).length;
  console.error(`[t2-build] ${inBbox}/${lab.codePoints.length} labels inside cadastre bbox`);

  // 4. Cadastre aggregation (UNCHANGED T1 recipe) ----------------------------
  const { featureCollection, stats } = buildZones(cadastre, lab.codePoints, {
    lat0,
    cutoffM: args.cutoffM,
    source: "t2-gcp3",
    confidence: "contour-manual-gcp",
    dissolve: true,
  });
  const lotToZonePct = (100 * stats.n_lots_assigned) / stats.n_lots_total;
  const served = mergeByZoneCode(featureCollection);
  console.error(
    `[t2-build] zones: ${stats.n_zone_features} code-point features -> ${served.features.length} ` +
      `distinct-code features, ${stats.n_lots_assigned}/${stats.n_lots_total} ` +
      `lots (${lotToZonePct.toFixed(1)}%), ${stats.n_empty_labels} empty labels`,
  );

  // 5. Output ----------------------------------------------------------------
  const elapsedS = (Date.now() - t0) / 1000;
  const report = {
    slug: args.slug,
    source: "t2-gcp3",
    confidence: "contour-manual-gcp",
    pdf: pdfArg,
    page,
    label_mode: args.labels,
    ocr_reviewed: args.labels === "ocr" ? args.ocrReviewed : undefined,
    crs: geo.crsName,
    n_gcps: gcpFile.gcps.length,
    gcp_residual_max_m: Number(cal.maxResidualM.toFixed(3)),
    gcp_residual_rms_m: Number(cal.rmsResidualM.toFixed(3)),
    scale_m_per_pt: Number(geo.scaleMPerPt.toFixed(3)),
    n_label_codes: distinct.size,
    n_labels_in_frame: lab.nInsideFrame,
    n_served_features: served.features.length,
    label_spatial_km_from_cadastre: Number(spatialKm.toFixed(3)),
    lot_to_zone_pct: Number(lotToZonePct.toFixed(2)),
    compute_seconds: Number(elapsedS.toFixed(1)),
    ...stats,
  };

  const outDir = args.out ?? join(tmpdir(), `t2-${args.slug}`);
  mkdirSync(outDir, { recursive: true });
  const geojsonPath = join(outDir, `qc-zonage-${args.slug}.geojson`);
  const statsPath = join(outDir, `qc-zonage-${args.slug}.stats.json`);
  writeFileSync(geojsonPath, JSON.stringify(served));
  writeFileSync(statsPath, JSON.stringify(report, null, 2));
  console.error(`[t2-build] wrote ${geojsonPath} + stats`);

  if (args.dryRun) {
    console.error("[t2-build] --dry-run: NOT uploading to S3.");
  } else {
    if (args.labels === "ocr" && !args.ocrReviewed) {
      fail("OCR labels are not verbatim-selectable PDF text; rerun with --dry-run for preview or pass --ocr-reviewed after human code QA");
    }
    const s3Key = `normalized/ca-qc-zonage/qc-zonage-${args.slug}.geojson`;
    await putBytes(s3, s3Key, JSON.stringify(served), "application/geo+json");
    await putBytes(
      s3,
      `normalized/ca-qc-zonage/qc-zonage-${args.slug}.stats.json`,
      JSON.stringify(report, null, 2),
      "application/json",
    );
    console.error(`[t2-build] uploaded s3://${BUCKET}/${s3Key}`);
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
