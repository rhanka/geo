/**
 * t1-ocr-build.ts — T1 zoning for a GEOREFERENCED *glyph* GeoPDF (labels drawn
 * as vector outlines, not selectable text), via the OCR-VALIDATED label path.
 *
 *   glyph GeoPDF (embedded georef)  +  authoritative zone-code dictionary
 *      → embedded page→WGS84 transform        (t1-georef)
 *      → tiled tesseract OCR, each code-like token SNAPPED to the dictionary
 *        (exact, or unambiguous edit-distance 1) — ambiguous/no-match dropped
 *                                                  (t1-labels-ocr)
 *      → cadastre line-of-sight nearest-label aggregation       (t1-zones)
 *      → 1 MultiPolygon / zone, WGS84  →  normalized/ca-qc-zonage/qc-zonage-<slug>.geojson
 *
 * This is the sibling of `t1-build.ts`: same georef + cadastre + serving
 * contract, but the labels come from OCR validated against a real regulatory
 * code list instead of `pdftotext`. Use it when `pdffonts` is empty (glyph map).
 *
 * ANTI-INVENTION: every emitted zone_code is verbatim from `--dict` (the
 * municipality's own by-law), kept only where an OCR token maps to it
 * UNAMBIGUOUSLY; every output ring is a real cadastral lot. A failing gate
 * ABORTS — it never fabricates or serves a guessed code.
 *
 * Usage:
 *   tsx src/t1-ocr-build.ts --slug pointe-claire --pdf <url|path> \
 *       --dict <codes.json> [--region x0,y0,x1,y1] [--dpi 250] [--dry-run] \
 *       [--out <dir>] [--cutoff-m 1500] [--min-codes 10] [--min-snap-pct 50] \
 *       [--max-residual-m 50] [--spatial-km 8]
 *   (--dict: JSON array of codes, or { "codes": [...] }.)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from "geojson";
import * as polyclip from "polyclip-ts";

import { extractGeoRef } from "./lib/t1-georef.js";
import { extractLabelsOcr } from "./lib/t1-labels-ocr.js";
import { buildZones, projConstants } from "./lib/t1-zones.js";
import { s3Client, getBytes, putBytes, BUCKET } from "./lib/s3.js";

interface Args {
  slug: string;
  pdf: string;
  dict: string;
  dryRun: boolean;
  out?: string;
  region?: [number, number, number, number];
  dpi: number;
  cutoffM: number;
  minCodes: number;
  minSnapPct: number;
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
  if (!a["slug"] || !a["pdf"] || !a["dict"]) throw new Error("required: --slug --pdf --dict");
  let region: [number, number, number, number] | undefined;
  if (typeof a["region"] === "string") {
    const r = a["region"].split(",").map(Number);
    if (r.length === 4 && r.every((x) => Number.isFinite(x))) region = r as [number, number, number, number];
  }
  return {
    slug: String(a["slug"]),
    pdf: String(a["pdf"]),
    dict: String(a["dict"]),
    dryRun: Boolean(a["dry-run"]),
    out: a["out"] ? String(a["out"]) : undefined,
    region,
    dpi: a["dpi"] ? Number(a["dpi"]) : 250,
    cutoffM: a["cutoff-m"] ? Number(a["cutoff-m"]) : 1500,
    minCodes: a["min-codes"] ? Number(a["min-codes"]) : 10,
    minSnapPct: a["min-snap-pct"] ? Number(a["min-snap-pct"]) : 50,
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
  const path = join(tmpdir(), `t1ocr-${Date.now()}.pdf`);
  const res = await fetch(pdf, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`failed to download pdf ${pdf}: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

function loadDict(path: string): { codes: string[]; kindByPrefix?: Record<string, string> } {
  const j = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const codes = Array.isArray(j) ? j : (j as { codes?: unknown }).codes;
  if (!Array.isArray(codes)) throw new Error("--dict must be a JSON array of codes or { codes: [...] }");
  const kindByPrefix =
    !Array.isArray(j) && (j as { kindByPrefix?: Record<string, string> }).kindByPrefix
      ? (j as { kindByPrefix: Record<string, string> }).kindByPrefix
      : undefined;
  return { codes: codes.map(String), kindByPrefix };
}

function fail(msg: string): never {
  console.error(`\n[t1-ocr-build] ABORT (anti-invention): ${msg}`);
  process.exit(2);
}

/** 1 feature per DISTINCT zone_code (union of its spots). Geometry stays real cadastre. */
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
  console.error(`[t1-ocr-build] slug=${args.slug} pdf=${args.pdf} dpi=${args.dpi}`);

  // 1. PDF + embedded georef -------------------------------------------------
  const pdfPath = await resolvePdf(args.pdf);
  const pdfBuf = readFileSync(pdfPath);
  const geo = extractGeoRef(pdfBuf, pdfPath);
  if (!geo) fail("no embedded georeferencing (/VP /Measure /GEO /GPTS) — not a T1 GeoPDF.");
  console.error(
    `[t1-ocr-build] georef: ${geo.crsName} | residual ${geo.maxResidualM.toFixed(2)} m | ` +
      `scale ${geo.scaleMPerPt.toFixed(3)} m/pt`,
  );
  if (geo.maxResidualM > args.maxResidualM) {
    fail(`georef corner residual ${geo.maxResidualM.toFixed(1)} m > ${args.maxResidualM} m`);
  }

  // 2. OCR-validated labels --------------------------------------------------
  const { codes: dict, kindByPrefix } = loadDict(args.dict);
  console.error(`[t1-ocr-build] dictionary: ${dict.length} authoritative codes (${args.dict})`);
  const lab = await extractLabelsOcr(pdfPath, geo, dict, {
    dpi: args.dpi,
    region: args.region,
    ...(kindByPrefix ? { kindByPrefix } : {}),
  });
  console.error(
    `[t1-ocr-build] ocr: ${lab.nTiles} tiles, ${lab.nReads} reads, ${lab.nCodeLike} code-like, ` +
      `${lab.nExact} exact + ${lab.nDistance1} d=1 snapped, ${lab.nRejected} rejected ` +
      `(snap-rate ${lab.snapRatePct}%), ${lab.nKept} kept, ${lab.nDistinct} distinct codes`,
  );
  console.error(`[t1-ocr-build] reject reasons: ${lab.rejectSamples.join(" | ")}`);

  if (lab.snapRatePct < args.minSnapPct) {
    fail(`snap-rate ${lab.snapRatePct}% < ${args.minSnapPct}% — OCR too noisy / dictionary mismatch`);
  }
  if (lab.nDistinct < args.minCodes) {
    fail(`only ${lab.nDistinct} distinct validated codes (< ${args.minCodes})`);
  }
  // anti-#74 + anti-affectation (codes come from the dict, but re-assert).
  const distinct = [...new Set(lab.codePoints.map((c) => c.code))];
  const banned = /^(affectation|cmm|mrc|sad|pmad)/i;
  const nonLettered = distinct.filter((c) => !/[A-Za-z]/.test(c) || !/\d/.test(c));
  const bannedHit = distinct.filter((c) => banned.test(c));
  if (nonLettered.length > 0) fail(`non-lettered codes present: ${nonLettered.slice(0, 8).join(", ")}`);
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
    `[t1-ocr-build] cadastre: ${cadastre.features.length} lots, center ` +
      `${cadCenter[0].toFixed(4)},${cadCenter[1].toFixed(4)}`,
  );

  // 3b. spatial gate: labels must sit inside the cadastre footprint.
  const labCenter: [number, number] = lab.codePoints.reduce(
    (acc, c) => [acc[0] + c.lon / lab.codePoints.length, acc[1] + c.lat / lab.codePoints.length],
    [0, 0] as [number, number],
  );
  const spatialKm = haversineKm(labCenter, cadCenter);
  console.error(`[t1-ocr-build] spatial: label-centroid vs cadastre-centroid = ${spatialKm.toFixed(2)} km`);
  if (spatialKm > args.spatialKm) {
    fail(`labels ${spatialKm.toFixed(1)} km from cadastre (> ${args.spatialKm} km) — georef mismatch`);
  }

  // 4. Cadastre aggregation --------------------------------------------------
  const { featureCollection, stats } = buildZones(cadastre, lab.codePoints, {
    lat0,
    cutoffM: args.cutoffM,
    source: "geopdf-ocr-validated",
    confidence: "contour-auto",
    dissolve: true,
  });
  void projConstants;
  const lotToZonePct = (100 * stats.n_lots_assigned) / stats.n_lots_total;
  const served = mergeByZoneCode(featureCollection);
  console.error(
    `[t1-ocr-build] zones: ${stats.n_zone_features} code-point features -> ${served.features.length} ` +
      `distinct-code features, ${stats.n_lots_assigned}/${stats.n_lots_total} ` +
      `lots (${lotToZonePct.toFixed(1)}%)`,
  );

  // 5. Output ----------------------------------------------------------------
  const elapsedS = (Date.now() - t0) / 1000;
  const report = {
    slug: args.slug,
    source: "geopdf-ocr-validated",
    confidence: "contour-auto",
    pdf: args.pdf,
    crs: geo.crsName,
    georef_residual_m: Number(geo.maxResidualM.toFixed(3)),
    dict_size: dict.length,
    ocr_dpi: args.dpi,
    ocr_code_like: lab.nCodeLike,
    ocr_exact: lab.nExact,
    ocr_distance1: lab.nDistance1,
    ocr_rejected: lab.nRejected,
    snap_rate_pct: lab.snapRatePct,
    n_label_codes: lab.nDistinct,
    n_labels_kept: lab.nKept,
    n_served_features: served.features.length,
    label_spatial_km_from_cadastre: Number(spatialKm.toFixed(3)),
    lot_to_zone_pct: Number(lotToZonePct.toFixed(2)),
    compute_seconds: Number(elapsedS.toFixed(1)),
    ...stats,
  };

  const outDir = args.out ?? join(tmpdir(), `t1ocr-${args.slug}`);
  mkdirSync(outDir, { recursive: true });
  const geojsonPath = join(outDir, `qc-zonage-${args.slug}.geojson`);
  const statsPath = join(outDir, `qc-zonage-${args.slug}.stats.json`);
  writeFileSync(geojsonPath, JSON.stringify(served));
  writeFileSync(statsPath, JSON.stringify(report, null, 2));
  console.error(`[t1-ocr-build] wrote ${geojsonPath} + stats`);

  if (args.dryRun) {
    console.error("[t1-ocr-build] --dry-run: NOT uploading to S3.");
  } else {
    const s3Key = `normalized/ca-qc-zonage/qc-zonage-${args.slug}.geojson`;
    await putBytes(s3, s3Key, JSON.stringify(served), "application/geo+json");
    await putBytes(
      s3,
      `normalized/ca-qc-zonage/qc-zonage-${args.slug}.stats.json`,
      JSON.stringify(report, null, 2),
      "application/json",
    );
    console.error(`[t1-ocr-build] uploaded s3://${BUCKET}/${s3Key}`);
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
