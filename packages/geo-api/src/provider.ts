/**
 * Provider abstraction for the OGC API – Features server.
 *
 * A {@link FeatureProvider} is the data-access seam the Hono app depends on. It
 * exposes the small surface OGC API – Features (Part 1: Core) needs: list/get
 * collections and list/get features (items) within a collection. Concrete
 * providers (file-backed, PostGIS-backed, or an in-memory test fixture) all
 * implement this same interface, so the HTTP layer never talks to a datasource
 * directly.
 */

import type { AdminFeature, BBox, License } from "@sentropic/geo-core";

/**
 * Server-facing description of a collection. This is the normalized shape the
 * app renders into an OGC collection object; it folds the relevant bits of
 * `CollectionMeta` together with a computed `extent` and feature `count`.
 */
export interface CollectionInfo {
  /** Stable collection id (OGC `collectionId` path segment). */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Optional longer description. */
  description?: string;
  /** License governing the data. */
  license: License;
  /** Ready-to-display attribution string. */
  attribution: string;
  /** CRS identifier of the served geometry (canonical OGC CRS URI or EPSG code). */
  crs: string;
  /** Spatial extent of the collection, when known. */
  extent?: { bbox: BBox };
  /** Number of features in the collection. */
  count: number;
}

/** Query parameters accepted by {@link FeatureProvider.getItems}. */
export interface ItemsQuery {
  /** Maximum number of features to return. */
  limit?: number;
  /** Number of features to skip (for paging). */
  offset?: number;
  /** Bounding-box filter `[minx, miny, maxx, maxy]` in WGS84. */
  bbox?: [number, number, number, number];
}

/** Result of an items query. */
export interface ItemsResult {
  /** The page of features matching the query. */
  features: AdminFeature[];
  /** Total number of features matching the filter (ignoring limit/offset). */
  numberMatched: number;
  /** Number of features actually returned in this page. */
  numberReturned: number;
}

/**
 * Read-only data access for the OGC API – Features server. All methods are
 * async so providers may hit disk or a database. Lookups that miss resolve to
 * `undefined` (the app turns that into a 404).
 */
export interface FeatureProvider {
  /** All collections served by this provider. */
  listCollections(): Promise<CollectionInfo[]>;
  /** A single collection by id, or `undefined` if unknown. */
  getCollection(id: string): Promise<CollectionInfo | undefined>;
  /**
   * A page of features from a collection, or `undefined` if the collection is
   * unknown (distinct from a known collection that yields zero features).
   */
  getItems(id: string, query: ItemsQuery): Promise<ItemsResult | undefined>;
  /** A single feature by id, or `undefined` if collection/feature is unknown. */
  getItem(id: string, featureId: string): Promise<AdminFeature | undefined>;
}
