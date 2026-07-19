/** Pool dict-validated text labels from several pages of one embedded-georef PDF. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FeatureCollection } from "geojson";

import { extractGeoRef } from "./lib/t1-georef.js";
import { extractLabels, filterExtractedLabelsByDict } from "./lib/t1-labels.js";
import { buildZones } from "./lib/t1-zones.js";
import { bboxCenter, haversineKm, mergeByZoneCode } from "./lib/zone-serve.js";
import { BUCKET, getBytes, putBytes, s3Client } from "./lib/s3.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function fail(message: string): never {
  console.error(`[t1-multisheet-text] ABORT (anti-invention): ${message}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const slug = arg("slug");
  const pdf = arg("pdf");
  const dictPath = arg("dict");
  const pages = (arg("pages") ?? "1").split(",").map(Number).filter(Number.isFinite);
  const out = arg("out") ?? `work/zones-recalage/${slug}-t1-multisheet-text`;
  const dryRun = process.argv.includes("--dry-run");
  if (!slug || !pdf || !dictPath || pages.length === 0) fail("required: --slug --pdf --dict --pages 1,2");
  if (!existsSync(pdf) || !existsSync(dictPath)) fail("PDF or dictionary not found");
  const dictJson = JSON.parse(readFileSync(dictPath, "utf8")) as string[] | { codes?: string[] };
  const dict = Array.isArray(dictJson) ? dictJson : dictJson.codes;
  if (!dict || dict.length < 3) fail("dictionary has fewer than 3 codes");

  // Same opt-in as t1-build: an ArcGIS data frame ROTATED on the sheet has a /VP
  // /BBox larger than the /MediaBox by construction (lib/t1-georef
  // isPageAnchoredFrame). Default OFF — the strict containment gate is unchanged.
  const allowOverflowFrame = process.argv.includes("--allow-overflow-frame");
  const geo = extractGeoRef(readFileSync(pdf), pdf, {
    ...(allowOverflowFrame ? { allowOverflowFrame: true } : {}),
  });
  if (!geo) fail("no embedded /VP /Measure /GEO georeferencing");
  if (geo.maxResidualM > 50) fail(`georef residual ${geo.maxResidualM.toFixed(1)}m > 50m`);

  const pooled = [] as ReturnType<typeof extractLabels>["codePoints"];
  const perPage: Array<Record<string, unknown>> = [];
  for (const page of pages) {
    const raw = extractLabels(pdf, geo, { page });
    const filtered = filterExtractedLabelsByDict(raw, dict);
    pooled.push(...filtered.codePoints);
    perPage.push({ page, raw: raw.codePoints.length, kept: filtered.codePoints.length, rejected: filtered.dictRejected });
  }
  const distinct = new Set(pooled.map((point) => point.code));
  if (distinct.size < 3) fail(`only ${distinct.size} distinct dict-validated codes`);
  const banned = [...distinct].filter((code) => /^(affectation|cmm|mrc|sad|pmad)/i.test(code));
  if (banned.length) fail(`affectation tokens: ${banned.join(",")}`);
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
  if (spatialKm > 8) fail(`labels ${spatialKm.toFixed(1)}km from cadastre`);

  const { featureCollection, stats } = buildZones(cadastre, pooled, {
    lat0: (bbox[1] + bbox[3]) / 2,
    cutoffM: 1500,
    source: "geopdf-esri-multisheet-text-dict",
    confidence: "contour-auto",
    dissolve: true,
  });
  const served = mergeByZoneCode(featureCollection);
  const lotPct = 100 * stats.n_lots_assigned / stats.n_lots_total;
  const minLotPct = arg("min-lot-pct") ? Number(arg("min-lot-pct")) : 70;
  console.error(
    `[t1-multisheet-text] pooled: ${pooled.length} labels / ${distinct.size} codes -> ` +
      `${served.features.length} features, ${stats.n_lots_assigned}/${stats.n_lots_total} lots (${lotPct.toFixed(2)}%)`,
  );
  if (lotPct < minLotPct) fail(`lot assignment ${lotPct.toFixed(2)}% < ${minLotPct}%`);
  const report = {
    slug,
    source: "geopdf-esri-multisheet-text-dict",
    pdf,
    pages: perPage,
    georef_residual_m: Number(geo.maxResidualM.toFixed(3)),
    dict_codes: dict.length,
    n_code_points: pooled.length,
    n_distinct_codes: distinct.size,
    n_served_features: served.features.length,
    label_spatial_km_from_cadastre: Number(spatialKm.toFixed(3)),
    lot_to_zone_pct: Number(lotPct.toFixed(2)),
    ...stats,
  };
  mkdirSync(out, { recursive: true });
  const geojson = join(out, `qc-zonage-${slug}.geojson`);
  const statsPath = join(out, `qc-zonage-${slug}.stats.json`);
  writeFileSync(geojson, JSON.stringify(served));
  writeFileSync(statsPath, JSON.stringify(report, null, 2));
  if (!dryRun) {
    const key = `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`;
    await putBytes(s3, key, JSON.stringify(served), "application/geo+json");
    await putBytes(s3, `normalized/ca-qc-zonage/qc-zonage-${slug}.stats.json`, JSON.stringify(report, null, 2), "application/json");
    console.error(`[t1-multisheet-text] uploaded s3://${BUCKET}/${key}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
