import { createHash } from "node:crypto";

import { LICENSES, WGS84, type CollectionMeta } from "@sentropic/geo-core";
import { featureCollection } from "@turf/helpers";
import intersect from "@turf/intersect";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";

import {
  extractLayerToGeoJson,
  type CommandRunner,
  type DiscoveredLayer,
} from "../acquire/gdal.js";

export const CPTAQ_LAYER = "zone_agricole_s";
export const CPTAQ_DATASET = "zone-agricole-transposee";
export const CPTAQ_UPSTREAM_URI =
  "https://carto.cptaq.gouv.qc.ca/data/shapefiles/ZA_transposee.zip";
export const CPTAQ_CONSTRAINT_KIND = "cptaq-zone-agricole";
export const CPTAQ_CAVEAT = "transposee != plan legal officiel";
const CPTAQ_SOURCE_ID = "ca-qc/cptaq-zone-agricole";
const CPTAQ_ATTRIBUTION = "© CPTAQ, Gouvernement du Québec (CC-BY-4.0)";
const CPTAQ_USAGE_NOTICE =
  "Transposée au cadastre — n'est PAS le plan légal officiel (D07)";
export const CPTAQ_TARGET_CRS = "EPSG:4326";
export const CPTAQ_SERVED_PREFIX = "normalized/ca-qc-constraints";
export const CPTAQ_PREPROD_BUCKET = "sentropic-geo-preprod";
export const CPTAQ_PROPERTY_WHITELIST = ["Mrc", "Date_maj", "Zonage"] as const;

export const CPTAQ_PHASE1_CITIES = [
  { slug: "warden", code: "47030", name: "Warden" },
  {
    slug: "saint-stanislas-de-kostka",
    code: "70040",
    name: "Saint-Stanislas-de-Kostka",
  },
  { slug: "sutton", code: "46058", name: "Sutton" },
  { slug: "coaticook", code: "44037", name: "Coaticook" },
] as const;

export type CptaqCitySlug = (typeof CPTAQ_PHASE1_CITIES)[number]["slug"];
export type PolygonalGeometry = Polygon | MultiPolygon;

export interface CptaqGeometrySourceProof {
  url: string;
  method: string;
  retrieved_at: string;
  sha256: `sha256:${string}`;
}

export interface CptaqBuildContext {
  bucket: string;
  rawArtifactUri: string;
  captureManifestUri: string;
  boundaryArtifactUri: string;
  boundarySha256: `sha256:${string}`;
  sourceCrsWkt: string;
  proof: CptaqGeometrySourceProof;
}

export interface CptaqSourceProperties {
  [key: string]: unknown;
  Mrc: unknown;
  Date_maj: unknown;
  Zonage: unknown;
}

export interface CptaqServedProperties extends CptaqSourceProperties {
  constraint_kind: typeof CPTAQ_CONSTRAINT_KIND;
  constraint_ref: string;
  source: {
    dataset: typeof CPTAQ_DATASET;
    version: `sha256:${string}`;
    artifact_uri: string;
    upstream_uri: typeof CPTAQ_UPSTREAM_URI;
  };
  caveat: typeof CPTAQ_CAVEAT;
}

export interface CptaqServedCollection
  extends FeatureCollection<MultiPolygon, CptaqServedProperties> {
  name: string;
  bbox: [number, number, number, number];
  emprise: {
    bbox: [number, number, number, number];
    polygon: MultiPolygon;
  };
  proof: {
    schema_version: "2.0";
    geometry_source: CptaqGeometrySourceProof;
  };
  provenance: {
    raw_capture: {
      artifact_uri: string;
      manifest_uri: string;
    };
    municipal_boundary: {
      artifact_uri: string;
      sha256: `sha256:${string}`;
      city_slug: CptaqCitySlug;
      mamh_code: string;
      name: string;
    };
    transform: {
      layer: typeof CPTAQ_LAYER;
      source_crs_wkt: string;
      target_crs: typeof CPTAQ_TARGET_CRS;
      rfc7946: true;
      geometry_type: "MultiPolygon";
      simplify: { method: "NONE"; tolerance: null };
      clip: { method: "EXACT_GEOM/intersection" };
      emprise: { method: "source bbox polygon intersect municipal boundary" };
      property_whitelist: typeof CPTAQ_PROPERTY_WHITELIST;
      constraint_ref_method: "sha256(canonical source geometry + whitelisted properties)";
    };
  };
  cas_pointer: {
    flat_uri: string;
    nested_uri: string;
  };
}

export interface CptaqLayout {
  collection: string;
  flatCollectionKey: string;
  nestedCollectionKey: string;
  flatMetaKey: string;
  nestedMetaKey: string;
  snapshotPrefix: string;
  flatLatestKey: string;
  nestedLatestKey: string;
}

export interface CptaqPublication {
  citySlug: CptaqCitySlug;
  collection: CptaqServedCollection;
  collectionBytes: Uint8Array;
  metaBytes: Uint8Array;
  snapshotSha256: `sha256:${string}`;
  snapshotKey: string;
  pointerBytes: Uint8Array;
  layout: CptaqLayout;
}

export interface CptaqPublishStore {
  bucket: string;
  read(key: string): Promise<{ bytes: Uint8Array; etag: string | null } | null>;
  putIfAbsent(key: string, body: Uint8Array, contentType: string): Promise<boolean>;
  putIfCurrent(
    key: string,
    body: Uint8Array,
    priorEtag: string | null,
    contentType: string,
  ): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("CPTAQ canonical JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error(`CPTAQ canonical JSON rejects ${typeof value}`);
}

export function assertCptaqPreprodBucket(bucket: string): void {
  if (bucket !== CPTAQ_PREPROD_BUCKET) {
    throw new Error(
      `CPTAQ normalize/serve refuses bucket ${bucket || "(empty)"}; only ${CPTAQ_PREPROD_BUCKET} is writable`,
    );
  }
}

export function cptaqLayout(citySlug: CptaqCitySlug): CptaqLayout {
  const collection = `ca-qc-constraints-${citySlug}`;
  const root = `${CPTAQ_SERVED_PREFIX}/${collection}`;
  return {
    collection,
    flatCollectionKey: `${root}.geojson`,
    nestedCollectionKey: `${root}/${collection}.geojson`,
    flatMetaKey: `${root}.meta.json`,
    nestedMetaKey: `${root}/${collection}.meta.json`,
    snapshotPrefix: `${root}/_snapshots/`,
    flatLatestKey: `${root}.latest.json`,
    nestedLatestKey: `${root}/latest.json`,
  };
}

export function assertCptaqWritableKey(key: string): void {
  const valid = CPTAQ_PHASE1_CITIES.some((city) => {
    const layout = cptaqLayout(city.slug);
    return (
      key === layout.flatCollectionKey ||
      key === layout.nestedCollectionKey ||
      key === layout.flatMetaKey ||
      key === layout.nestedMetaKey ||
      key === layout.flatLatestKey ||
      key === layout.nestedLatestKey ||
      (key.startsWith(layout.snapshotPrefix) && /^[a-f0-9]{64}\.geojson$/.test(key.slice(layout.snapshotPrefix.length)))
    );
  });
  if (!valid) throw new Error(`CPTAQ normalize/serve refuses key outside Phase-1 served layouts: ${key}`);
}

function toMultiPolygon(geometry: PolygonalGeometry): MultiPolygon {
  return geometry.type === "MultiPolygon"
    ? geometry
    : { type: "MultiPolygon", coordinates: [geometry.coordinates] };
}

function visitPositions(geometry: PolygonalGeometry, visitor: (position: Position) => void): void {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) for (const ring of polygon) for (const position of ring) visitor(position);
}

function assertWgs84Geometry(geometry: PolygonalGeometry, label: string): void {
  visitPositions(geometry, (position) => {
    if (
      position.length !== 2 ||
      typeof position[0] !== "number" ||
      typeof position[1] !== "number" ||
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1]) ||
      position[0] < -180 ||
      position[0] > 180 ||
      position[1] < -90 ||
      position[1] > 90
    ) {
      throw new Error(`${label}: expected two-dimensional WGS84/RFC7946 coordinates`);
    }
  });
}

function bboxOf(geometry: PolygonalGeometry): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  visitPositions(geometry, ([x, y]) => {
    minX = Math.min(minX, x!);
    minY = Math.min(minY, y!);
    maxX = Math.max(maxX, x!);
    maxY = Math.max(maxY, y!);
  });
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error("CPTAQ emprise is empty");
  return [minX, minY, maxX, maxY];
}

function datasetExtent(
  source: FeatureCollection<PolygonalGeometry, Record<string, unknown>>,
): Polygon {
  if (source.features.length === 0) {
    throw new Error("CPTAQ dataset emprise is UNKNOWN: source contains no polygon");
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const feature of source.features) {
    const [x1, y1, x2, y2] = bboxOf(feature.geometry);
    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  }
  return {
    type: "Polygon",
    coordinates: [[
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
      [minX, minY],
    ]],
  };
}

export function assertCptaqSourceProperties(value: unknown): CptaqSourceProperties {
  if (!isRecord(value)) throw new Error("CPTAQ source feature properties must be an object");
  const unexpected = Object.keys(value).filter(
    (key) => !(CPTAQ_PROPERTY_WHITELIST as readonly string[]).includes(key),
  );
  if (unexpected.length > 0) {
    throw new Error(`CPTAQ property whitelist rejected: ${unexpected.sort().join(", ")}`);
  }
  return {
    Mrc: value["Mrc"] ?? null,
    Date_maj: value["Date_maj"] ?? null,
    Zonage: value["Zonage"] ?? null,
  };
}

function asPolygonalFeatureCollection(
  value: unknown,
  label: string,
): FeatureCollection<PolygonalGeometry, Record<string, unknown>> {
  if (!isRecord(value) || value["type"] !== "FeatureCollection" || !Array.isArray(value["features"])) {
    throw new Error(`${label}: GeoJSON FeatureCollection required`);
  }
  for (const [index, raw] of value["features"].entries()) {
    if (!isRecord(raw) || raw["type"] !== "Feature" || !isRecord(raw["geometry"])) {
      throw new Error(`${label}: feature ${index} is invalid`);
    }
    const type = raw["geometry"]["type"];
    if (type !== "Polygon" && type !== "MultiPolygon") {
      throw new Error(`${label}: feature ${index} must be Polygon/MultiPolygon, received ${String(type)}`);
    }
    assertWgs84Geometry(raw["geometry"] as unknown as PolygonalGeometry, `${label}: feature ${index}`);
  }
  return value as unknown as FeatureCollection<PolygonalGeometry, Record<string, unknown>>;
}

export function selectCptaqPhase1Boundaries(
  rawBoundaries: unknown,
): Map<CptaqCitySlug, Feature<PolygonalGeometry, Record<string, unknown>>> {
  const boundaries = asPolygonalFeatureCollection(rawBoundaries, "qc-municipalites boundaries");
  const selected = new Map<CptaqCitySlug, Feature<PolygonalGeometry, Record<string, unknown>>>();
  for (const city of CPTAQ_PHASE1_CITIES) {
    const matches = boundaries.features.filter(
      (feature) => feature.properties["code"] === city.code && feature.properties["name"] === city.name,
    );
    if (matches.length !== 1) {
      throw new Error(
        `qc-municipalites boundary ${city.slug} expected one exact code/name match (${city.code}/${city.name}), received ${matches.length}`,
      );
    }
    selected.set(city.slug, matches[0]!);
  }
  return selected;
}

function constraintRef(
  geometry: PolygonalGeometry,
  properties: CptaqSourceProperties,
): string {
  const digest = sha256(canonicalJson({ geometry, properties })).slice("sha256:".length);
  return `${CPTAQ_CONSTRAINT_KIND}:${digest}`;
}

function assertBuildContext(context: CptaqBuildContext): void {
  assertCptaqPreprodBucket(context.bucket);
  if (!context.sourceCrsWkt.trim()) throw new Error("CPTAQ source CRS WKT is required from the .prj");
  if (!/^https:\/\//.test(context.proof.url)) {
    throw new Error("CPTAQ proof URL must be the actual HTTPS response URL from the capture manifest");
  }
  if (!context.proof.method.trim()) throw new Error("CPTAQ proof method is required");
  if (Number.isNaN(Date.parse(context.proof.retrieved_at))) throw new Error("CPTAQ proof retrieved_at is invalid");
  if (!/^sha256:[a-f0-9]{64}$/.test(context.proof.sha256)) throw new Error("CPTAQ proof sha256 is invalid");
  const digest = context.proof.sha256.slice("sha256:".length);
  if (
    context.rawArtifactUri !== `s3://${context.bucket}/raw/cptaq/cas/${digest}.bin` &&
    context.rawArtifactUri !== `s3://${context.bucket}/raw/cptaq/cas/${digest}.zip`
  ) {
    throw new Error("CPTAQ raw artifact URI is not the proof-bound preprod CAS object");
  }
  if (!context.captureManifestUri.startsWith(`s3://${context.bucket}/capture/_runs/`)) {
    throw new Error("CPTAQ capture manifest must be under preprod capture/_runs");
  }
  if (!context.boundaryArtifactUri.startsWith(`s3://${context.bucket}/normalized/`)) {
    throw new Error("CPTAQ municipal boundary must be a served preprod object");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(context.boundarySha256)) {
    throw new Error("CPTAQ municipal boundary sha256 is invalid");
  }
}

function collectionForCity(
  city: (typeof CPTAQ_PHASE1_CITIES)[number],
  source: FeatureCollection<PolygonalGeometry, Record<string, unknown>>,
  boundary: Feature<PolygonalGeometry, Record<string, unknown>>,
  context: CptaqBuildContext,
): CptaqServedCollection {
  const layout = cptaqLayout(city.slug);
  const extent = datasetExtent(source);
  const attrsByRef = new Map<string, CptaqSourceProperties>();
  const geometryByRef = new Map<string, PolygonalGeometry>();
  for (const [index, feature] of source.features.entries()) {
    const attrs = assertCptaqSourceProperties(feature.properties);
    const ref = constraintRef(feature.geometry, attrs);
    if (attrsByRef.has(ref)) throw new Error(`CPTAQ duplicate deterministic constraint_ref at feature ${index}: ${ref}`);
    attrsByRef.set(ref, attrs);
    geometryByRef.set(ref, feature.geometry);
  }

  const features: Array<Feature<MultiPolygon, CptaqServedProperties>> = [];
  for (const ref of [...geometryByRef.keys()].sort()) {
    const geometry = geometryByRef.get(ref)!;
    const hit = intersect(featureCollection([
      { type: "Feature", properties: {}, geometry },
      { type: "Feature", properties: {}, geometry: boundary.geometry },
    ]));
    if (!hit) continue;
    const clipped = toMultiPolygon(hit.geometry);
    assertWgs84Geometry(clipped, `${layout.collection}/${ref}`);
    const attrs = attrsByRef.get(ref)!;
    features.push({
      type: "Feature",
      geometry: clipped,
      properties: {
        constraint_kind: CPTAQ_CONSTRAINT_KIND,
        constraint_ref: ref,
        Mrc: attrs.Mrc,
        Date_maj: attrs.Date_maj,
        Zonage: attrs.Zonage,
        source: {
          dataset: CPTAQ_DATASET,
          version: context.proof.sha256,
          artifact_uri: context.rawArtifactUri,
          upstream_uri: CPTAQ_UPSTREAM_URI,
        },
        caveat: CPTAQ_CAVEAT,
      },
    });
  }

  const covered = intersect(featureCollection([
    { type: "Feature", properties: {}, geometry: extent },
    { type: "Feature", properties: {}, geometry: boundary.geometry },
  ]));
  if (!covered) {
    throw new Error(`CPTAQ source emprise does not cover Phase-1 city ${city.slug}`);
  }
  const emprise = toMultiPolygon(covered.geometry);
  const bbox = bboxOf(emprise);
  return {
    type: "FeatureCollection",
    name: layout.collection,
    bbox,
    features,
    emprise: { bbox, polygon: emprise },
    proof: { schema_version: "2.0", geometry_source: context.proof },
    provenance: {
      raw_capture: {
        artifact_uri: context.rawArtifactUri,
        manifest_uri: context.captureManifestUri,
      },
      municipal_boundary: {
        artifact_uri: context.boundaryArtifactUri,
        sha256: context.boundarySha256,
        city_slug: city.slug,
        mamh_code: city.code,
        name: city.name,
      },
      transform: {
        layer: CPTAQ_LAYER,
        source_crs_wkt: context.sourceCrsWkt,
        target_crs: CPTAQ_TARGET_CRS,
        rfc7946: true,
        geometry_type: "MultiPolygon",
        simplify: { method: "NONE", tolerance: null },
        clip: { method: "EXACT_GEOM/intersection" },
        emprise: { method: "source bbox polygon intersect municipal boundary" },
        property_whitelist: CPTAQ_PROPERTY_WHITELIST,
        constraint_ref_method: "sha256(canonical source geometry + whitelisted properties)",
      },
    },
    cas_pointer: {
      flat_uri: `s3://${context.bucket}/${layout.flatLatestKey}`,
      nested_uri: `s3://${context.bucket}/${layout.nestedLatestKey}`,
    },
  };
}

export function buildCptaqServedCollections(input: {
  source: unknown;
  boundaries: unknown;
  context: CptaqBuildContext;
}): CptaqServedCollection[] {
  assertBuildContext(input.context);
  const source = asPolygonalFeatureCollection(input.source, "CPTAQ zone_agricole_s");
  const boundaries = selectCptaqPhase1Boundaries(input.boundaries);
  return CPTAQ_PHASE1_CITIES.map((city) =>
    collectionForCity(city, source, boundaries.get(city.slug)!, input.context),
  );
}

const CPTAQ_SERVED_PROPERTY_KEYS = [
  "constraint_kind",
  "constraint_ref",
  "Mrc",
  "Date_maj",
  "Zonage",
  "source",
  "caveat",
] as const;

/** Runtime deposit guard: TypeScript types cannot prevent a parsed object from
 * smuggling an extra source attribute into S3. Every final feature is checked
 * again immediately before canonical serialization. */
export function assertCptaqDepositGuard(collection: CptaqServedCollection): void {
  for (const [index, feature] of collection.features.entries()) {
    if (feature.geometry.type !== "MultiPolygon") {
      throw new Error(`CPTAQ deposit guard feature ${index}: MultiPolygon required`);
    }
    assertWgs84Geometry(feature.geometry, `CPTAQ deposit guard feature ${index}`);
    if (!isRecord(feature.properties)) {
      throw new Error(`CPTAQ deposit guard feature ${index}: properties object required`);
    }
    const unexpected = Object.keys(feature.properties).filter(
      (key) => !(CPTAQ_SERVED_PROPERTY_KEYS as readonly string[]).includes(key),
    );
    const missing = CPTAQ_SERVED_PROPERTY_KEYS.filter(
      (key) => !Object.hasOwn(feature.properties, key),
    );
    if (unexpected.length > 0 || missing.length > 0) {
      throw new Error(
        `CPTAQ deposit property whitelist rejected feature ${index}: ` +
          `unexpected=${unexpected.sort().join(",") || "NONE"}; ` +
          `missing=${missing.join(",") || "NONE"}`,
      );
    }
    if (feature.properties["constraint_kind"] !== CPTAQ_CONSTRAINT_KIND) {
      throw new Error(`CPTAQ deposit guard feature ${index}: invalid constraint_kind`);
    }
    if (!/^cptaq-zone-agricole:[a-f0-9]{64}$/.test(feature.properties["constraint_ref"])) {
      throw new Error(`CPTAQ deposit guard feature ${index}: invalid constraint_ref`);
    }
    if (feature.properties["caveat"] !== CPTAQ_CAVEAT) {
      throw new Error(`CPTAQ deposit guard feature ${index}: invalid caveat`);
    }
    for (const key of CPTAQ_PROPERTY_WHITELIST) {
      const value = feature.properties[key];
      if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
        throw new Error(`CPTAQ deposit guard feature ${index}: ${key} must be scalar or null`);
      }
    }
    const source = feature.properties["source"];
    if (!isRecord(source) || Object.keys(source).sort().join(",") !==
      ["artifact_uri", "dataset", "upstream_uri", "version"].sort().join(",")) {
      throw new Error(`CPTAQ deposit guard feature ${index}: invalid source provenance shape`);
    }
    if (
      source["dataset"] !== CPTAQ_DATASET ||
      source["upstream_uri"] !== CPTAQ_UPSTREAM_URI ||
      typeof source["version"] !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(source["version"]) ||
      typeof source["artifact_uri"] !== "string" ||
      !source["artifact_uri"].startsWith(
        `s3://${CPTAQ_PREPROD_BUCKET}/raw/cptaq/cas/${source["version"].slice("sha256:".length)}.`,
      )
    ) {
      throw new Error(`CPTAQ deposit guard feature ${index}: invalid source provenance values`);
    }
  }
}

export async function extractCptaqLayer(
  archivePath: string,
  runner?: CommandRunner,
): Promise<{ source: unknown; sourceCrsWkt: string; layers: DiscoveredLayer[] }> {
  const result = await extractLayerToGeoJson({
    archivePath,
    layer: CPTAQ_LAYER,
    tolerance: null,
    coordinatePrecision: null,
    inspectSourceCrs: true,
    ...(runner !== undefined ? { runner } : {}),
  });
  const layer = result.layers.find((candidate) => candidate.name === CPTAQ_LAYER);
  if (!layer) throw new Error(`CPTAQ archive does not contain required layer ${CPTAQ_LAYER}`);
  if (!layer.geometryType || !/polygon/i.test(layer.geometryType)) {
    throw new Error(`CPTAQ layer ${CPTAQ_LAYER} must be POLYGON, received ${layer.geometryType ?? "UNKNOWN"}`);
  }
  if (!result.sourceCrs) throw new Error("CPTAQ source CRS is UNKNOWN; internal .prj was not read");
  asPolygonalFeatureCollection(result.geojson, "CPTAQ GDAL output");
  return { source: result.geojson, sourceCrsWkt: result.sourceCrs, layers: result.layers };
}

export function prepareCptaqPublications(
  collections: readonly CptaqServedCollection[],
  bucket: string,
): CptaqPublication[] {
  assertCptaqPreprodBucket(bucket);
  if (collections.length !== CPTAQ_PHASE1_CITIES.length) {
    throw new Error(`CPTAQ Phase-1 requires ${CPTAQ_PHASE1_CITIES.length} collections`);
  }
  return collections.map((collection) => {
    assertCptaqDepositGuard(collection);
    const city = CPTAQ_PHASE1_CITIES.find((candidate) => collection.name === cptaqLayout(candidate.slug).collection);
    if (!city) throw new Error(`CPTAQ collection name is outside Phase-1: ${collection.name}`);
    const layout = cptaqLayout(city.slug);
    const collectionBytes = new TextEncoder().encode(`${canonicalJson(collection)}\n`);
    const snapshotSha256 = sha256(collectionBytes);
    const snapshotKey = `${layout.snapshotPrefix}${snapshotSha256.slice("sha256:".length)}.geojson`;
    const meta: CollectionMeta = {
      sourceId: CPTAQ_SOURCE_ID,
      datasetId: layout.collection,
      title: `Zone agricole protégée (CPTAQ transposée) — ${city.name}`,
      license: LICENSES["cc-by-4.0"],
      attribution: CPTAQ_ATTRIBUTION,
      crs: WGS84,
      fetchedAt: collection.proof.geometry_source.retrieved_at,
      count: collection.features.length,
      rights: {
        profile: "open",
        licenseStatus: "explicit",
        usageNotice: CPTAQ_USAGE_NOTICE,
      },
    };
    const pointer = {
      schema_version: "1.0.0",
      contract: "ca-qc-constraints-latest",
      collection: layout.collection,
      snapshot_sha256: snapshotSha256,
      snapshot_s3_uri: `s3://${bucket}/${snapshotKey}`,
      served_s3_uris: {
        flat: `s3://${bucket}/${layout.flatCollectionKey}`,
        nested: `s3://${bucket}/${layout.nestedCollectionKey}`,
      },
      source_retrieved_at: collection.proof.geometry_source.retrieved_at,
    };
    return {
      citySlug: city.slug,
      collection,
      collectionBytes,
      metaBytes: new TextEncoder().encode(`${canonicalJson(meta)}\n`),
      snapshotSha256,
      snapshotKey,
      pointerBytes: new TextEncoder().encode(`${canonicalJson(pointer)}\n`),
      layout,
    };
  });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function putSnapshot(
  store: CptaqPublishStore,
  publication: CptaqPublication,
): Promise<void> {
  assertCptaqWritableKey(publication.snapshotKey);
  const created = await store.putIfAbsent(
    publication.snapshotKey,
    publication.collectionBytes,
    "application/geo+json",
  );
  if (created) return;
  const existing = await store.read(publication.snapshotKey);
  if (!existing || !bytesEqual(existing.bytes, publication.collectionBytes)) {
    throw new Error(`CPTAQ immutable snapshot collision: ${publication.snapshotKey}`);
  }
}

async function replaceCurrent(
  store: CptaqPublishStore,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  assertCptaqWritableKey(key);
  const prior = await store.read(key);
  await store.putIfCurrent(key, body, prior?.etag ?? null, contentType);
}

export async function publishCptaqPublications(
  store: CptaqPublishStore,
  publications: readonly CptaqPublication[],
  dryRun: boolean,
): Promise<{ dryRun: boolean; objectCount: number }> {
  assertCptaqPreprodBucket(store.bucket);
  for (const publication of publications) {
    assertCptaqWritableKey(publication.snapshotKey);
    assertCptaqWritableKey(publication.layout.flatCollectionKey);
    assertCptaqWritableKey(publication.layout.nestedCollectionKey);
    assertCptaqWritableKey(publication.layout.flatMetaKey);
    assertCptaqWritableKey(publication.layout.nestedMetaKey);
    assertCptaqWritableKey(publication.layout.flatLatestKey);
    assertCptaqWritableKey(publication.layout.nestedLatestKey);
  }
  const objectCount = publications.length * 7;
  if (dryRun) return { dryRun: true, objectCount };

  for (const publication of publications) await putSnapshot(store, publication);
  for (const publication of publications) {
    await replaceCurrent(
      store,
      publication.layout.flatCollectionKey,
      publication.collectionBytes,
      "application/geo+json",
    );
    await replaceCurrent(
      store,
      publication.layout.flatMetaKey,
      publication.metaBytes,
      "application/json",
    );
    await replaceCurrent(
      store,
      publication.layout.nestedCollectionKey,
      publication.collectionBytes,
      "application/geo+json",
    );
    await replaceCurrent(
      store,
      publication.layout.nestedMetaKey,
      publication.metaBytes,
      "application/json",
    );
  }
  for (const publication of publications) {
    await replaceCurrent(
      store,
      publication.layout.flatLatestKey,
      publication.pointerBytes,
      "application/json",
    );
    await replaceCurrent(
      store,
      publication.layout.nestedLatestKey,
      publication.pointerBytes,
      "application/json",
    );
  }
  return { dryRun: false, objectCount };
}
