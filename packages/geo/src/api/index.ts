/**
 * @sentropic/geo-api — an OGC API – Features (Part 1: Core) server.
 *
 * Serves administrative boundaries as GeoJSON over HTTP, decoupled from its
 * datasource via the {@link FeatureProvider} abstraction. Ships a file-backed
 * provider (normalized GeoJSON on disk) and a PostGIS-backed provider.
 */

export const VERSION = "0.1.0";

export { createApp } from "./app.js";

export { FileProvider, DEFAULT_DATA_DIR } from "./providers/file-provider.js";
export { StoreProvider } from "./providers/store-provider.js";
export { makeProvider, isStoreUri } from "./providers/make-provider.js";
export { PostgisProvider } from "./providers/postgis-provider.js";

export {
  CONFORMANCE_CLASSES,
  CRS84_URI,
  MEDIA_GEOJSON,
  MEDIA_JSON,
  MEDIA_OPENAPI,
  renderCollection,
} from "./ogc.js";
export { buildOpenApi } from "./openapi.js";

export type { Link, OgcCollection } from "./ogc.js";
export type {
  CollectionInfo,
  FeatureProvider,
  ItemsQuery,
  ItemsResult,
} from "./provider.js";
export type {
  PostgisProviderConfig,
  TableMapping,
} from "./providers/postgis-provider.js";
