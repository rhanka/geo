/**
 * BDZI flood-zones — POST-CAPTURE acquire → serve, pure/testable rules.
 *
 * §9 `ca-qc-constraints` family, BDZI source (`ca-qc/bdzi-flood-zones`). This is
 * the acquire-delta the CPTAQ §9 spec (docs/spec/S9_ACQUIRE_DELTA_CPTAQ.md)
 * assigned to geo-zones, transposed to BDZI: the runner READS the attested CAS
 * raw GeoJSON already captured cluster→S3 by the §6 gated capture — it NEVER
 * re-fetches — then confirms CRS, simplifies, normalizes and serves ONE
 * province-wide OVERLAY collection `qc-bdzi-flood-zones`.
 *
 * REUSE > REBUILD (CLAUDE.md). This module rebuilds NOTHING that already exists:
 *   - proof-v2 from the capture manifest → `proofFromCaptureEntry` + the whole
 *     proof block stamping → `attachGeometryProof` (lib/zonage-proof.ts) ;
 *   - normalization → `bdziNormalizer` + `bdziManifest`
 *     (packages/geo-sources-americas/src/ca-qc-constraints) ;
 *   - the ogr2ogr Douglas–Peucker recipe → mirrored from
 *     packages/geo/src/acquire/gdal.ts (`buildOgr2OgrArgs`), reusing its
 *     `CommandRunner` type verbatim.
 * The runner (`acquisition/src/_bdzi-flood-zones-acquire-deposit-*.ts`) owns S3
 * I/O + the GDAL shell + readback; every RULE below is here so it is unit-tested
 * without credentials, network, or the GDAL binary.
 *
 * WHY NOT `depositCapturedZones` / `putServedZoneGeojson`: those are bound to the
 * `qc-zonage-<slug>` served namespace (`isServedZoneKey`) with a zone_code
 * identity gate. BDZI is an OVERLAY — one province-wide collection, no zone_code,
 * not a per-city Zone node — so it is served under the constraints prefix via the
 * generic `putBytes` helper, carrying the SAME proof-v2 block.
 *
 * ANTI-INVENTION: geometry is served exactly as GDAL emits it; the property set
 * is exactly what `bdziNormalizer` produces (Description/No_rapport/Nm_rapport
 * preserved verbatim, plus geoId/name/code/level/country/constraint); the
 * simplify tolerance and its UNIT are traced in provenance, never assumed.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import {
  bdziManifest,
  bdziNormalizer,
  BDZI_CONSTRAINT,
  BDZI_SIMPLIFY,
  DATASET_FLOOD_ZONES,
} from "../../../packages/geo-sources-americas/src/ca-qc-constraints/index.js";
import type { CommandRunner } from "../../../packages/geo/src/acquire/gdal.js";
import {
  attachGeometryProof,
  assertGeometryProof,
  type GeometrySourceProof,
  type ServedZoneGeoJson,
} from "./zonage-proof.js";

const execFileAsync = promisify(execFile);

/** The one served OVERLAY collection id (= the manifest dataset id, ADR-0005). */
export const BDZI_SERVED_COLLECTION_ID = DATASET_FLOOD_ZONES; // "qc-bdzi-flood-zones"

/**
 * Served prefix for the `ca-qc-constraints` family, mirroring the zonage
 * `normalized/ca-qc-zonage/` convention (geo-api derives the collection id from
 * the file STEM, so the containing directory is a namespace, not the id).
 *
 * ⚠ ASSUMPTION (source-gap): `docs/spec/SPEC_GEO_ENV_CONSTRAINTS_S9.md` is not
 * present in this worktree, so the EXACT constraints prefix is unconfirmed here.
 * The runner exposes `--prefix` to override it; geo-zones confirms it against the
 * §9 served-family contract before any commit.
 */
export const BDZI_CONSTRAINTS_PREFIX = "normalized/ca-qc-constraints/";

/** Coordinate precision GDAL trims to (mirrors gdal.ts DEFAULT_COORDINATE_PRECISION). */
export const BDZI_COORDINATE_PRECISION = 6;

/** The two canonical physical layouts of the overlay (both are written; geo-api
 *  serves the nested one when both exist — CLAUDE.md provenance rule). */
export interface OverlayLayoutKeys {
  flat: string;
  nested: string;
}

export function overlayKeys(prefix: string = BDZI_CONSTRAINTS_PREFIX): OverlayLayoutKeys {
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return {
    flat: `${base}${BDZI_SERVED_COLLECTION_ID}.geojson`,
    nested: `${base}${BDZI_SERVED_COLLECTION_ID}/${BDZI_SERVED_COLLECTION_ID}.geojson`,
  };
}

const GEOJSON_SUFFIX = ".geojson";
const META_SUFFIX = ".meta.json";
/** CRS declared in the sibling meta (geo-socle directive). */
export const BDZI_META_CRS = "EPSG:4326";

/**
 * geo-api derives the served collection id from a SIBLING `<geojson-key>.meta.json`
 * (`meta?.datasetId ?? stem` — store-provider.ts:113,231-234). Mirror of
 * `metaKeyOf` (zones-bareslug-alias-20260821.ts:170).
 */
export function overlayMetaKey(geojsonKey: string): string {
  return `${geojsonKey.slice(0, -GEOJSON_SUFFIX.length)}${META_SUFFIX}`;
}

export interface OverlayMetaWrite {
  meta: Record<string, unknown>;
  hadExisting: boolean;
  preservedFields: string[];
}

/**
 * Build the sibling `.meta.json` content that pins the served collection id to
 * `qc-bdzi-flood-zones`. Mirrors `writeMetaForKey`
 * (zones-bareslug-alias-20260821.ts:196-210): preserve-merge onto an existing
 * meta (only `datasetId` is (re)set; every other field — count/crs/… — is
 * preserved), else a minimal-correct `{ datasetId, count, crs }`.
 */
export function buildOverlayMeta(
  servedFeatureCount: number,
  existingMeta?: Record<string, unknown> | null,
): OverlayMetaWrite {
  if (existingMeta && typeof existingMeta === "object" && !Array.isArray(existingMeta)) {
    const preservedFields = Object.keys(existingMeta).filter((k) => k !== "datasetId");
    return {
      meta: { ...existingMeta, datasetId: BDZI_SERVED_COLLECTION_ID },
      hadExisting: true,
      preservedFields,
    };
  }
  return {
    meta: { datasetId: BDZI_SERVED_COLLECTION_ID, count: servedFeatureCount, crs: BDZI_META_CRS },
    hadExisting: false,
    preservedFields: [],
  };
}

/** Non-destructive pre-overwrite backup key, under a `_`-prefixed segment
 *  (mirrors the zonage `_replaced/` convention). `layout` keeps the two layouts
 *  of the same overlay from colliding. */
export function overlayBackupKey(
  layout: "flat" | "nested",
  stamp: string,
  prefix: string = BDZI_CONSTRAINTS_PREFIX,
): string {
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return `${base}_replaced/${BDZI_SERVED_COLLECTION_ID}__overlay-prebackup-${layout}.${stamp}.geojson`;
}

/** Minute-precision backup stamp, e.g. `2026-09-05T1204Z` (mirrors zonage). */
export function overlayBackupStamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z";
}

// ── Types ────────────────────────────────────────────────────────────────────

interface RawFeatureLike {
  type?: unknown;
  geometry?: { type?: unknown; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
  id?: string | number;
}
interface RawFeatureCollectionLike {
  type?: unknown;
  features?: RawFeatureLike[];
  crs?: { type?: unknown; properties?: { name?: unknown } } | null;
  exceededTransferLimit?: unknown;
  error?: unknown;
}

export interface OverlayFeature {
  type: "Feature";
  geometry: unknown;
  properties: Record<string, unknown>;
  id?: string | number;
}
export interface OverlayFeatureCollection {
  type: "FeatureCollection";
  features: OverlayFeature[];
  proof?: unknown;
  /** Acquisition provenance (simplify tolerance/unit, CRS confirmation, counts).
   *  Sits BESIDE `proof`, never inside it. */
  acquisition?: BdziAcquisitionProvenance;
}

export interface BdziAcquisitionProvenance {
  constraint: string;
  source_dataset: string;
  source_crs_confirmed: "EPSG:4326";
  simplify: {
    algorithm: "douglas-peucker";
    tool: "ogr2ogr -simplify";
    tolerance: number;
    /** Trace the UNIT explicitly: the manifest tolerance is in DEGREES. */
    unit: "degree";
    applied: boolean;
  };
  feature_count_raw: number;
  feature_count_served: number;
  capture_run_id: string | null;
}

// ── 3. CRS confirmation (confirm outSR=4326, don't assume) ────────────────────

export interface Wgs84Confirmation {
  ok: boolean;
  reason: string | null;
  declared_crs: string | null;
  bbox: [number, number, number, number] | null;
  within_quebec_envelope: boolean;
  coordinate_count: number;
}

/** Québec-ish lon/lat envelope, used only as a degree-vs-projected sanity signal
 *  (NOT a hard clip — a border flood polygon may graze it). */
const QC_ENVELOPE = { minLon: -80, maxLon: -56, minLat: 44, maxLat: 63 } as const;

function* eachPosition(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    yield [coords[0], coords[1]];
    return;
  }
  for (const c of coords) yield* eachPosition(c);
}

/**
 * Confirm the raw capture is WGS84/EPSG:4326 lon/lat GeoJSON — the capture uses
 * `outSR=4326`, and this proves it (rejects a foreign named CRS member and
 * projected-metre coordinates), rather than trusting the manifest.
 */
export function confirmWgs84(raw: unknown): Wgs84Confirmation {
  const fc = raw as RawFeatureCollectionLike | null;
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    return {
      ok: false,
      reason: "not a GeoJSON FeatureCollection",
      declared_crs: null,
      bbox: null,
      within_quebec_envelope: false,
      coordinate_count: 0,
    };
  }
  // A named CRS member is allowed only if it names WGS84/CRS84/4326. RFC 7946
  // forbids the member entirely (its absence MEANS WGS84), which is the norm for
  // ArcGIS `f=geojson`.
  const declared = typeof fc.crs?.properties?.name === "string" ? fc.crs.properties.name : null;
  if (declared !== null && !/(?:crs84|4326|wgs\s*84)/i.test(declared)) {
    return {
      ok: false,
      reason: `declared CRS "${declared}" is not WGS84/CRS84/EPSG:4326`,
      declared_crs: declared,
      bbox: null,
      within_quebec_envelope: false,
      coordinate_count: 0,
    };
  }
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  let count = 0;
  for (const feature of fc.features) {
    for (const [x, y] of eachPosition(feature.geometry?.coordinates)) {
      count++;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
    }
  }
  if (count === 0 || ![minx, miny, maxx, maxy].every(Number.isFinite)) {
    return {
      ok: false,
      reason: "no finite coordinates found",
      declared_crs: declared,
      bbox: null,
      within_quebec_envelope: false,
      coordinate_count: count,
    };
  }
  const bbox: [number, number, number, number] = [minx, miny, maxx, maxy];
  // Degree range: lon in [-180,180], lat in [-90,90]. Projected metres (UTM/MTM,
  // values in the 100k..1M range) fall outside and are rejected as not-4326.
  const inDegreeRange = minx >= -180 && maxx <= 180 && miny >= -90 && maxy <= 90;
  if (!inDegreeRange) {
    return {
      ok: false,
      reason: `coordinates out of degree range (bbox=${bbox.join(",")}) — not lon/lat 4326`,
      declared_crs: declared,
      bbox,
      within_quebec_envelope: false,
      coordinate_count: count,
    };
  }
  const withinQuebec =
    minx >= QC_ENVELOPE.minLon && maxx <= QC_ENVELOPE.maxLon &&
    miny >= QC_ENVELOPE.minLat && maxy <= QC_ENVELOPE.maxLat;
  return {
    ok: true,
    reason: null,
    declared_crs: declared,
    bbox,
    within_quebec_envelope: withinQuebec,
    coordinate_count: count,
  };
}

// ── 2. GDAL Douglas–Peucker simplify (BDZI_SIMPLIFY = 0.0005°) ─────────────────

/**
 * ogr2ogr argument vector for a GeoJSON→GeoJSON Douglas–Peucker simplify at
 * `tolerance` (degrees), re-affirming EPSG:4326 output. Mirrors gdal.ts
 * `buildOgr2OgrArgs`, minus the trailing layer arg: a `.geojson` source has a
 * single auto-detected layer, so naming one would fail. `-skipfailures` is
 * intentionally omitted so geometry errors surface.
 */
export function buildBdziSimplifyArgs(
  inPath: string,
  outPath: string,
  tolerance: number = BDZI_SIMPLIFY,
  coordinatePrecision: number = BDZI_COORDINATE_PRECISION,
): string[] {
  return [
    "-f",
    "GeoJSON",
    "-t_srs",
    "EPSG:4326",
    "-simplify",
    String(tolerance),
    "-lco",
    "RFC7946=YES",
    "-lco",
    `COORDINATE_PRECISION=${coordinatePrecision}`,
    outPath,
    inPath,
  ];
}

export interface SimplifyOptions {
  inPath: string;
  outPath: string;
  tolerance?: number;
  coordinatePrecision?: number;
  /** Injected runner (tests / cluster). Defaults to `execFile` (no shell). */
  runner?: CommandRunner;
  /** Injected reader of the emitted file (tests); defaults to reading `outPath`. */
  readJson?: (outPath: string) => Promise<unknown>;
}

/** Re-thrown with actionable guidance when the GDAL binary is missing. */
export function isGdalMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

const defaultRunner: CommandRunner = async (file, args) => {
  const { stdout, stderr } = await execFileAsync(file, [...args], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return { stdout, stderr };
};

/**
 * Run the ogr2ogr simplify and parse the emitted GeoJSON. Byte I/O is injected so
 * the RULE (the argv) is unit-tested without the GDAL binary; the default path
 * shells `ogr2ogr` (no shell → no injection surface) and reads `outPath`.
 */
export async function simplifyGeoJson(opts: SimplifyOptions): Promise<{ geojson: unknown; args: string[] }> {
  const runner = opts.runner ?? defaultRunner;
  const args = buildBdziSimplifyArgs(
    opts.inPath,
    opts.outPath,
    opts.tolerance ?? BDZI_SIMPLIFY,
    opts.coordinatePrecision ?? BDZI_COORDINATE_PRECISION,
  );
  try {
    await runner("ogr2ogr", args);
  } catch (error) {
    if (isGdalMissing(error)) {
      throw new Error(
        `GDAL/ogr2ogr required for the BDZI simplify (apt-get install gdal-bin). Could not execute "ogr2ogr".`,
        { cause: error },
      );
    }
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(`ogr2ogr simplify failed for "${opts.inPath}": ${stderr || (error as Error).message}`, {
      cause: error,
    });
  }
  const readJson =
    opts.readJson ??
    (async (p: string): Promise<unknown> => {
      const { readFile } = await import("node:fs/promises");
      return JSON.parse(await readFile(p, "utf8")) as unknown;
    });
  return { geojson: await readJson(opts.outPath), args };
}

// ── 4. Normalize via bdziNormalizer (constraint = bdzi-flood-zones) ────────────

/** The dataset descriptor for the ratified BDZI normalizer context. */
function bdziContext(): Parameters<typeof bdziNormalizer>[1] {
  const dataset = bdziManifest.datasets.find((d) => d.id === DATASET_FLOOD_ZONES);
  if (!dataset) {
    throw new Error(`bdziContext: dataset ${DATASET_FLOOD_ZONES} missing from bdziManifest (should never happen)`);
  }
  return { manifest: bdziManifest, dataset };
}

/**
 * Normalize a (simplified) BDZI capture through the ratified `bdziNormalizer`.
 * Returns the normalized FeatureCollection; every original attribute
 * (Description/No_rapport/Nm_rapport/OBJECTID) is preserved by the normalizer,
 * plus geoId/name/code/level/country/constraint. No property is invented here.
 */
export function normalizeBdziCapture(rawFc: unknown): ReturnType<typeof bdziNormalizer> {
  return bdziNormalizer(rawFc, bdziContext());
}

// ── 5. Serve the OVERLAY with proof-v2 ─────────────────────────────────────────

export interface BuildOverlayOptions {
  /** Simplify tolerance actually applied (degrees), for provenance. */
  tolerance?: number;
  /** Whether the ogr2ogr simplify was actually applied (false when deferred). */
  simplifyApplied?: boolean;
  /** Raw feature count before simplify/normalize, for provenance. */
  featureCountRaw?: number;
  /** Capture run id, for provenance. */
  captureRunId?: string | null;
}

/**
 * Build the province-wide overlay collection carrying proof-v2. Reuses
 * `attachGeometryProof` verbatim: it stamps the collection AND every feature with
 * the exact `proof.schema_version:"2.0" / geometry_source` block and the served
 * source identity (`zone_source_url` = the proved URL, `zone_source_level` =
 * "documented"). A sibling `acquisition` block traces the simplify tolerance and
 * its unit. Geometry is never touched.
 */
export function buildServedBdziOverlay(
  normalized: ReturnType<typeof bdziNormalizer>,
  proof: GeometrySourceProof,
  opts: BuildOverlayOptions = {},
): OverlayFeatureCollection {
  assertGeometryProof(proof);
  const served: OverlayFeatureCollection = {
    type: "FeatureCollection",
    features: normalized.features.map((f) => {
      const feature: OverlayFeature = {
        type: "Feature",
        geometry: f.geometry,
        properties: { ...(f.properties ?? {}) },
      };
      if (f.id !== undefined) feature.id = f.id;
      return feature;
    }),
  };
  // REUSE: same proof-v2 stamping as every served qc-zonage collection.
  attachGeometryProof(served as unknown as ServedZoneGeoJson, proof, {
    url: proof.url,
    level: "documented",
  });
  served.acquisition = {
    constraint: BDZI_CONSTRAINT,
    source_dataset: BDZI_SERVED_COLLECTION_ID,
    source_crs_confirmed: "EPSG:4326",
    simplify: {
      algorithm: "douglas-peucker",
      tool: "ogr2ogr -simplify",
      tolerance: opts.tolerance ?? BDZI_SIMPLIFY,
      unit: "degree",
      applied: opts.simplifyApplied ?? true,
    },
    feature_count_raw: opts.featureCountRaw ?? served.features.length,
    feature_count_served: served.features.length,
    capture_run_id: opts.captureRunId ?? null,
  };
  return served;
}

// ── 6. Readback G5 ─────────────────────────────────────────────────────────────

/** sha256 over the ordered per-feature geometry JSON (byte-exact readback proof). */
export function geometryDigest(features: ReadonlyArray<{ geometry?: unknown }>): string {
  const h = createHash("sha256");
  for (const f of features) h.update(JSON.stringify(f.geometry ?? null));
  return `sha256:${h.digest("hex")}`;
}

export interface LayoutReadback {
  layout: "flat" | "nested";
  key: string;
  meta_key: string;
  present: boolean;
  feature_count: number;
  feature_count_matches: boolean;
  geometry_digest_byte_exact: boolean;
  collection_proof_v2: boolean;
  proof_url_matches: boolean;
  proof_sha_matches: boolean;
  level_documented_all: boolean;
  constraint_tag_all: boolean;
  meta_present: boolean;
  meta_datasetId_ok: boolean;
  ok: boolean;
}

export interface ReadbackExpectation {
  featureCount: number;
  geometryDigest: string;
  proofUrl: string;
  proofSha256: string;
}

function shaBare(value: unknown): string | null {
  return typeof value === "string" ? value.replace(/^sha256:/, "") : null;
}

/**
 * G5 readback of one layout's served bytes against the expectation. Pure: the
 * runner reads S3 and parses; this classifies. `served` may be null (absent).
 */
export function readbackLayout(
  layout: "flat" | "nested",
  key: string,
  served: unknown,
  meta: unknown,
  expected: ReadbackExpectation,
): LayoutReadback {
  const fc = served as OverlayFeatureCollection | null;
  const metaObj = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : null;
  const metaDatasetOk = metaObj?.["datasetId"] === BDZI_SERVED_COLLECTION_ID;
  const base: LayoutReadback = {
    layout,
    key,
    meta_key: overlayMetaKey(key),
    present: false,
    feature_count: 0,
    feature_count_matches: false,
    geometry_digest_byte_exact: false,
    collection_proof_v2: false,
    proof_url_matches: false,
    proof_sha_matches: false,
    level_documented_all: false,
    constraint_tag_all: false,
    meta_present: metaObj !== null,
    meta_datasetId_ok: metaDatasetOk,
    ok: false,
  };
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) return base;
  const feats = fc.features;
  const proof = (fc.proof as { schema_version?: unknown; geometry_source?: { url?: unknown; sha256?: unknown } } | undefined);
  const gs = proof?.geometry_source;
  let levelAll = feats.length > 0;
  let constraintAll = feats.length > 0;
  for (const f of feats) {
    const p = f.properties ?? {};
    if (p["zone_source_level"] !== "documented") levelAll = false;
    if (p["constraint"] !== BDZI_CONSTRAINT) constraintAll = false;
  }
  const result: LayoutReadback = {
    layout,
    key,
    meta_key: overlayMetaKey(key),
    present: true,
    feature_count: feats.length,
    feature_count_matches: feats.length === expected.featureCount,
    geometry_digest_byte_exact: geometryDigest(feats) === expected.geometryDigest,
    collection_proof_v2: proof?.schema_version === "2.0",
    proof_url_matches: gs?.url === expected.proofUrl,
    proof_sha_matches: shaBare(gs?.sha256) === shaBare(expected.proofSha256),
    level_documented_all: levelAll,
    constraint_tag_all: constraintAll,
    meta_present: metaObj !== null,
    meta_datasetId_ok: metaDatasetOk,
    ok: false,
  };
  result.ok =
    result.feature_count_matches &&
    result.geometry_digest_byte_exact &&
    result.collection_proof_v2 &&
    result.proof_url_matches &&
    result.proof_sha_matches &&
    result.level_documented_all &&
    result.constraint_tag_all &&
    result.meta_present &&
    result.meta_datasetId_ok;
  return result;
}
