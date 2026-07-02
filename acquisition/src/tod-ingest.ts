/**
 * tod-ingest.ts -- per-municipality "aire TOD" (PMAD) tagging.
 *
 * Acquires the CMM (Communauté métropolitaine de Montréal) PMAD "aires TOD"
 * polygons (transit-oriented development areas: 500 m / 1 km radius around the
 * access points to the metropolitan structuring transit network — here the exo
 * Candiac line gares) and tags every cadastre lot with `in_tod` + the dominant
 * TOD area.
 *
 * SOURCE (official, not invented):
 *   CMM — Plan métropolitain d'aménagement et de développement (PMAD),
 *   "Délimitation des aires TOD". Official portal: Observatoire du Grand
 *   Montréal (https://observatoire.cmm.qc.ca/produits/donnees-georeferencees/)
 *   — the portal HTML blocks automated fetches (403), so the same PMAD layer is
 *   read from its public ArcGIS Online mirror (item 4293ab06271f4c899dab7016f5c56146,
 *   tags: PMAD / Transport / Aménagement), whose schema is the verbatim CMM PMAD
 *   aires-TOD schema (id_tod, seuil_pmad, statut, ligne, milieu, ...). Attribution:
 *   "Aires TOD — PMAD, Communauté métropolitaine de Montréal (CMM)".
 *
 * Orchestration only: reads S3 cadastre, fetches the TOD polygons, reprojects
 * WGS84 into a local metric frame, calls the pure @sentropic/geo lot/zone join
 * (TOD polygons play the role of "zones"), writes GeoJSON + parquet + stats to
 * S3. The library owns no I/O and the TOD polygons are never synthesised.
 *
 * Run:
 *   tsx src/tod-ingest.ts --slugs delson,sainte-catherine,saint-constant,candiac
 *   tsx src/tod-ingest.ts --slugs candiac --no-upload
 *   tsx src/tod-ingest.ts --slugs candiac --verify-only
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { S3Client } from "@aws-sdk/client-s3";
import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";
import { assignLotZones, type LotZoneAssignment, type PolygonalFeature } from "@sentropic/geo";

import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import { norm as normCadastreSlug } from "./cadastre-clip-sda.js";
import { exists, getBytes, getJson, listSlugs, putBytes, s3Client } from "./lib/s3.js";
import { projConstants } from "./lib/t1-zones.js";

// ── TOD source (CMM PMAD, ArcGIS Online mirror) ──────────────────────────────
const TOD_LAYER_URL =
  "https://services7.arcgis.com/51FKJeyw4LHSTQeV/arcgis/rest/services/Aires_TOD_22_02_2023/FeatureServer/0";
const TOD_ITEM_ID = "4293ab06271f4c899dab7016f5c56146";
const TOD_ATTRIBUTION = "Aires TOD — PMAD, Communauté métropolitaine de Montréal (CMM)";
const TOD_OFFICIAL_PORTAL = "https://observatoire.cmm.qc.ca/produits/donnees-georeferencees/";
const USER_AGENT = "sentropic-geo/acquisition (tod-ingest)";
const FETCH_TIMEOUT_MS = 60_000;
// Fields carried from the PMAD aires-TOD schema.
const TOD_OUT_FIELDS = [
  "id_tod",
  "nom",
  "nm_mun",
  "nm_mrc",
  "statut",
  "ligne",
  "type",
  "milieu",
  "seuil_pmad",
] as const;

const CAD_PREFIX = "normalized/qc-cadastre-lots/";
const TOD_OUT_PREFIX = "normalized/qc-tod/";
const LOT_TOD_OUT_PREFIX = "normalized/qc-lot-tod/";

const LOT_TOD_SCHEMA = new ParquetSchema({
  lot_id: { type: "UTF8", compression: "SNAPPY" },
  in_tod: { type: "BOOLEAN", compression: "SNAPPY" },
  tod_id: { type: "UTF8", optional: true, compression: "SNAPPY" },
  tod_nom: { type: "UTF8", optional: true, compression: "SNAPPY" },
  tod_statut: { type: "UTF8", optional: true, compression: "SNAPPY" },
  tod_ligne: { type: "UTF8", optional: true, compression: "SNAPPY" },
  tod_type: { type: "UTF8", optional: true, compression: "SNAPPY" },
  tod_seuil_pmad: { type: "DOUBLE", optional: true, compression: "SNAPPY" },
  dominant_fraction: { type: "DOUBLE", compression: "SNAPPY" },
  tod_ids: { type: "UTF8", repeated: true, compression: "SNAPPY" },
  assignment_method: { type: "UTF8", compression: "SNAPPY" },
});

type GeoFeature = Feature<Geometry, Record<string, unknown> | null>;
type GeoFc = FeatureCollection<Geometry, Record<string, unknown> | null>;
type MetricCrs = {
  method: "local-equirectangular";
  lon0: number;
  lat0: number;
  meters_per_degree_lon: number;
  meters_per_degree_lat: number;
};

interface TodProps {
  id_tod: string;
  nom: string;
  nm_mun: string;
  nm_mrc: string;
  statut: string;
  ligne: string;
  type: string;
  milieu: string;
  seuil_pmad: number | null;
}

interface Args {
  slugs: string[];
  noUpload: boolean;
  verifyOnly: boolean;
}

interface TodStats {
  slug: string;
  source: {
    attribution: string;
    official_portal: string;
    arcgis_item_id: string;
    arcgis_layer_url: string;
  };
  input_keys: { cadastre: string };
  output_keys: { tod_geojson: string; lot_tod_parquet: string; stats: string };
  metric_crs: MetricCrs;
  num_tod_polygons: number;
  tod_areas: Array<{
    id_tod: string;
    nom: string;
    nm_mun: string;
    nm_mrc: string;
    statut: string;
    ligne: string;
    type: string;
    seuil_pmad: number | null;
  }>;
  num_lots: number;
  num_in_tod: number;
  pct_in_tod: number;
  in_tod_by_area: Array<{ tod_id: string; nom: string; num_lots: number }>;
  examples: Array<{ lot_id: string; tod_id: string; tod_nom: string; dominant_fraction: number }>;
  warnings: string[];
  verified_deposit?: {
    tod_geojson_exists: boolean;
    parquet_exists: boolean;
    stats_exists: boolean;
    parquet_rows: number;
  };
}

// ── args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): Args {
  const slugs: string[] = [];
  let noUpload = false;
  let verifyOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--slug" || arg === "--slugs") {
      slugs.push(...String(argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    } else if (arg === "--no-upload") noUpload = true;
    else if (arg === "--verify-only") verifyOnly = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  const uniqueSlugs = [...new Set(slugs)];
  if (uniqueSlugs.length === 0) throw new Error("pass --slugs <a,b,c>");
  return { slugs: uniqueSlugs, noUpload, verifyOnly };
}

function todGeojsonKey(slug: string): string {
  return `${TOD_OUT_PREFIX}${slug}.geojson`;
}
function lotTodParquetKey(slug: string): string {
  return `${LOT_TOD_OUT_PREFIX}${slug}.parquet`;
}
function lotTodStatsKey(slug: string): string {
  return `${LOT_TOD_OUT_PREFIX}${slug}.stats.json`;
}

// ── cadastre resolution (mirrors lot-zone-join-run) ──────────────────────────
async function resolveCadastreKey(s3: S3Client, slug: string): Promise<string> {
  const key = `${CAD_PREFIX}${slug}.geojson`;
  if (await exists(s3, key)) return key;
  const slugs = await listSlugs(s3, CAD_PREFIX, ".geojson", true);
  const normalizedTarget = normCadastreSlug(slug);
  const exact = slugs.filter((c) => normCadastreSlug(c) === normalizedTarget);
  if (exact.length === 1) return `${CAD_PREFIX}${exact[0]}.geojson`;
  const contains = slugs.filter((c) => normCadastreSlug(c).includes(normalizedTarget));
  if (contains.length === 1) return `${CAD_PREFIX}${contains[0]}.geojson`;
  throw new Error(`cadastre not found for ${slug}: ${key}`);
}

// ── TOD download (ArcGIS FeatureServer, WGS84 GeoJSON, envelope + paged) ──────
async function fetchTodForBbox(bbox: [number, number, number, number]): Promise<GeoFeature[]> {
  const [minX, minY, maxX, maxY] = bbox;
  const geometry = encodeURIComponent(`${minX},${minY},${maxX},${maxY}`);
  const outFields = encodeURIComponent(TOD_OUT_FIELDS.join(","));
  const out: GeoFeature[] = [];
  let offset = 0;
  const batchSize = 1000;
  for (;;) {
    const url =
      `${TOD_LAYER_URL}/query?where=1%3D1` +
      `&geometry=${geometry}&geometryType=esriGeometryEnvelope&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&outFields=${outFields}&outSR=4326&geometryPrecision=7` +
      `&resultOffset=${offset}&resultRecordCount=${batchSize}&f=geojson`;
    const fc = await fetchGeoJson(url);
    const feats = (fc.features ?? []) as GeoFeature[];
    out.push(...feats);
    if (feats.length < batchSize) break;
    offset += feats.length;
  }
  return out;
}

async function fetchGeoJson(url: string): Promise<GeoFc> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`TOD fetch HTTP ${res.status} for ${url}`);
    const text = await res.text();
    const data = JSON.parse(text) as GeoFc & { error?: { message?: string } };
    if (data.error) throw new Error(`ArcGIS error: ${data.error.message ?? "unknown"}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function cleanTodProps(props: Record<string, unknown> | null): TodProps {
  const p = props ?? {};
  const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    id_tod: str(p["id_tod"]).replace(/\.0+$/, ""),
    nom: str(p["nom"]),
    nm_mun: str(p["nm_mun"]),
    nm_mrc: str(p["nm_mrc"]),
    statut: str(p["statut"]),
    ligne: str(p["ligne"]),
    type: str(p["type"]),
    milieu: str(p["milieu"]),
    seuil_pmad: num(p["seuil_pmad"]),
  };
}

// ── geometry helpers (mirror lot-zone-join-run) ──────────────────────────────
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

function polygonalFromFeatures(features: GeoFeature[]): PolygonalFeature[] {
  const out: PolygonalFeature[] = [];
  for (const f of features) {
    if (!f.geometry) continue;
    if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon") continue;
    out.push(f as PolygonalFeature);
  }
  return out;
}

function lotIdOf(feature: PolygonalFeature, index: number): string {
  const props = feature.properties ?? {};
  for (const key of ["lot_id", "LOT_ID", "NO_LOT", "no_lot", "noLot", "geoId", "id"]) {
    const value = props[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return String(index);
}

function todCodeOf(feature: PolygonalFeature): string {
  const props = feature.properties ?? {};
  const v = props["id_tod"];
  if (v !== null && v !== undefined && String(v).trim()) return String(v).replace(/\.0+$/, "");
  return "";
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

function localMetricContext(features: PolygonalFeature[]): MetricCrs {
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

function projectFeatures(features: PolygonalFeature[], crs: MetricCrs): PolygonalFeature[] {
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
  return features.map((feature) => ({ ...feature, geometry: projectGeom(feature.geometry) }));
}

// ── parquet ──────────────────────────────────────────────────────────────────
async function writeLotTodParquet(
  assignments: LotZoneAssignment[],
  byTodId: Map<string, TodProps>,
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "qc-lot-tod-"));
  const path = join(dir, "out.parquet");
  try {
    const writer = await ParquetWriter.openFile(LOT_TOD_SCHEMA, path);
    for (const a of assignments) {
      const inTod = a.zoneCode !== null;
      const tod = inTod ? byTodId.get(String(a.zoneCode).replace(/\.0+$/, "")) : undefined;
      await writer.appendRow({
        lot_id: a.lotId,
        in_tod: inTod,
        tod_id: inTod ? String(a.zoneCode).replace(/\.0+$/, "") : undefined,
        tod_nom: tod?.nom || undefined,
        tod_statut: tod?.statut || undefined,
        tod_ligne: tod?.ligne || undefined,
        tod_type: tod?.type || undefined,
        tod_seuil_pmad: tod?.seuil_pmad ?? undefined,
        dominant_fraction: a.dominantFraction,
        tod_ids: a.zoneCodes.map((c) => String(c).replace(/\.0+$/, "")),
        assignment_method: a.method,
      });
    }
    await writer.close();
    return await readFile(path);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── stats ────────────────────────────────────────────────────────────────────
function buildStats(
  slug: string,
  cadastreKey: string,
  metricCrs: MetricCrs,
  todFeatures: GeoFeature[],
  byTodId: Map<string, TodProps>,
  assignments: LotZoneAssignment[],
): TodStats {
  const numLots = assignments.length;
  const inTod = assignments.filter((a) => a.zoneCode !== null);
  const byArea = new Map<string, number>();
  for (const a of inTod) {
    const id = String(a.zoneCode).replace(/\.0+$/, "");
    byArea.set(id, (byArea.get(id) ?? 0) + 1);
  }
  const inTodByArea = [...byArea.entries()]
    .map(([tod_id, num_lots]) => ({ tod_id, nom: byTodId.get(tod_id)?.nom ?? "", num_lots }))
    .sort((a, b) => b.num_lots - a.num_lots);

  const warnings: string[] = [];
  if (todFeatures.length === 0) warnings.push("no TOD polygon intersects this municipality");

  const todAreas = [...byTodId.values()]
    .map((t) => ({
      id_tod: t.id_tod,
      nom: t.nom,
      nm_mun: t.nm_mun,
      nm_mrc: t.nm_mrc,
      statut: t.statut,
      ligne: t.ligne,
      type: t.type,
      seuil_pmad: t.seuil_pmad,
    }))
    .sort((a, b) => a.id_tod.localeCompare(b.id_tod, undefined, { numeric: true }));

  const examples = inTod.slice(0, 5).map((a) => {
    const id = String(a.zoneCode).replace(/\.0+$/, "");
    return {
      lot_id: a.lotId,
      tod_id: id,
      tod_nom: byTodId.get(id)?.nom ?? "",
      dominant_fraction: round4(a.dominantFraction),
    };
  });

  return {
    slug,
    source: {
      attribution: TOD_ATTRIBUTION,
      official_portal: TOD_OFFICIAL_PORTAL,
      arcgis_item_id: TOD_ITEM_ID,
      arcgis_layer_url: TOD_LAYER_URL,
    },
    input_keys: { cadastre: cadastreKey },
    output_keys: {
      tod_geojson: todGeojsonKey(slug),
      lot_tod_parquet: lotTodParquetKey(slug),
      stats: lotTodStatsKey(slug),
    },
    metric_crs: metricCrs,
    num_tod_polygons: todFeatures.length,
    tod_areas: todAreas,
    num_lots: numLots,
    num_in_tod: inTod.length,
    pct_in_tod: numLots ? round2((100 * inTod.length) / numLots) : 0,
    in_tod_by_area: inTodByArea,
    examples,
    warnings,
  };
}

function todFeatureCollection(slug: string, features: GeoFeature[]): GeoFc & Record<string, unknown> {
  const cleaned: GeoFeature[] = features.map((f) => ({
    type: "Feature",
    geometry: f.geometry,
    properties: cleanTodProps(f.properties) as unknown as Record<string, unknown>,
  }));
  return {
    type: "FeatureCollection",
    metadata: {
      slug,
      layer: "aires-tod-pmad",
      attribution: TOD_ATTRIBUTION,
      official_portal: TOD_OFFICIAL_PORTAL,
      arcgis_item_id: TOD_ITEM_ID,
      arcgis_layer_url: TOD_LAYER_URL,
      crs: "EPSG:4326",
    },
    features: cleaned,
  };
}

// ── verify ───────────────────────────────────────────────────────────────────
async function verifyDeposit(s3: S3Client, slug: string): Promise<TodStats["verified_deposit"]> {
  const parquetKey = lotTodParquetKey(slug);
  const parquetExists = await exists(s3, parquetKey);
  let parquetRows = 0;
  if (parquetExists) {
    const rows = await readParquetRowsFromBuffer(await getBytes(s3, parquetKey), ["lot_id", "in_tod"]);
    parquetRows = rows.length;
  }
  return {
    tod_geojson_exists: await exists(s3, todGeojsonKey(slug)),
    parquet_exists: parquetExists,
    stats_exists: await exists(s3, lotTodStatsKey(slug)),
    parquet_rows: parquetRows,
  };
}

// ── per-city ─────────────────────────────────────────────────────────────────
async function runCity(s3: S3Client, slug: string, noUpload: boolean): Promise<TodStats> {
  const cadastreKey = await resolveCadastreKey(s3, slug);
  const cadastre = (await getJson(s3, cadastreKey)) as GeoFc;
  const lots = polygonalFeatures(cadastre, `${slug} cadastre`);

  // City envelope (WGS84), expanded a touch to catch TOD polygons whose access
  // point is outside the city but whose 500 m–1 km radius reaches inside.
  const lotBbox = bboxOfFeatures(lots);
  const pad = 0.02; // ~1.5 km at this latitude
  const queryBbox: [number, number, number, number] = [
    lotBbox[0] - pad,
    lotBbox[1] - pad,
    lotBbox[2] + pad,
    lotBbox[3] + pad,
  ];
  const todFeaturesRaw = await fetchTodForBbox(queryBbox);
  const todFeatures = polygonalFromFeatures(todFeaturesRaw).filter((f) => todCodeOf(f));

  const byTodId = new Map<string, TodProps>();
  for (const f of todFeatures) {
    const props = cleanTodProps(f.properties);
    if (props.id_tod) byTodId.set(props.id_tod, props);
  }

  let assignments: LotZoneAssignment[];
  let metricCrs: MetricCrs;
  if (todFeatures.length === 0) {
    // No TOD area here — every lot is out of TOD.
    metricCrs = localMetricContext(lots);
    assignments = lots.map((lot, i) => ({
      lotId: lotIdOf(lot, i),
      zoneCode: null,
      dominantFraction: 0,
      multiZone: false,
      zoneCodes: [],
      method: "unassigned" as const,
    }));
  } else {
    metricCrs = localMetricContext([...lots, ...todFeatures]);
    const projectedLots = projectFeatures(lots, metricCrs);
    const projectedTods = projectFeatures(todFeatures, metricCrs);
    assignments = assignLotZones(projectedLots, projectedTods, todCodeOf, { lotIdOf });
  }

  const stats = buildStats(slug, cadastreKey, metricCrs, todFeatures, byTodId, assignments);
  const parquet = await writeLotTodParquet(assignments, byTodId);
  const todFc = todFeatureCollection(slug, todFeatures);
  const statsBody = Buffer.from(JSON.stringify(stats, null, 2), "utf8");
  const todBody = Buffer.from(JSON.stringify(todFc), "utf8");

  if (!noUpload) {
    await putBytes(s3, todGeojsonKey(slug), todBody, "application/geo+json");
    await putBytes(s3, lotTodParquetKey(slug), parquet, "application/octet-stream");
    await putBytes(s3, lotTodStatsKey(slug), statsBody, "application/json");
    stats.verified_deposit = await verifyDeposit(s3, slug);
  } else {
    stats.verified_deposit = {
      tod_geojson_exists: true,
      parquet_exists: true,
      stats_exists: true,
      parquet_rows: (await readParquetRowsFromBuffer(parquet, ["lot_id", "in_tod"])).length,
    };
  }
  return stats;
}

async function verifyOnly(s3: S3Client, slug: string): Promise<TodStats> {
  const statsKey = lotTodStatsKey(slug);
  if (!(await exists(s3, statsKey))) throw new Error(`stats not found: ${statsKey}`);
  const stats = (await getJson(s3, statsKey)) as TodStats;
  stats.verified_deposit = await verifyDeposit(s3, slug);
  return stats;
}

function printSummary(stats: TodStats): void {
  const v = stats.verified_deposit;
  const suffix = v
    ? ` verify geojson=${v.tod_geojson_exists ? "Y" : "N"} parquet=${v.parquet_exists ? "Y" : "N"} stats=${v.stats_exists ? "Y" : "N"} rows=${v.parquet_rows}`
    : "";
  console.log(
    [
      `OK ${stats.slug}`,
      `lots=${stats.num_lots}`,
      `tod_polygons=${stats.num_tod_polygons}`,
      `in_tod=${stats.num_in_tod} (${stats.pct_in_tod}%)`,
      suffix.trim(),
    ]
      .filter(Boolean)
      .join(" "),
  );
  for (const area of stats.in_tod_by_area) {
    console.log(`  AREA ${stats.slug} tod=${area.tod_id} nom="${area.nom}" lots=${area.num_lots}`);
  }
  if (stats.warnings.length > 0) console.log(`WARN ${stats.slug} ${stats.warnings.join("; ")}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const s3 = s3Client();
  const summaries: TodStats[] = [];
  const skipped: Array<{ slug: string; reason: string }> = [];
  for (const slug of args.slugs) {
    try {
      const stats = args.verifyOnly ? await verifyOnly(s3, slug) : await runCity(s3, slug, args.noUpload);
      summaries.push(stats);
      printSummary(stats);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      skipped.push({ slug, reason });
      console.log(`SKIP ${slug} ${reason}`);
    }
  }
  const failed = summaries.filter(
    (s) =>
      !s.verified_deposit?.parquet_exists ||
      !s.verified_deposit?.stats_exists ||
      s.verified_deposit.parquet_rows !== s.num_lots,
  );
  console.log(`DONE ok=${summaries.length} skipped=${skipped.length} failed_verify=${failed.length}`);
  if (failed.length > 0) throw new Error(`deposit verification failed for ${failed.map((s) => s.slug).join(", ")}`);
  if (skipped.length > 0) throw new Error(`skipped ${skipped.map((s) => s.slug).join(", ")}`);
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
