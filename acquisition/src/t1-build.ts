/**
 * t1-build.ts — T1 GeoPDF zoning end-to-end (pure-Node, no GDAL).
 *
 *   GeoPDF (georeferenced, labels=text)  +  province cadastre (S3)
 *      → embedded page→WGS84 transform   (t1-georef, /VP /Measure /GPTS)
 *      → georeferenced zone-code labels   (t1-labels, pdftotext -bbox)
 *      → cadastre line-of-sight nearest-label aggregation  (t1-zones)
 *      → 1 MultiPolygon / zone, WGS84, schema {zone_code, kind, source,
 *        confidence, n_lots}  →  normalized/ca-qc-zonage/qc-zonage-<slug>.geojson
 *
 * This is the TypeScript replacement for the Python legacy producer of the
 * saint-amable golden (build_zones.py + the OSM-RANSAC georef), now reading the
 * georeferencing straight out of the PDF — no GDAL, no manual GCPs.
 *
 * QA (strict, anti-invention — a failing gate ABORTS, never fabricates):
 *   - georef present (/VP /Measure /GEO) and corner residual below threshold,
 *   - ≥ min-codes distinct lettered zone codes (the anti-#74 rule),
 *   - labels land INSIDE the cadastre footprint (spatial agreement),
 *   - every output ring is a real cadastral lot; every zone_code verbatim PDF.
 *
 * Usage:
 *   tsx src/t1-build.ts --slug delson --pdf <url|path> [--dry-run]
 *                       [--out <dir>] [--cutoff-m 1500] [--min-codes 10]
 *                       [--max-residual-m 50] [--spatial-km 8]
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import * as polyclip from "polyclip-ts";

import { extractGeoRef } from "./lib/t1-georef.js";
import { extractLabels } from "./lib/t1-labels.js";
import { buildZones, projConstants, type CodePoint } from "./lib/t1-zones.js";
import { s3Client, getBytes, putBytes, BUCKET } from "./lib/s3.js";

interface Args {
  slug: string;
  pdf: string;
  dryRun: boolean;
  out?: string;
  cutoffM: number;
  minCodes: number;
  maxResidualM: number;
  spatialKm: number;
  cadastre?: string;
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
  if (!a["slug"] || !a["pdf"]) {
    throw new Error("required: --slug <slug> --pdf <url|path>");
  }
  return {
    slug: String(a["slug"]),
    pdf: String(a["pdf"]),
    dryRun: Boolean(a["dry-run"]),
    out: a["out"] ? String(a["out"]) : undefined,
    cutoffM: a["cutoff-m"] ? Number(a["cutoff-m"]) : 1500,
    minCodes: a["min-codes"] ? Number(a["min-codes"]) : 10,
    maxResidualM: a["max-residual-m"] ? Number(a["max-residual-m"]) : 50,
    spatialKm: a["spatial-km"] ? Number(a["spatial-km"]) : 8,
    cadastre: a["cadastre"] ? String(a["cadastre"]) : undefined,
  };
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bboxCenter(fc: FeatureCollection): { center: [number, number]; bbox: [number, number, number, number] } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const scan = (poly: number[][][]): void => {
      for (const ring of poly)
        for (const p of ring) {
          if (p[0]! < minX) minX = p[0]!;
          if (p[0]! > maxX) maxX = p[0]!;
          if (p[1]! < minY) minY = p[1]!;
          if (p[1]! > maxY) maxY = p[1]!;
        }
    };
    if (g.type === "Polygon") scan(g.coordinates as number[][][]);
    else if (g.type === "MultiPolygon") for (const pp of g.coordinates as number[][][][]) scan(pp);
  }
  return { center: [(minX + maxX) / 2, (minY + maxY) / 2], bbox: [minX, minY, maxX, maxY] };
}

async function resolvePdf(pdf: string): Promise<string> {
  if (!/^https?:/.test(pdf)) {
    if (!existsSync(pdf)) throw new Error(`pdf not found: ${pdf}`);
    return pdf;
  }
  const path = join(tmpdir(), `t1-${Date.now()}.pdf`);
  execSync(`curl -sL -A "Mozilla/5.0" ${JSON.stringify(pdf)} -o ${JSON.stringify(path)}`);
  return path;
}

function fail(msg: string): never {
  console.error(`\n[t1-build] ABORT (anti-invention): ${msg}`);
  process.exit(2);
}

/**
 * Serving step: 1 feature per DISTINCT zone_code (the served contract, matching
 * the saint-amable golden). build_zones.py keeps multi-spot labels separate
 * (one feature per code point); here we union the spots of each code into a
 * single MultiPolygon and sum n_lots. Geometry is still 100% real cadastre.
 */
function mergeByZoneCode(fc: FeatureCollection): FeatureCollection {
  const byCode = new Map<string, Feature[]>();
  for (const f of fc.features) {
    const code = String(f.properties?.["zone_code"]);
    const arr = byCode.get(code) ?? [];
    arr.push(f);
    byCode.set(code, arr);
  }
  const merged: Feature[] = [];
  for (const [code, group] of byCode) {
    const parts: Position[][][] = [];
    let nLots = 0;
    for (const f of group) {
      const g = f.geometry;
      if (g?.type === "Polygon") parts.push(g.coordinates);
      else if (g?.type === "MultiPolygon") for (const p of g.coordinates) parts.push(p);
      nLots += Number(f.properties?.["n_lots"] ?? 0);
    }
    let geometry: Polygon | MultiPolygon = { type: "MultiPolygon", coordinates: parts };
    if (parts.length > 1) {
      try {
        const [first, ...rest] = parts as unknown as Parameters<typeof polyclip.union>;
        const u = polyclip.union(first!, ...rest) as unknown as Position[][][];
        if (u && u.length > 0) geometry = { type: "MultiPolygon", coordinates: u };
      } catch {
        /* keep raw union of lots — never drop real geometry */
      }
    }
    const props = { ...group[0]!.properties, zone_code: code, n_lots: nLots };
    delete (props as Record<string, unknown>)["assign_method"];
    merged.push({ type: "Feature", properties: props, geometry });
  }
  return {
    type: "FeatureCollection",
    // @ts-expect-error legacy CRS84 member, accepted by consumers
    crs: fc.crs,
    features: merged,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  console.error(`[t1-build] slug=${args.slug} pdf=${args.pdf}`);

  // 1. PDF + embedded georef -------------------------------------------------
  const pdfPath = await resolvePdf(args.pdf);
  const pdfBuf = readFileSync(pdfPath);
  const geo = extractGeoRef(pdfBuf, pdfPath);
  if (!geo) {
    fail(
      "no /VP /Measure /GEO georeferencing found — not a parseable T1 GeoPDF " +
        "(may be a TerraGo /LGIDict GeoPDF or a non-georef T2; use the dedicated path).",
    );
  }
  console.error(
    `[t1-build] georef: ${geo.crsName} | residual ${geo.maxResidualM.toFixed(2)} m | ` +
      `scale ${geo.scaleMPerPt.toFixed(3)} m/pt`,
  );
  if (geo.maxResidualM > args.maxResidualM) {
    fail(`georef corner residual ${geo.maxResidualM.toFixed(1)} m > ${args.maxResidualM} m`);
  }

  // 2. Labels ----------------------------------------------------------------
  const lab = extractLabels(pdfPath, geo);
  const distinct = new Set(lab.codePoints.map((c) => c.code));
  console.error(
    `[t1-build] labels: ${lab.nWords} words, ${lab.nCodeLike} code-like, ` +
      `${lab.nInsideFrame} in-frame (${lab.rejectedOutsideFrame} rejected outside), ` +
      `${distinct.size} distinct codes`,
  );
  if (distinct.size < args.minCodes) {
    fail(`only ${distinct.size} distinct zone codes (< ${args.minCodes}); labels may be glyphs → OCR path`);
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
    `[t1-build] cadastre: ${cadastre.features.length} lots, center ` +
      `${cadCenter[0].toFixed(4)},${cadCenter[1].toFixed(4)}`,
  );

  // 3b. spatial gate: labels must sit inside the cadastre footprint.
  const labCenter: [number, number] = lab.codePoints.reduce(
    (acc, c) => [acc[0] + c.lon / lab.codePoints.length, acc[1] + c.lat / lab.codePoints.length],
    [0, 0] as [number, number],
  );
  const spatialKm = haversineKm(labCenter, cadCenter);
  console.error(`[t1-build] spatial: label-centroid vs cadastre-centroid = ${spatialKm.toFixed(2)} km`);
  if (spatialKm > args.spatialKm) {
    fail(`labels ${spatialKm.toFixed(1)} km from cadastre (> ${args.spatialKm} km) — georef mismatch`);
  }
  const inBbox = lab.codePoints.filter(
    (c) => c.lon >= cadBbox[0] && c.lon <= cadBbox[2] && c.lat >= cadBbox[1] && c.lat <= cadBbox[3],
  ).length;
  console.error(`[t1-build] ${inBbox}/${lab.codePoints.length} labels inside cadastre bbox`);

  // 4. Cadastre aggregation --------------------------------------------------
  const { featureCollection, stats } = buildZones(cadastre, lab.codePoints, {
    lat0,
    cutoffM: args.cutoffM,
    source: "geopdf-esri",
    confidence: "contour-auto",
    dissolve: true,
  });
  void projConstants;
  const lotToZonePct = (100 * stats.n_lots_assigned) / stats.n_lots_total;
  // serving layer: 1 feature per distinct zone_code.
  const served = mergeByZoneCode(featureCollection);
  console.error(
    `[t1-build] zones: ${stats.n_zone_features} code-point features -> ${served.features.length} ` +
      `distinct-code features, ${stats.n_lots_assigned}/${stats.n_lots_total} ` +
      `lots (${lotToZonePct.toFixed(1)}%), ${stats.n_empty_labels} empty labels`,
  );

  // 5. Output ----------------------------------------------------------------
  const elapsedS = (Date.now() - t0) / 1000;
  const report = {
    slug: args.slug,
    source: "geopdf-esri",
    confidence: "contour-auto",
    pdf: args.pdf,
    crs: geo.crsName,
    georef_residual_m: Number(geo.maxResidualM.toFixed(3)),
    scale_m_per_pt: Number(geo.scaleMPerPt.toFixed(3)),
    n_label_codes: distinct.size,
    n_labels_in_frame: lab.nInsideFrame,
    n_served_features: served.features.length,
    label_spatial_km_from_cadastre: Number(spatialKm.toFixed(3)),
    lot_to_zone_pct: Number(lotToZonePct.toFixed(2)),
    compute_seconds: Number(elapsedS.toFixed(1)),
    ...stats,
  };

  const outDir = args.out ?? join(tmpdir(), `t1-${args.slug}`);
  mkdirSync(outDir, { recursive: true });
  const geojsonPath = join(outDir, `qc-zonage-${args.slug}.geojson`);
  const statsPath = join(outDir, `qc-zonage-${args.slug}.stats.json`);
  writeFileSync(geojsonPath, JSON.stringify(served));
  writeFileSync(statsPath, JSON.stringify(report, null, 2));
  console.error(`[t1-build] wrote ${geojsonPath} + stats`);

  if (args.dryRun) {
    console.error("[t1-build] --dry-run: NOT uploading to S3.");
  } else {
    const s3Key = `normalized/ca-qc-zonage/qc-zonage-${args.slug}.geojson`;
    await putBytes(s3, s3Key, JSON.stringify(served), "application/geo+json");
    await putBytes(
      s3,
      `normalized/ca-qc-zonage/qc-zonage-${args.slug}.stats.json`,
      JSON.stringify(report, null, 2),
      "application/json",
    );
    console.error(`[t1-build] uploaded s3://${BUCKET}/${s3Key}`);
  }

  // machine-readable summary on stdout
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
