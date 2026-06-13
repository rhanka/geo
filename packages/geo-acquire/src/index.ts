/**
 * @sentropic/geo-acquire — geographic data acquisition engine.
 *
 * Downloads source datasets (with a content-addressed cache and SHA-256
 * checksums), enforces a redistribution license gate, and normalizes the raw
 * payload into a standard WGS84 {@link NormalizedDataset} consumable by the
 * `geo` CLI and the API. Built on the dependency-free `@sentropic/geo-core`
 * domain model.
 */

export const VERSION = "0.1.0";

// Download + cache + checksum.
export {
  DEFAULT_CACHE_DIR,
  download,
  sha256Hex,
  type DownloadOptions,
  type DownloadResult,
} from "./download.js";

// License gate.
export { LicenseError, assertRedistributable } from "./license-gate.js";

// Normalizer plumbing.
export {
  featuresToCollection,
  geojsonPassthrough,
  type NormalizeContext,
  type Normalizer,
} from "./normalize.js";

// ArcGIS REST fetcher.
export { ARCGIS_QUERY_DEFAULTS, arcgisQueryUrl } from "./arcgis.js";

// High-level acquire + persistence.
export { acquire, writeNormalized, type AcquireOptions } from "./acquire.js";
