/**
 * t2-serve-vision.ts — serve a T2 zoning plan from VISION-read positioned labels.
 *
 * Identical serving contract to t2-build.ts, but the label source is a JSON list
 * of human/vision-read {code, fx, fy} points (full-page fractions, fy top-down,
 * verbatim codes) instead of pdftotext / GPT-5.5. Used for flattened/raster plans
 * whose labels are not selectable text and where a single GPT crop under-reads a
 * dense map. Georef comes from a saved GCP/autogcp file; geometry is 100% real
 * cadastral lots via the UNCHANGED buildZones + mergeByZoneCode (zone-serve).
 *
 * Anti-invention: every served zone_code is verbatim from the supplied points,
 * gated for lettered form (no sequential #74), no affectation/CMM tokens, label
 * centroid within --spatial-km of the cadastre, and the georef residual gate.
 *
 * Usage:
 *   tsx src/t2-serve-vision.ts --slug montreal-ouest \
 *     --gcp work/gcp/montreal-ouest.autogcp.json \
 *     --points points.json --cadastre cad.geojson \
 *     [--pdf <url|path>] [--dry-run] [--out dir] \
 *     [--cutoff-m 1500] [--min-codes 10] [--max-residual-m 35] [--spatial-km 8]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FeatureCollection } from "geojson";

import { kindForPrefix, looksLikeZoneCode, splitCode } from "./lib/t1-labels.js";
import { buildZones, type CodePoint } from "./lib/t1-zones.js";
import { buildGeoRefFromGcpsCrs, type GcpFile, type NeatlineFrac } from "./lib/t2-georef.js";
import { BUCKET, getBytes, putBytes, s3Client } from "./lib/s3.js";
import { bboxCenter, haversineKm, mergeByZoneCode } from "./lib/zone-serve.js";

interface VisionPoint {
  code: string;
  fx: number;
  fy: number;
}

interface Args {
  slug: string;
  gcp: string;
  points: string;
  pdf?: string;
  cadastre?: string;
  dryRun: boolean;
  out?: string;
  cutoffM: number;
  minCodes: number;
  maxResidualM: number;
  spatialKm: number;
  source: string;
  confidence: string;
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
  if (!a["slug"] || !a["gcp"] || !a["points"]) {
    throw new Error("required: --slug <slug> --gcp <file> --points <points.json>");
  }
  return {
    slug: String(a["slug"]),
    gcp: String(a["gcp"]),
    points: String(a["points"]),
    pdf: a["pdf"] ? String(a["pdf"]) : undefined,
    cadastre: a["cadastre"] ? String(a["cadastre"]) : undefined,
    dryRun: Boolean(a["dry-run"]),
    out: a["out"] ? String(a["out"]) : undefined,
    cutoffM: a["cutoff-m"] ? Number(a["cutoff-m"]) : 1500,
    minCodes: a["min-codes"] ? Number(a["min-codes"]) : 10,
    maxResidualM: a["max-residual-m"] ? Number(a["max-residual-m"]) : 35,
    spatialKm: a["spatial-km"] ? Number(a["spatial-km"]) : 8,
    source: a["source"] ? String(a["source"]) : "t2-vision-gcp",
    confidence: a["confidence"] ? String(a["confidence"]) : "vision-positioned-autogcp",
  };
}

function fail(msg: string): never {
  console.error(`\n[t2-serve-vision] ABORT (anti-invention): ${msg}`);
  process.exit(2);
}

function inNeatline(fx: number, fy: number, n?: NeatlineFrac): boolean {
  if (!n) return true;
  return fx >= n.fx0 && fx <= n.fx1 && fy >= n.fy0 && fy <= n.fy1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  const gcpFile = JSON.parse(readFileSync(args.gcp, "utf8")) as GcpFile;
  const pageW = gcpFile.pageW!;
  const pageH = gcpFile.pageH!;
  if (!(pageW > 0) || !(pageH > 0)) fail("gcp file must carry pageW/pageH");

  const cal = buildGeoRefFromGcpsCrs(gcpFile.gcps, pageW, pageH, gcpFile.crs, gcpFile.neatline);
  const geo = cal.geo;
  console.error(
    `[t2-serve-vision] georef: ${gcpFile.gcps.length} GCPs | residual max ${cal.maxResidualM.toFixed(2)} m, ` +
      `rms ${cal.rmsResidualM.toFixed(2)} m | scale ${geo.scaleMPerPt.toFixed(3)} m/pt`,
  );
  if (cal.maxResidualM > args.maxResidualM) {
    fail(`georef residual ${cal.maxResidualM.toFixed(1)} m > ${args.maxResidualM} m`);
  }

  // ---- vision points -> code points (projected via georef) ----
  const raw = JSON.parse(readFileSync(args.points, "utf8")) as VisionPoint[] | { points: VisionPoint[] };
  const points = Array.isArray(raw) ? raw : raw.points;
  if (!Array.isArray(points) || points.length === 0) fail("points file empty");

  let nOutsideNeatline = 0;
  let nNotCodeLike = 0;
  const codePoints: CodePoint[] = [];
  for (const p of points) {
    const code = String(p.code ?? "").trim();
    const fx = Number(p.fx);
    const fy = Number(p.fy);
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) continue;
    if (!inNeatline(fx, fy, gcpFile.neatline)) {
      nOutsideNeatline++;
      continue;
    }
    if (!looksLikeZoneCode(code)) {
      nNotCodeLike++;
      continue;
    }
    const [lon, lat] = geo.topLeftToLonLat(fx * pageW, fy * pageH);
    const { prefix } = splitCode(code);
    codePoints.push({ code, prefix, kind: kindForPrefix(prefix), lon, lat });
  }
  const distinct = new Set(codePoints.map((c) => c.code));
  console.error(
    `[t2-serve-vision] points: ${points.length} given, ${codePoints.length} in-frame code-like ` +
      `(${nOutsideNeatline} outside neatline, ${nNotCodeLike} not code-like), ${distinct.size} distinct`,
  );
  const minCodes = Math.max(3, args.minCodes);
  if (distinct.size < minCodes) fail(`only ${distinct.size} distinct codes (< ${minCodes})`);

  const banned = /^(affectation|cmm|mrc|sad|pmad)/i;
  const nonLettered = [...distinct].filter((c) => !/[A-Za-z]/.test(c) || !/\d/.test(c));
  const bannedHit = [...distinct].filter((c) => banned.test(c));
  if (nonLettered.length > 0) fail(`non-lettered (sequential?) codes: ${nonLettered.slice(0, 8).join(", ")}`);
  if (bannedHit.length > 0) fail(`affectation/CMM tokens: ${bannedHit.join(", ")}`);

  // ---- cadastre ----
  const cadKey = args.cadastre ?? `normalized/qc-cadastre-lots/${args.slug}.geojson`;
  let cadBuf: Buffer;
  const s3 = s3Client();
  if (args.cadastre && existsSync(args.cadastre)) cadBuf = readFileSync(args.cadastre);
  else cadBuf = await getBytes(s3, cadKey);
  const cadastre = JSON.parse(cadBuf.toString("utf8")) as FeatureCollection;
  const { center: cadCenter, bbox: cadBbox } = bboxCenter(cadastre);
  const lat0 = (cadBbox[1] + cadBbox[3]) / 2;
  console.error(`[t2-serve-vision] cadastre: ${cadastre.features.length} lots, center ${cadCenter[0].toFixed(4)},${cadCenter[1].toFixed(4)}`);

  const labCenter: [number, number] = codePoints.reduce(
    (acc, c) => [acc[0] + c.lon / codePoints.length, acc[1] + c.lat / codePoints.length],
    [0, 0] as [number, number],
  );
  const spatialKm = haversineKm(labCenter, cadCenter);
  console.error(`[t2-serve-vision] spatial: label-centroid vs cadastre-centroid = ${spatialKm.toFixed(2)} km`);
  if (spatialKm > args.spatialKm) fail(`labels ${spatialKm.toFixed(1)} km from cadastre (> ${args.spatialKm} km)`);
  const inBbox = codePoints.filter(
    (c) => c.lon >= cadBbox[0] && c.lon <= cadBbox[2] && c.lat >= cadBbox[1] && c.lat <= cadBbox[3],
  ).length;
  console.error(`[t2-serve-vision] ${inBbox}/${codePoints.length} labels inside cadastre bbox`);

  // ---- UNCHANGED T1 aggregation + serving contract ----
  const { featureCollection, stats } = buildZones(cadastre, codePoints, {
    lat0,
    cutoffM: args.cutoffM,
    source: args.source,
    confidence: args.confidence,
    dissolve: true,
  });
  const lotToZonePct = (100 * stats.n_lots_assigned) / stats.n_lots_total;
  const served = mergeByZoneCode(featureCollection);
  console.error(
    `[t2-serve-vision] zones: ${stats.n_zone_features} code-point features -> ${served.features.length} ` +
      `distinct-code features, ${stats.n_lots_assigned}/${stats.n_lots_total} lots (${lotToZonePct.toFixed(1)}%), ` +
      `${stats.n_empty_labels} empty labels`,
  );

  const elapsedS = (Date.now() - t0) / 1000;
  const report = {
    slug: args.slug,
    source: args.source,
    confidence: args.confidence,
    pdf: args.pdf,
    label_mode: "vision-positioned",
    crs: geo.crsName,
    n_gcps: gcpFile.gcps.length,
    gcp_residual_max_m: Number(cal.maxResidualM.toFixed(3)),
    gcp_residual_rms_m: Number(cal.rmsResidualM.toFixed(3)),
    scale_m_per_pt: Number(geo.scaleMPerPt.toFixed(3)),
    n_vision_points: points.length,
    n_label_codes: distinct.size,
    n_labels_in_frame: codePoints.length,
    n_served_features: served.features.length,
    label_spatial_km_from_cadastre: Number(spatialKm.toFixed(3)),
    lot_to_zone_pct: Number(lotToZonePct.toFixed(2)),
    compute_seconds: Number(elapsedS.toFixed(1)),
    ...stats,
  };

  const outDir = args.out ?? join(tmpdir(), `t2v-${args.slug}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `qc-zonage-${args.slug}.geojson`), JSON.stringify(served));
  writeFileSync(join(outDir, `qc-zonage-${args.slug}.stats.json`), JSON.stringify(report, null, 2));
  console.error(`[t2-serve-vision] wrote ${join(outDir, `qc-zonage-${args.slug}.geojson`)} + stats`);

  if (args.dryRun) {
    console.error("[t2-serve-vision] --dry-run: NOT uploading to S3.");
  } else {
    const s3Key = `normalized/ca-qc-zonage/qc-zonage-${args.slug}.geojson`;
    await putBytes(s3, s3Key, JSON.stringify(served), "application/geo+json");
    await putBytes(s3, `normalized/ca-qc-zonage/qc-zonage-${args.slug}.stats.json`, JSON.stringify(report, null, 2), "application/json");
    console.error(`[t2-serve-vision] uploaded s3://${BUCKET}/${s3Key}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
