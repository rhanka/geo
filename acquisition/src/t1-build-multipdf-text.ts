/**
 * t1-build-multipdf-text.ts — pool dict-validated text labels from SEVERAL
 * separate embedded-georef GeoPDF sheets (each with its OWN georef/extent) onto
 * ONE cadastre, then aggregate to zones. This is the multi-FILE analogue of
 * t1-build-multisheet-text.ts (which pools pages of ONE pdf under ONE georef).
 *
 * MOTIVE — a municipal zoning plan is frequently issued as several sheets that
 * TILE the territory at different scales (ex. Sutton règl. 115-12-2020: Plan A
 * = territory overview, Plan B / Plan C = village insets). Each sheet is a
 * separate ArcMap GeoPDF with its OWN /VP /Measure georef, so they cannot be
 * merged into one PDF and read under a single transform. This tool reads each
 * sheet's georef INDEPENDENTLY, projects its labels to WGS84, unions all the
 * code-points, and runs the cadastre nearest-label aggregation ONCE so the whole
 * territory is covered and the densest sheet wins each lot.
 *
 * Anti-invention (identical guards to t1-build / multisheet-text — a failing gate
 * ABORTS, never fabricates):
 *   - every sheet must carry embedded /VP /Measure georef with residual ≤ max,
 *   - labels dict-validated verbatim against the by-law code list,
 *   - no affectation/CMM tokens, every code lettered, labels inside cadastre,
 *   - ≥ min lot assignment, else ABORT.
 *
 * Usage:
 *   tsx src/t1-build-multipdf-text.ts --slug sutton \
 *       --pdfs planA.pdf,planB.pdf,planC.pdf --dict codes.json \
 *       [--out dir] [--cutoff-m 1500] [--min-lot-pct 70] [--max-residual-m 50] \
 *       [--spatial-km 8] [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FeatureCollection } from "geojson";

import { extractGeoRef } from "./lib/t1-georef.js";
import { extractLabels, filterExtractedLabelsByDict, type ExtractLabelsResult } from "./lib/t1-labels.js";
import { buildZones } from "./lib/t1-zones.js";
import { bboxCenter, haversineKm, mergeByZoneCode } from "./lib/zone-serve.js";
import { BUCKET, getBytes, putBytes, s3Client } from "./lib/s3.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function fail(message: string): never {
  console.error(`[t1-multipdf-text] ABORT (anti-invention): ${message}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const slug = arg("slug");
  const pdfsArg = arg("pdfs");
  const dictPath = arg("dict");
  const cutoffM = Number(arg("cutoff-m") ?? 1500);
  const minLotPct = Number(arg("min-lot-pct") ?? 70);
  const maxResidualM = Number(arg("max-residual-m") ?? 50);
  const spatialKmMax = Number(arg("spatial-km") ?? 8);
  const dryRun = process.argv.includes("--dry-run");
  if (!slug || !pdfsArg || !dictPath) fail("required: --slug --pdfs a.pdf,b.pdf --dict codes.json");
  const pdfs = pdfsArg.split(",").map((s) => s.trim()).filter(Boolean);
  if (pdfs.length < 1) fail("need at least one --pdfs entry");
  if (!existsSync(dictPath)) fail(`dictionary not found: ${dictPath}`);
  const dictJson = JSON.parse(readFileSync(dictPath, "utf8")) as string[] | { codes?: string[] };
  const dict = Array.isArray(dictJson) ? dictJson : dictJson.codes;
  if (!dict || dict.length < 3) fail("dictionary has fewer than 3 codes");
  const out = arg("out") ?? `work/zones-recalage/${slug}-t1-multipdf-text`;

  const pooled: ExtractLabelsResult["codePoints"] = [];
  const perSheet: Array<Record<string, unknown>> = [];
  for (const pdf of pdfs) {
    if (!existsSync(pdf)) fail(`PDF not found: ${pdf}`);
    const geo = extractGeoRef(readFileSync(pdf), pdf);
    if (!geo) fail(`no embedded /VP /Measure georef in ${pdf}`);
    if (geo.maxResidualM > maxResidualM) fail(`${pdf}: georef residual ${geo.maxResidualM.toFixed(1)}m > ${maxResidualM}m`);
    const raw = extractLabels(pdf, geo);
    const filtered = filterExtractedLabelsByDict(raw, dict);
    pooled.push(...filtered.codePoints);
    perSheet.push({
      pdf,
      crs: geo.crsName,
      residual_m: Number(geo.maxResidualM.toFixed(3)),
      raw_labels: raw.codePoints.length,
      kept: filtered.codePoints.length,
      rejected: filtered.dictRejected,
      distinct: new Set(filtered.codePoints.map((c) => c.code)).size,
    });
    console.error(
      `[t1-multipdf-text] ${pdf}: crs=${geo.crsName} residual=${geo.maxResidualM.toFixed(2)}m ` +
        `kept=${filtered.codePoints.length}/${raw.codePoints.length} distinct=${new Set(filtered.codePoints.map((c) => c.code)).size}`,
    );
  }

  const distinct = new Set(pooled.map((point) => point.code));
  if (distinct.size < 3) fail(`only ${distinct.size} distinct dict-validated codes pooled`);
  const banned = [...distinct].filter((code) => /^(affectation|cmm|mrc|sad|pmad)/i.test(code));
  if (banned.length) fail(`affectation/CMM tokens: ${banned.join(",")}`);
  const nonLettered = [...distinct].filter((code) => !/[A-Za-z]/.test(code) || !/\d/.test(code));
  if (nonLettered.length) fail(`non-lettered codes: ${nonLettered.join(",")}`);

  const s3 = s3Client();
  const cadastre = JSON.parse(
    (await getBytes(s3, `normalized/qc-cadastre-lots/${slug}.geojson`)).toString("utf8"),
  ) as FeatureCollection;
  const { center, bbox } = bboxCenter(cadastre);
  const labelCenter = pooled.reduce<[number, number]>(
    (acc, point) => [acc[0] + point.lon / pooled.length, acc[1] + point.lat / pooled.length],
    [0, 0],
  );
  const spatialKm = haversineKm(labelCenter, center);
  if (spatialKm > spatialKmMax) fail(`labels ${spatialKm.toFixed(1)}km from cadastre (> ${spatialKmMax}km)`);

  const { featureCollection, stats } = buildZones(cadastre, pooled, {
    lat0: (bbox[1] + bbox[3]) / 2,
    cutoffM,
    source: "geopdf-esri-multipdf-text-dict",
    confidence: "contour-auto",
    dissolve: true,
  });
  const served = mergeByZoneCode(featureCollection);
  const lotPct = (100 * stats.n_lots_assigned) / stats.n_lots_total;
  if (lotPct < minLotPct) fail(`lot assignment ${lotPct.toFixed(2)}% < ${minLotPct}%`);

  const report = {
    slug,
    source: "geopdf-esri-multipdf-text-dict",
    pdfs,
    sheets: perSheet,
    dict_codes: dict.length,
    // `n_code_points` / `n_distinct_codes` viennent de `stats` (buildZones les calcule sur
    // le MÊME tableau `pooled`) : les redéclarer ici les faisait écraser par le spread.
    n_served_features: served.features.length,
    label_spatial_km_from_cadastre: Number(spatialKm.toFixed(3)),
    lot_to_zone_pct: Number(lotPct.toFixed(2)),
    ...stats,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `qc-zonage-${slug}.geojson`), JSON.stringify(served));
  writeFileSync(join(out, `qc-zonage-${slug}.stats.json`), JSON.stringify(report, null, 2));
  console.error(
    `[t1-multipdf-text] ${pdfs.length} sheets -> ${distinct.size} distinct codes, ` +
      `${served.features.length} served features, ${stats.n_lots_assigned}/${stats.n_lots_total} lots (${lotPct.toFixed(1)}%)`,
  );
  if (!dryRun) {
    const key = `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`;
    await putBytes(s3, key, JSON.stringify(served), "application/geo+json");
    await putBytes(s3, `normalized/ca-qc-zonage/qc-zonage-${slug}.stats.json`, JSON.stringify(report, null, 2), "application/json");
    console.error(`[t1-multipdf-text] uploaded s3://${BUCKET}/${key}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
