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

// CSV acquisition: RFC 4180 parser + referential column mapper.
export {
  csvColumnMapper,
  parseCsv,
  type CsvColumnMapping,
  type CsvNormalizer,
  type ParseCsvOptions,
  type ParsedCsv,
} from "./csv.js";

// ArcGIS REST fetcher.
export { ARCGIS_QUERY_DEFAULTS, arcgisQueryUrl } from "./arcgis.js";

// GDAL-backed bulk acquisition (gpkg/shp/fgdb).
export {
  DEFAULT_SIMPLIFY_TOLERANCE,
  buildOgr2OgrArgs,
  extractLayerToGeoJson,
  listLayers,
  parseOgrinfoLayers,
  runOgr2Ogr,
  vsizipPath,
  type CommandResult,
  type CommandRunner,
  type DiscoveredLayer,
  type ExtractOptions,
  type ExtractResult,
  type GdalFormat,
} from "./gdal.js";

// High-level acquire + persistence.
export { acquire, writeNormalized, type AcquireOptions } from "./acquire.js";
