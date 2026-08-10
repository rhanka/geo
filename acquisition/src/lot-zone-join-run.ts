/**
 * lot-zone-join-run.ts -- per-municipality LOT -> ZONE -> NORMS product.
 *
 * Orchestration only: reads S3 inputs, reprojects WGS84 GeoJSON into a local
 * metric frame, calls the pure @sentropic/geo lot-zone join, writes parquet and
 * stats back to S3. The library owns no I/O.
 *
 * Pilot:
 *   tsx src/lot-zone-join-run.ts --pilot
 * Verify existing deposits:
 *   tsx src/lot-zone-join-run.ts --pilot --verify-only
 *
 * `--simplify-zones-m N` simplifies and explodes zone geometries in memory only
 * before intersection. It leaves the served zones GeoJSON unchanged, and is useful
 * for very detailed official layers whose raw rings make Turf clipping impractical.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { S3Client } from "@aws-sdk/client-s3";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";
import {
  assignLotZones,
  canonicalizeZoneCodeForJoin,
  enrichWithNorms,
  normalizeZoneCode,
  type LotZoneNormAssignment,
  type NormsRecord,
  type PolygonalFeature,
} from "@sentropic/geo";

import { readParquetRows, readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { buildServedZoneIndex, lotCentroidOutsideAllServedZones } from "./lot-zone-consistency-audit.js";
import { norm as normCadastreSlug } from "./cadastre-clip-sda.js";
import { BUCKET, exists, getBytes, getGeoJsonFeatureCollection, getJson, listSlugs, putBytes, s3Client } from "./lib/s3.js";
import { projConstants } from "./lib/t1-zones.js";

const PILOT_SLUGS = ["windsor", "arundel", "coteau-du-lac", "hudson", "granby"] as const;

const CAD_PREFIX = "normalized/qc-cadastre-lots/";
const ZONES_PREFIX = "normalized/ca-qc-zonage/";
const NORMS_PREFIX = "registry/qc-zonage-norms/";
const OUT_PREFIX = "normalized/qc-lot-zonage/";

const CADASTRE_SLUG_ALIASES: Record<string, string[]> = {
  "l-epiphanie": ["lepiphanie"],
  "l-assomption": ["lassomption"],
  "l-ange-gardien": ["lange-gardien--la-cote-de-beaupre"],
  "sainte-christine-d-auvergne": ["sainte-christine-dauvergne"],
};

const LOT_ZONE_SCHEMA = new ParquetSchema({
  lot_id: { type: "UTF8", compression: "SNAPPY" },
  zone_code: { type: "UTF8", optional: true, compression: "SNAPPY" },
  dominant_fraction: { type: "DOUBLE", compression: "SNAPPY" },
  multi_zone: { type: "BOOLEAN", compression: "SNAPPY" },
  zone_codes: { type: "UTF8", repeated: true, compression: "SNAPPY" },
  assignment_method: { type: "UTF8", compression: "SNAPPY" },
  norms: { type: "UTF8", optional: true, compression: "SNAPPY" },
});

interface Args {
  slugs: string[];
  noUpload: boolean;
  verifyOnly: boolean;
  all: boolean;
  shard: { index: number; total: number } | null;
  simplifyZonesM: number;
}

interface RecalageStats {
  key: string;
  n_lots_total?: number;
  n_lots_assigned?: number;
  lot_coverage_pct?: number;
  pct_area_covered?: number;
}

interface LotZoneStats {
  slug: string;
  input_keys: {
    cadastre: string;
    zones: string;
    norms: string | null;
    recalage_stats: string | null;
  };
  output_keys: {
    parquet: string;
    stats: string;
  };
  metric_crs: {
    method: "local-equirectangular";
    lon0: number;
    lat0: number;
    meters_per_degree_lon: number;
    meters_per_degree_lat: number;
  };
  num_lots: number;
  num_assigned: number;
  pct_assigned: number;
  num_multi_zone: number;
  pct_multi_zone: number;
  num_without_norms: number;
  pct_without_norms: number;
  zone_code_match_rate: number;
  distinct_zone_codes_assigned: number;
  distinct_zone_codes_with_norms: number;
  warnings: string[];
  recalage: RecalageStats | null;
  examples: Array<{
    lot_id: string;
    zone_code: string;
    normalized_zone_code: string;
    dominant_fraction: number;
    norm_fields: Record<string, unknown>;
  }>;
  verified_deposit?: {
    parquet_exists: boolean;
    stats_exists: boolean;
    parquet_rows: number;
  };
}

type GeoFeature = Feature<Geometry, Record<string, unknown> | null>;
type GeoFc = FeatureCollection<Geometry, Record<string, unknown> | null>;

function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let pilot = false;
  let noUpload = false;
  let verifyOnly = false;
  let all = false;
  let shard: { index: number; total: number } | null = null;
  let simplifyZonesM = 0;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--pilot") pilot = true;
    else if (arg === "--all") all = true;
    else if (arg === "--slug") slugs.push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--slugs") slugs.push(...String(argv[++i] ?? "").split(",").filter(Boolean));
    else if (arg === "--no-upload") noUpload = true;
    else if (arg === "--verify-only") verifyOnly = true;
    else if (arg === "--simplify-zones-m") simplifyZonesM = Math.max(0, Number(argv[++i] ?? "0") || 0);
    else if (arg === "--shard") {
      const spec = String(argv[++i] ?? "");
      const [idx, total] = spec.split("/").map((v) => parseInt(v, 10));
      if (!Number.isInteger(idx) || !Number.isInteger(total) || total <= 0 || idx < 0 || idx >= total) {
        throw new Error(`--shard expects i/n with 0<=i<n, got "${spec}"`);
      }
      shard = { index: idx, total };
    } else throw new Error(`unknown argument: ${arg}`);
  }

  if (pilot) slugs.push(...PILOT_SLUGS);
  const uniqueSlugs = [...new Set(slugs)];
  if (uniqueSlugs.length === 0 && !all) {
    throw new Error("pass --all, --pilot, --slug <slug>, or --slugs <a,b>");
  }
  return { slugs: uniqueSlugs, noUpload, verifyOnly, all, shard, simplifyZonesM };
}

function outParquetKey(slug: string): string {
  return `${OUT_PREFIX}${slug}.parquet`;
}

function outStatsKey(slug: string): string {
  return `${OUT_PREFIX}${slug}.stats.json`;
}

async function resolveFirstExisting(s3: S3Client, keys: string[]): Promise<string | null> {
  for (const key of keys) {
    if (await exists(s3, key)) return key;
  }
  return null;
}

async function resolveCadastreKey(s3: S3Client, slug: string): Promise<string> {
  const candidates = [slug, ...(CADASTRE_SLUG_ALIASES[slug] ?? [])];
  for (const candidate of candidates) {
    const key = `${CAD_PREFIX}${candidate}.geojson`;
    if (await exists(s3, key)) return key;
  }
  const key = `${CAD_PREFIX}${slug}.geojson`;
  const slugs = await listSlugs(s3, CAD_PREFIX, ".geojson", true);
  const normalizedTargets = new Set(candidates.map((candidate) => normCadastreSlug(candidate)));
  const normalizedMatches = slugs.filter((candidate) => normalizedTargets.has(normCadastreSlug(candidate)));
  if (normalizedMatches.length === 1) return `${CAD_PREFIX}${normalizedMatches[0]}.geojson`;
  const containsMatches = slugs.filter((candidate) =>
    [...normalizedTargets].some((target) => normCadastreSlug(candidate).includes(target)),
  );
  if (containsMatches.length === 1) return `${CAD_PREFIX}${containsMatches[0]}.geojson`;
  const ambiguousCandidates = containsMatches.length > 0 ? containsMatches : normalizedMatches;
  throw new Error(
    `cadastre not found for ${slug}: ${key}` +
      (ambiguousCandidates.length > 0 ? `; ambiguous candidates: ${ambiguousCandidates.slice(0, 12).join(", ")}` : ""),
  );
}

async function resolveZonesKey(s3: S3Client, slug: string): Promise<string> {
  const key = await resolveFirstExisting(s3, [
    `${ZONES_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONES_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ]);
  if (!key) throw new Error(`zones not found for ${slug} under ${ZONES_PREFIX}`);
  return key;
}

/** Le registre normes suit la MÊME table d'alias que le cadastre : une muni dont
 *  le cadastre vit sous la graphie plate ("lassomption") est aussi servie sous le
 *  slug à tirets ("l-assomption"), et son registre normes n'est déposé que sous la
 *  graphie plate. Sans ce repli, la jointure du doublon à tirets trouve zone_code
 *  mais AUCUNE norme → `folded-normes=0%` sur un dépôt pourtant servi. */
async function resolveNormsKey(s3: S3Client, slug: string): Promise<string | null> {
  return resolveFirstExisting(
    s3,
    [slug, ...(CADASTRE_SLUG_ALIASES[slug] ?? [])].map((c) => `${NORMS_PREFIX}qc-zonage-norms-${c}.parquet`),
  );
}

async function resolveRecalageStatsKey(s3: S3Client, slug: string): Promise<string | null> {
  return resolveFirstExisting(s3, [
    `${ZONES_PREFIX}qc-zonage-${slug}.stats.json`,
    `${ZONES_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.stats.json`,
  ]);
}

function polygonalFeatures(fc: GeoFc, label: string): PolygonalFeature[] {
  const out: PolygonalFeature[] = [];
  for (const f of fc.features ?? []) {
    if (!f.geometry) continue;
    if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") continue;
    out.push(f as PolygonalFeature);
  }
  if (out.length === 0) throw new Error(`${label} has no polygonal features`);
  return out;
}

function zoneCodeOf(feature: PolygonalFeature): string {
  const props = feature.properties ?? {};
  for (const key of ["zone_code", "code_zone", "ZONE_CODE", "CODE_ZONE", "NO_ZONAGE", "no_zone", "NOZONE"]) {
    const value = props[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return "";
}

function lotIdOf(feature: PolygonalFeature, index: number): string {
  const props = feature.properties ?? {};
  for (const key of ["lot_id", "LOT_ID", "NO_LOT", "no_lot", "noLot", "geoId", "id"]) {
    const value = props[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return String(index);
}

function localMetricContext(features: PolygonalFeature[]): LotZoneStats["metric_crs"] {
  const bbox = bboxOfFeatures(features);
  const lon0 = (bbox[0] + bbox[2]) / 2;
  const lat0 = (bbox[1] + bbox[3]) / 2;
  const { mlon, mlat } = projConstants(lat0);
  return {
    method: "local-equirectangular",
    lon0: round6(lon0),
    lat0: round6(lat0),
    meters_per_degree_lon: mlon,
    meters_per_degree_lat: mlat,
  };
}

function projectFeatures(features: PolygonalFeature[], crs: LotZoneStats["metric_crs"]): PolygonalFeature[] {
  const projectPosition = (position: Position): Position => [
    (position[0]! - crs.lon0) * crs.meters_per_degree_lon,
    (position[1]! - crs.lat0) * crs.meters_per_degree_lat,
    ...position.slice(2),
  ];
  const projectRing = (ring: Position[]): Position[] => ring.map(projectPosition);
  const projectPoly = (poly: Position[][]): Position[][] => poly.map(projectRing);
  const projectGeom = (geometry: Polygon | MultiPolygon): Polygon | MultiPolygon => {
    if (geometry.type === "Polygon") return { type: "Polygon", coordinates: projectPoly(geometry.coordinates) };
    return { type: "MultiPolygon", coordinates: geometry.coordinates.map(projectPoly) };
  };
  return features.map((feature) => ({
    ...feature,
    geometry: projectGeom(feature.geometry),
  }));
}

function simplifyFeatures(features: PolygonalFeature[], tolerance: number): PolygonalFeature[] {
  if (!(tolerance > 0)) return features;
  const out: PolygonalFeature[] = [];
  for (const feature of features) {
    if (feature.geometry.type === "Polygon") {
      out.push({
        ...feature,
        geometry: { type: "Polygon", coordinates: simplifyPolygon(feature.geometry.coordinates, tolerance) },
      });
    } else {
      for (const poly of feature.geometry.coordinates) {
        out.push({
          ...feature,
          geometry: { type: "Polygon", coordinates: simplifyPolygon(poly, tolerance) },
        });
      }
    }
  }
  return out;
}

function simplifyPolygon(poly: Position[][], tolerance: number): Position[][] {
  return poly.map((ring) => simplifyRing(ring, tolerance));
}

function simplifyRing(ring: Position[], tolerance: number): Position[] {
  if (ring.length <= 4) return ring;
  const closed = samePoint(ring[0]!, ring[ring.length - 1]!);
  const open = closed ? ring.slice(0, -1) : ring.slice();
  if (open.length <= 3) return ring;
  const simplified = rdp(open, tolerance);
  if (simplified.length < 3) return ring;
  const out = closed ? [...simplified, simplified[0]!] : simplified;
  return out.length >= 4 ? out : ring;
}

function rdp(points: Position[], tolerance: number): Position[] {
  if (points.length <= 2) return points;
  let maxDist = -1;
  let split = -1;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      split = i;
    }
  }
  if (maxDist <= tolerance || split < 0) return [first, last];
  const left = rdp(points.slice(0, split + 1), tolerance);
  const right = rdp(points.slice(split), tolerance);
  return [...left.slice(0, -1), ...right];
}

function perpendicularDistance(point: Position, start: Position, end: Position): number {
  const x = point[0]!, y = point[1]!;
  const x1 = start[0]!, y1 = start[1]!;
  const x2 = end[0]!, y2 = end[1]!;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function samePoint(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function bboxOfFeatures(features: PolygonalFeature[]): [number, number, number, number] {
  const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const scanRing = (ring: Position[]): void => {
    for (const position of ring) {
      const x = position[0]!;
      const y = position[1]!;
      if (x < bbox[0]) bbox[0] = x;
      if (y < bbox[1]) bbox[1] = y;
      if (x > bbox[2]) bbox[2] = x;
      if (y > bbox[3]) bbox[3] = y;
    }
  };
  const scanPoly = (poly: Position[][]): void => {
    for (const ring of poly) scanRing(ring);
  };
  for (const feature of features) {
    if (feature.geometry.type === "Polygon") scanPoly(feature.geometry.coordinates);
    else for (const poly of feature.geometry.coordinates) scanPoly(poly);
  }
  return bbox;
}

async function loadNorms(
  s3: S3Client,
  normsKey: string | null,
): Promise<{ rows: Record<string, unknown>[]; byCode: Map<string, NormsRecord> }> {
  if (!normsKey) return { rows: [], byCode: new Map() };
  const rows = await readParquetRowsFromBuffer(await getBytes(s3, normsKey));
  const byCode = new Map<string, NormsRecord>();
  for (const row of rows) {
    const code = row["zone_code"];
    if (code === null || code === undefined || !String(code).trim()) continue;
    // Key the grille by the join-canonical code so H01/H-01/H 1 fold to the
    // same bucket the zones layer's H-1 will look up (enrichWithNorms applies
    // the same canon on both sides; keying here also dedups grille duplicates).
    const canonical = canonicalizeZoneCodeForJoin(code);
    if (!byCode.has(canonical)) byCode.set(canonical, row);
  }
  return { rows, byCode };
}

async function loadRecalageStats(
  s3: S3Client,
  key: string | null,
): Promise<RecalageStats | null> {
  if (!key) return null;
  const raw = (await getJson(s3, key)) as Record<string, unknown>;
  const nLotsTotal = numberField(raw, "n_lots_total");
  const nLotsAssigned = numberField(raw, "n_lots_assigned");
  const lotCoveragePct =
    nLotsTotal && nLotsAssigned !== null ? round2((100 * nLotsAssigned) / nLotsTotal) : numberField(raw, "lot_coverage_pct");
  return {
    key,
    ...(nLotsTotal !== null ? { n_lots_total: nLotsTotal } : {}),
    ...(nLotsAssigned !== null ? { n_lots_assigned: nLotsAssigned } : {}),
    ...(lotCoveragePct !== null ? { lot_coverage_pct: lotCoveragePct } : {}),
    ...(numberField(raw, "pct_area_covered") !== null ? { pct_area_covered: numberField(raw, "pct_area_covered")! } : {}),
  };
}

function numberField(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildStats(
  slug: string,
  inputKeys: LotZoneStats["input_keys"],
  metricCrs: LotZoneStats["metric_crs"],
  assignments: LotZoneNormAssignment[],
  recalage: RecalageStats | null,
): LotZoneStats {
  const numLots = assignments.length;
  const assigned = assignments.filter((a) => a.zoneCode !== null);
  const multi = assignments.filter((a) => a.multiZone);
  const withNorms = assigned.filter((a) => a.norms !== null);
  const withoutNorms = assigned.length - withNorms.length;
  const distinctAssigned = new Set(assigned.map((a) => normalizeZoneCode(a.zoneCode)));
  const distinctWithNorms = new Set(withNorms.map((a) => normalizeZoneCode(a.zoneCode)));
  const matchRate = assigned.length ? (100 * withNorms.length) / assigned.length : 0;
  const warnings: string[] = [];
  if (assigned.length > 0 && matchRate < 95) {
    warnings.push(`zone_code norm match rate ${round2(matchRate)}% < 95%`);
  }
  const pctAssigned = numLots ? (100 * assigned.length) / numLots : 0;
  if (pctAssigned < 70) warnings.push(`assigned lots ${round2(pctAssigned)}% < 70%`);
  if (recalage?.lot_coverage_pct !== undefined && Math.abs(pctAssigned - recalage.lot_coverage_pct) > 15) {
    warnings.push(
      `assigned lots ${round2(pctAssigned)}% differs from recalage lot coverage ${recalage.lot_coverage_pct}% by >15pt`,
    );
  }

  const examples = withNorms.slice(0, 3).map((assignment) => ({
    lot_id: assignment.lotId,
    zone_code: assignment.zoneCode!,
    normalized_zone_code: normalizeZoneCode(assignment.zoneCode),
    dominant_fraction: round4(assignment.dominantFraction),
    norm_fields: previewNorms(assignment.norms),
  }));

  return {
    slug,
    input_keys: inputKeys,
    output_keys: {
      parquet: outParquetKey(slug),
      stats: outStatsKey(slug),
    },
    metric_crs: metricCrs,
    num_lots: numLots,
    num_assigned: assigned.length,
    pct_assigned: round2(pctAssigned),
    num_multi_zone: multi.length,
    pct_multi_zone: numLots ? round2((100 * multi.length) / numLots) : 0,
    num_without_norms: withoutNorms,
    pct_without_norms: assigned.length ? round2((100 * withoutNorms) / assigned.length) : 0,
    zone_code_match_rate: round2(matchRate),
    distinct_zone_codes_assigned: distinctAssigned.size,
    distinct_zone_codes_with_norms: distinctWithNorms.size,
    warnings,
    recalage,
    examples,
  };
}

function previewNorms(norms: NormsRecord | null): Record<string, unknown> {
  if (!norms) return {};
  const entries = Object.entries(norms)
    .filter(([key, value]) => key !== "zone_code" && !key.startsWith("_") && value !== null && value !== undefined)
    .slice(0, 6);
  return Object.fromEntries(entries);
}

async function writeLotZoneParquet(assignments: LotZoneNormAssignment[]): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "qc-lot-zonage-"));
  const path = join(dir, "out.parquet");
  try {
    const writer = await ParquetWriter.openFile(LOT_ZONE_SCHEMA, path);
    for (const assignment of assignments) {
      await writer.appendRow({
        lot_id: assignment.lotId,
        zone_code: assignment.zoneCode ?? undefined,
        dominant_fraction: assignment.dominantFraction,
        multi_zone: assignment.multiZone,
        zone_codes: assignment.zoneCodes,
        assignment_method: assignment.method,
        norms: assignment.norms ? JSON.stringify(assignment.norms) : undefined,
      });
    }
    await writer.close();
    return await readFile(path);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function verifyDeposit(s3: S3Client, slug: string): Promise<LotZoneStats["verified_deposit"]> {
  const parquetKey = outParquetKey(slug);
  const statsKey = outStatsKey(slug);
  const parquetExists = await exists(s3, parquetKey);
  const statsExists = await exists(s3, statsKey);
  let parquetRows = 0;
  if (parquetExists) {
    const rows = await readParquetRowsFromBuffer(await getBytes(s3, parquetKey), ["lot_id", "zone_code"]);
    parquetRows = rows.length;
  }
  return {
    parquet_exists: parquetExists,
    stats_exists: statsExists,
    parquet_rows: parquetRows,
  };
}

async function runCity(s3: S3Client, slug: string, noUpload: boolean, simplifyZonesM: number): Promise<LotZoneStats> {
  if (simplifyZonesM > 0) console.error(`[lot-zone-join] ${slug}: resolving input keys`);
  const cadastreKey = await resolveCadastreKey(s3, slug);
  const zonesKey = await resolveZonesKey(s3, slug);
  const normsKey = await resolveNormsKey(s3, slug);
  const recalageStatsKey = await resolveRecalageStatsKey(s3, slug);

  if (simplifyZonesM > 0) console.error(`[lot-zone-join] ${slug}: reading cadastre and zones`);
  const cadastre = (await getGeoJsonFeatureCollection<GeoFeature>(s3, cadastreKey)) as GeoFc;
  const zones = (await getGeoJsonFeatureCollection<GeoFeature>(s3, zonesKey)) as GeoFc;
  const lots = polygonalFeatures(cadastre, `${slug} cadastre`);
  const zoneFeatures = polygonalFeatures(zones, `${slug} zones`).filter((feature) => zoneCodeOf(feature));
  if (zoneFeatures.length === 0) throw new Error(`${slug} zones have no usable zone_code`);

  if (simplifyZonesM > 0) {
    console.error(`[lot-zone-join] ${slug}: projecting ${lots.length} lot(s), ${zoneFeatures.length} zone feature(s)`);
  }
  const metricCrs = localMetricContext([...lots, ...zoneFeatures]);
  const projectedLots = projectFeatures(lots, metricCrs);
  let projectedZones = projectFeatures(zoneFeatures, metricCrs);
  if (simplifyZonesM > 0) {
    console.error(
      `[lot-zone-join] ${slug}: simplifying ${projectedZones.length} zone feature(s) at ${simplifyZonesM}m`,
    );
    projectedZones = simplifyFeatures(projectedZones, simplifyZonesM);
    console.error(`[lot-zone-join] ${slug}: assigning ${projectedLots.length} lot(s)`);
  }
  const { byCode: normsByCode } = await loadNorms(s3, normsKey);
  const recalage = await loadRecalageStats(s3, recalageStatsKey);

  const assignments = assignLotZones(projectedLots, projectedZones, zoneCodeOf, { lotIdOf });

  // Anti-invention (Option A archi 18410a95): un lot dont le CENTROÏDE est hors de
  // TOUTE zone servie → zone_code=null (UNKNOWN-recalage), JAMAIS le code d'une UEV
  // voisine touchée par un simple recouvrement de bord (l'aire-majorité peut ramasser
  // ce sliver et écrire le zonage du voisin sur un vacant/voirie — fabrication interdite).
  // On réutilise le prédicat `outside_all` de l'audit (mêmes centroïde shoelace +
  // point-in-polygon avec trous) sur la géométrie WGS84 servie à l'identique (le
  // cadastre passe verbatim vers qc-lots), donc le dépôt et l'audit-after concordent.
  // NEUTRE au grain zone-polygon : un centroïde DANS une zone n'est jamais nullifié,
  // même si l'aire-majorité a hésité entre deux zones adjacentes qui se chevauchent.
  const zoneIndex = buildServedZoneIndex(zones.features ?? []);
  let nullifiedOutsideAll = 0;
  const guardedAssignments = assignments.map((assignment, i) => {
    if (assignment.zoneCode === null) return assignment;
    const lotGeometry = lots[i]?.geometry;
    if (!lotGeometry) return assignment;
    if (!lotCentroidOutsideAllServedZones(lotGeometry, zoneIndex, assignment.zoneCode)) return assignment;
    nullifiedOutsideAll += 1;
    return {
      ...assignment,
      zoneCode: null,
      dominantFraction: 0,
      multiZone: false,
      zoneCodes: [],
      method: "unassigned" as const,
    };
  });
  if (nullifiedOutsideAll > 0) {
    console.error(
      `[lot-zone-join] ${slug}: centroïde-hors-zone → UNKNOWN-recalage: ` +
        `${nullifiedOutsideAll}/${assignments.length} lot(s) nullifié(s) (zone_code=null, jamais le code d'une UEV voisine)`,
    );
  }

  if (simplifyZonesM > 0) console.error(`[lot-zone-join] ${slug}: writing outputs`);
  const enriched = enrichWithNorms(guardedAssignments, normsByCode);
  const stats = buildStats(
    slug,
    {
      cadastre: cadastreKey,
      zones: zonesKey,
      norms: normsKey,
      recalage_stats: recalageStatsKey,
    },
    metricCrs,
    enriched,
    recalage,
  );

  const parquet = await writeLotZoneParquet(enriched);
  const statsBody = Buffer.from(JSON.stringify(stats, null, 2), "utf8");

  if (!noUpload) {
    await putBytes(s3, outParquetKey(slug), parquet, "application/octet-stream");
    await putBytes(s3, outStatsKey(slug), statsBody, "application/json");
    stats.verified_deposit = await verifyDeposit(s3, slug);
  } else {
    const local = join(tmpdir(), `qc-lot-zonage-${slug}.parquet`);
    await writeFile(local, parquet);
    stats.verified_deposit = {
      parquet_exists: true,
      stats_exists: true,
      parquet_rows: (await readParquetRows(local, ["lot_id", "zone_code"])).length,
    };
  }

  return stats;
}

async function verifyOnly(s3: S3Client, slug: string): Promise<LotZoneStats> {
  const statsKey = outStatsKey(slug);
  if (!(await exists(s3, statsKey))) throw new Error(`stats not found: ${statsKey}`);
  const stats = JSON.parse((await getBytes(s3, statsKey)).toString("utf8")) as LotZoneStats;
  stats.verified_deposit = await verifyDeposit(s3, slug);
  return stats;
}

function printSummary(stats: LotZoneStats): void {
  const verify = stats.verified_deposit;
  const suffix = verify
    ? ` verify parquet=${verify.parquet_exists ? "Y" : "N"} stats=${verify.stats_exists ? "Y" : "N"} rows=${verify.parquet_rows}`
    : "";
  console.log(
    [
      `OK ${stats.slug}`,
      `lots=${stats.num_lots}`,
      `assigned=${stats.pct_assigned}%`,
      `multi=${stats.pct_multi_zone}%`,
      `match=${stats.zone_code_match_rate}%`,
      `without_norms=${stats.pct_without_norms}%`,
      suffix.trim(),
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (stats.warnings.length > 0) console.log(`WARN ${stats.slug} ${stats.warnings.join("; ")}`);
  for (const example of stats.examples) {
    console.log(
      `EXAMPLE ${stats.slug} lot=${example.lot_id} zone=${example.zone_code} norm_fields=${Object.keys(example.norm_fields).join(",")}`,
    );
  }
}

async function enumerateServedZoneSlugs(s3: S3Client): Promise<string[]> {
  // Mirror zones-s3-check: catch both flat qc-zonage-<slug>.geojson and the
  // subdir variant qc-zonage-<slug>/qc-zonage-<slug>.geojson.
  const slugs = new Set<string>();
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: ZONES_PREFIX, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of r.Contents ?? []) {
      const k = o.Key ?? "";
      const m =
        k.match(/ca-qc-zonage\/qc-zonage-([^/]+)\.geojson$/) ?? k.match(/ca-qc-zonage\/qc-zonage-([^/]+)\/qc-zonage-/);
      if (m?.[1]) slugs.add(m[1]);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return [...slugs].sort();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const s3 = s3Client();
  const allSlugs = args.all ? await enumerateServedZoneSlugs(s3) : args.slugs;
  const slugs = args.shard
    ? allSlugs.filter((_, i) => i % args.shard!.total === args.shard!.index)
    : allSlugs;
  if (args.all) {
    console.log(
      `ALL served zone slugs: ${allSlugs.length}` +
        (args.shard ? ` | shard ${args.shard.index}/${args.shard.total} -> ${slugs.length}` : ""),
    );
  }
  const summaries: LotZoneStats[] = [];
  const skipped: Array<{ slug: string; reason: string }> = [];
  for (const slug of slugs) {
    try {
      const stats = args.verifyOnly ? await verifyOnly(s3, slug) : await runCity(s3, slug, args.noUpload, args.simplifyZonesM);
      summaries.push(stats);
      printSummary(stats);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      skipped.push({ slug, reason });
      console.log(`SKIP ${slug} ${reason}`);
    }
  }
  const failedVerify = summaries.filter(
    (s) => !s.verified_deposit?.parquet_exists || !s.verified_deposit?.stats_exists || s.verified_deposit.parquet_rows !== s.num_lots,
  );
  console.log(`DONE ok=${summaries.length} skipped=${skipped.length} failed_verify=${failedVerify.length}`);
  if (!args.all && failedVerify.length > 0) {
    throw new Error(`deposit verification failed for ${failedVerify.map((s) => s.slug).join(", ")}`);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function round6(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
