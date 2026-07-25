/**
 * t1-build-multisheet-files.ts — pool text labels from SEVERAL embedded-georef
 * PDFs (one file per sheet), each carrying its OWN registration.
 *
 * WHY THIS EXISTS. `t1-build-multisheet-text.ts` pools several PAGES of ONE PDF
 * under ONE georef. A large fused municipality (gaspe: 4 sheets, scales 15.9 /
 * 2.8 / 2.9 m per page-point) publishes its zoning as separate FILES, each an
 * independent ArcGIS export with its own /VP /Measure /GEO and its own scale.
 * Neither the single-PDF pooler nor mono-sheet `t1-build` can serve that: the
 * first assumes one transform, the second serves whichever sheet ran last and
 * throws away the rest of the territory.
 *
 * WHAT IT DOES. Per sheet: read its OWN embedded georef, extract verbatim
 * `pdftotext` labels through it, gate the sheet, then POOL the surviving
 * code-points and run the ONE unchanged cadastre line-of-sight aggregation
 * (lib/t1-zones) + `mergeByZoneCode`, so a code printed on two sheets becomes a
 * single multi-part feature. Geometry is still 100 % real cadastral lots and
 * every `zone_code` is still verbatim PDF text.
 *
 * THE SPATIAL GATE, AND WHY IT IS MEASURED FROM THE FOOTPRINT.
 * The mono-sheet gate is `haversine(label-centroid, cadastre-CENTROID) ≤ 8 km`.
 * That question ("are these labels near the middle of the muni?") is the right
 * anti-homonym test for a compact municipality, where the footprint is small, but
 * it is a STRUCTURAL false negative for a sheet of a large fused territory:
 * gaspe's cadastre spans ~19 × 18 km, so a sheet legitimately covering its
 * northern third sits 9–10 km from the centroid while being entirely INSIDE the
 * municipality. The anti-homonym question is actually "do these labels fall on
 * THIS municipality's cadastral footprint?" — so the distance here is measured
 * to the cadastre BBOX (0 when inside). For a compact muni the two are
 * equivalent; for a large one this stops rejecting the true sheets, and a sheet
 * belonging to a NEIGHBOURING muni is still rejected (it lands outside the box).
 *
 * Nothing else is relaxed. A sheet must still clear the residual gate, the pooled
 * set must still carry ≥ min distinct LETTERED codes with no affectation token,
 * and — the real proof (spec §8) — the pooled lot-assignment must reach the floor.
 * Every per-sheet measurement is published in the report, including for sheets
 * that were dropped, so a caller can see exactly what was and was not used.
 *
 *   npx tsx acquisition/src/t1-build-multisheet-files.ts --slug gaspe \
 *     --sheets work/zonage-plans/gaspe-disc-1.pdf,work/zonage-plans/gaspe-disc-2.pdf \
 *     [--dict codes.json] [--allow-overflow-frame] [--min-codes 10] \
 *     [--spatial-km 8] [--min-lot-pct 50] [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { FeatureCollection } from "geojson";

import { extractGeoRef } from "./lib/t1-georef.js";
import { extractLabels, filterExtractedLabelsByDict } from "./lib/t1-labels.js";
import { buildZones, type CodePoint } from "./lib/t1-zones.js";
import { bboxCenter, haversineKm, mergeByZoneCode } from "./lib/zone-serve.js";
import { BUCKET, getBytes, putBytes, s3Client } from "./lib/s3.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function num(name: string, dflt: number): number {
  const v = arg(name);
  return v !== undefined && Number.isFinite(Number(v)) ? Number(v) : dflt;
}
function fail(message: string): never {
  console.error(`[t1-multisheet-files] ABORT (anti-invention): ${message}`);
  process.exit(2);
}

/**
 * Distance (km) from `point` to a lon/lat bbox — 0 when the point is INSIDE.
 * This is the footprint form of the spatial gate (see the header note): it asks
 * whether the labels fall on the municipality, not whether they sit near its
 * centre.
 */
export function bboxDistanceKm(
  point: [number, number],
  bbox: [number, number, number, number],
): number {
  const nearestLon = Math.min(Math.max(point[0], bbox[0]), bbox[2]);
  const nearestLat = Math.min(Math.max(point[1], bbox[1]), bbox[3]);
  return haversineKm(point, [nearestLon, nearestLat]);
}

interface SheetReport {
  pdf: string;
  used: boolean;
  reason?: string;
  crs?: string;
  georef_residual_m?: number;
  scale_m_per_pt?: number;
  n_raw_labels?: number;
  n_kept_labels?: number;
  n_dict_rejected?: number;
  spatial_km_from_footprint?: number;
}

async function main(): Promise<void> {
  const slug = arg("slug");
  const sheetsArg = arg("sheets");
  if (!slug || !sheetsArg) fail("required: --slug <slug> --sheets <a.pdf,b.pdf,…>");
  const sheets = sheetsArg.split(",").map((s) => s.trim()).filter(Boolean);
  if (sheets.length === 0) fail("--sheets is empty");
  for (const s of sheets) if (!existsSync(s)) fail(`sheet not found: ${s}`);

  const dictPath = arg("dict");
  const allowOverflowFrame = process.argv.includes("--allow-overflow-frame");
  const dryRun = process.argv.includes("--dry-run");
  const minCodes = num("min-codes", 10);
  const spatialKm = num("spatial-km", 8);
  const minLotPct = num("min-lot-pct", 50);
  const maxResidualM = num("max-residual-m", 50);
  const out = arg("out") ?? `work/zones-recalage/${slug}-t1-multisheet-files`;

  let dict: string[] | undefined;
  if (dictPath) {
    if (!existsSync(dictPath)) fail(`--dict not found: ${dictPath}`);
    const j = JSON.parse(readFileSync(dictPath, "utf8")) as string[] | { codes?: string[] };
    const codes = Array.isArray(j) ? j : j.codes;
    if (!codes || codes.length < 3) fail("--dict has fewer than 3 codes");
    dict = codes.map(String);
  }

  // Cadastre FIRST: the footprint is what every per-sheet gate is measured against.
  const s3 = s3Client();
  const cadastre = JSON.parse(
    (await getBytes(s3, `normalized/qc-cadastre-lots/${slug}.geojson`)).toString("utf8"),
  ) as FeatureCollection;
  const { center, bbox } = bboxCenter(cadastre);
  const footprint = bbox as [number, number, number, number];
  console.error(
    `[t1-multisheet-files] cadastre: ${cadastre.features.length} lots, footprint ` +
      `[${footprint.map((v) => v.toFixed(4)).join(", ")}]`,
  );

  const pooled: CodePoint[] = [];
  const perSheet: SheetReport[] = [];

  for (const pdf of sheets) {
    const rep: SheetReport = { pdf, used: false };
    const geo = extractGeoRef(readFileSync(pdf), pdf, {
      ...(allowOverflowFrame ? { allowOverflowFrame: true } : {}),
    });
    if (!geo) {
      rep.reason = "no embedded /VP /Measure /GEO georeferencing";
      perSheet.push(rep);
      console.error(`[t1-multisheet-files] ${pdf}: SKIP — ${rep.reason}`);
      continue;
    }
    rep.crs = geo.crsName;
    rep.georef_residual_m = Number(geo.maxResidualM.toFixed(3));
    rep.scale_m_per_pt = Number(geo.scaleMPerPt.toFixed(3));
    if (geo.maxResidualM > maxResidualM) {
      rep.reason = `georef residual ${geo.maxResidualM.toFixed(1)}m > ${maxResidualM}m`;
      perSheet.push(rep);
      console.error(`[t1-multisheet-files] ${pdf}: SKIP — ${rep.reason}`);
      continue;
    }

    const raw = extractLabels(pdf, geo, { page: 1 });
    const kept = dict ? filterExtractedLabelsByDict(raw, dict) : { ...raw, dictRejected: 0 };
    rep.n_raw_labels = raw.codePoints.length;
    rep.n_kept_labels = kept.codePoints.length;
    rep.n_dict_rejected = kept.dictRejected;
    if (kept.codePoints.length === 0) {
      rep.reason = "0 labels (glyph sheet? wrong page?)";
      perSheet.push(rep);
      console.error(`[t1-multisheet-files] ${pdf}: SKIP — ${rep.reason}`);
      continue;
    }

    const sheetCenter = kept.codePoints.reduce<[number, number]>(
      (acc, p) => [acc[0] + p.lon / kept.codePoints.length, acc[1] + p.lat / kept.codePoints.length],
      [0, 0],
    );
    const dKm = bboxDistanceKm(sheetCenter, footprint);
    rep.spatial_km_from_footprint = Number(dKm.toFixed(3));
    if (dKm > spatialKm) {
      rep.reason = `labels ${dKm.toFixed(1)}km OUTSIDE the cadastre footprint (> ${spatialKm}km)`;
      perSheet.push(rep);
      console.error(`[t1-multisheet-files] ${pdf}: SKIP — ${rep.reason}`);
      continue;
    }

    rep.used = true;
    perSheet.push(rep);
    pooled.push(...kept.codePoints);
    console.error(
      `[t1-multisheet-files] ${pdf}: USE — ${kept.codePoints.length} labels, ` +
        `residual ${geo.maxResidualM.toFixed(2)}m, ${dKm.toFixed(2)}km from footprint`,
    );
  }

  const usedSheets = perSheet.filter((s) => s.used);
  if (usedSheets.length === 0) fail("no sheet cleared its gates");

  // Anti-invention gates on the POOLED label set (identical in spirit to t1-build).
  const distinct = new Set(pooled.map((p) => p.code));
  if (distinct.size < minCodes) fail(`only ${distinct.size} distinct codes < ${minCodes}`);
  const banned = [...distinct].filter((c) => /^(affectation|cmm|mrc|sad|pmad)/i.test(c));
  if (banned.length) fail(`affectation tokens: ${banned.join(",")}`);
  const nonLettered = [...distinct].filter((c) => !/[A-Za-z]/.test(c) || !/\d/.test(c));
  if (nonLettered.length) fail(`non-lettered codes (anti-#74): ${nonLettered.slice(0, 8).join(",")}`);

  const { featureCollection, stats } = buildZones(cadastre, pooled, {
    lat0: (footprint[1] + footprint[3]) / 2,
    cutoffM: 1500,
    source: "geopdf-esri-multisheet-files",
    confidence: "contour-auto",
    dissolve: true,
  });
  const served = mergeByZoneCode(featureCollection);
  const lotPct = (100 * stats.n_lots_assigned) / stats.n_lots_total;
  console.error(
    `[t1-multisheet-files] pooled: ${pooled.length} labels / ${distinct.size} codes from ` +
      `${usedSheets.length}/${sheets.length} sheets → ${served.features.length} features, ` +
      `${stats.n_lots_assigned}/${stats.n_lots_total} lots (${lotPct.toFixed(2)}%)`,
  );
  if (lotPct < minLotPct) fail(`lot assignment ${lotPct.toFixed(2)}% < ${minLotPct}%`);

  const pooledCenter = pooled.reduce<[number, number]>(
    (acc, p) => [acc[0] + p.lon / pooled.length, acc[1] + p.lat / pooled.length],
    [0, 0],
  );
  const report = {
    slug,
    source: "geopdf-esri-multisheet-files",
    confidence: "contour-auto",
    label_mode: "text",
    sheets: perSheet,
    n_sheets_used: usedSheets.length,
    n_sheets_total: sheets.length,
    allow_overflow_frame: allowOverflowFrame,
    dict_codes: dict ? dict.length : null,
    // `n_code_points` / `n_distinct_codes` viennent de `stats` (buildZones les calcule sur
    // le MÊME tableau `pooled`) : les redéclarer ici les faisait écraser par le spread.
    n_served_features: served.features.length,
    pooled_spatial_km_from_footprint: Number(bboxDistanceKm(pooledCenter, footprint).toFixed(3)),
    pooled_spatial_km_from_centroid: Number(haversineKm(pooledCenter, center).toFixed(3)),
    lot_to_zone_pct: Number(lotPct.toFixed(2)),
    ...stats,
  };

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `qc-zonage-${slug}.geojson`), JSON.stringify(served));
  writeFileSync(join(out, `qc-zonage-${slug}.stats.json`), JSON.stringify(report, null, 2));
  if (!dryRun) {
    const key = `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`;
    await putBytes(s3, key, JSON.stringify(served), "application/geo+json");
    await putBytes(
      s3,
      `normalized/ca-qc-zonage/qc-zonage-${slug}.stats.json`,
      JSON.stringify(report, null, 2),
      "application/json",
    );
    console.error(`[t1-multisheet-files] uploaded s3://${BUCKET}/${key}`);
  } else {
    console.error("[t1-multisheet-files] --dry-run: NOT uploading to S3.");
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
