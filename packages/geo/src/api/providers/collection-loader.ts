/**
 * Shared collection-loading logic for the file- and store-backed providers.
 *
 * Both {@link FileProvider} and `StoreProvider` read the same on-disk format —
 * a `<name>.geojson` ({@link FeatureCollection}, WGS84) paired with an optional
 * sibling `<name>.meta.json` ({@link CollectionMeta}) — and serve it through the
 * same {@link FeatureProvider} surface. The only difference is the byte source:
 * a directory (`fs/promises`) versus a {@link Store} key→bytes object store.
 *
 * This module factors out the source-agnostic parts: parsing a geojson/meta
 * pair into a {@link LoadedCollection}, and the query logic
 * ({@link queryItems}/{@link queryItem}) over a loaded map. Each provider keeps
 * only its own listing + byte-reading code.
 */

import {
  isFeatureCollection,
  resolveLicense,
  type CollectionMeta,
  type FeatureCollection,
  type Geometry,
  type License,
} from "@sentropic/geo-core";

import { geometryBBox, geometryIntersectsBBox, unionBBox, type BBox2D } from "../geo-util.js";
import type {
  CollectionInfo,
  ItemsQuery,
  ItemsResult,
  ServedFeature,
} from "../provider.js";

/**
 * A loaded collection. Geometry may be `null` per feature (referential
 * crosswalks), so the on-disk shape is the broad GeoJSON FeatureCollection
 * rather than the geometry-required {@link AdminFeatureCollection}.
 */
type LoadedFeatureCollection = FeatureCollection<Geometry | null>;

/** A collection materialized in memory, ready to serve. */
export interface LoadedCollection {
  info: CollectionInfo;
  /** Features as served (geometry may be null for referential rows). */
  features: ServedFeature[];
  /** featureId → feature, for O(1) item lookup. */
  byId: Map<string, ServedFeature>;
}

/** A feature's stable id: its GeoJSON `id`, falling back to `properties.geoId`. */
function featureKey(feature: ServedFeature, index: number): string {
  if (feature.id !== undefined && feature.id !== null) return String(feature.id);
  const geoId = feature.properties?.["geoId"];
  if (typeof geoId === "string") return geoId;
  return String(index);
}

/** Type guard for a {@link CollectionMeta} (requires a string `datasetId`). */
export function isMeta(value: unknown): value is CollectionMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { datasetId?: unknown }).datasetId === "string"
  );
}

/** Parse JSON bytes into a {@link CollectionMeta}, or `undefined` if invalid. */
export function parseMeta(raw: string | undefined): CollectionMeta | undefined {
  if (raw === undefined) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    return isMeta(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build a {@link LoadedCollection} from the raw geojson text + optional meta.
 * `stem` is the file's `<name>` (used as the id when meta has no `datasetId`).
 * Returns `undefined` when the geojson is missing or not a FeatureCollection.
 */
export function buildLoadedCollection(
  stem: string,
  geojsonText: string | undefined,
  meta: CollectionMeta | undefined,
): LoadedCollection | undefined {
  if (geojsonText === undefined) return undefined;

  let collection: LoadedFeatureCollection;
  try {
    const raw = JSON.parse(geojsonText) as unknown;
    if (!isFeatureCollection(raw)) return undefined;
    collection = raw as LoadedFeatureCollection;
  } catch {
    return undefined;
  }

  const id = meta?.datasetId ?? stem;
  const license: License = resolveLicense(meta?.license);

  const features = collection.features as ServedFeature[];
  const byId = new Map<string, ServedFeature>();
  let bbox: BBox2D | undefined;
  // Extent is the union of non-null geometries; `geometryBBox(null)` is
  // undefined, so null-geometry referential rows are skipped (no crash) and
  // `extent` is omitted entirely when every feature is null-geometry.
  features.forEach((feature, index) => {
    byId.set(featureKey(feature, index), feature);
    bbox = unionBBox(bbox, geometryBBox(feature.geometry));
  });

  const info: CollectionInfo = {
    id,
    title: meta?.title ?? id,
    license,
    attribution: meta?.attribution ?? license.title,
    crs: meta?.crs ?? "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
    count: meta?.count ?? features.length,
    ...(bbox ? { extent: { bbox } } : {}),
  };

  return { info, features, byId };
}

/** Query a page of items from a loaded map, or `undefined` if id is unknown. */
export function queryItems(
  map: Map<string, LoadedCollection>,
  id: string,
  query: ItemsQuery,
): ItemsResult | undefined {
  const loaded = map.get(id);
  if (!loaded) return undefined;

  const filter = query.bbox;
  const matched = filter
    ? loaded.features.filter((f) => geometryIntersectsBBox(f.geometry, filter))
    : loaded.features;

  const offset = query.offset ?? 0;
  const limit = query.limit ?? matched.length;
  const page = matched.slice(offset, offset + limit);

  return {
    features: page,
    numberMatched: matched.length,
    numberReturned: page.length,
  };
}

/** Look up a single feature from a loaded map. */
export function queryItem(
  map: Map<string, LoadedCollection>,
  id: string,
  featureId: string,
): ServedFeature | undefined {
  return map.get(id)?.byId.get(featureId);
}
