/**
 * @sentropic/geo-source-ca — Canada federal administrative boundaries.
 *
 * Statistics Canada 2021 Census cartographic boundary files (provinces &
 * territories, census divisions), OGL-Canada, distributed as zipped ESRI
 * shapefiles (EPSG:3347) acquired via GDAL. Exposes a {@link SourceManifest}
 * with the priority dataset `ca-provinces` (the 13 provinces & territories) plus
 * a declared `ca-census-divisions`, and a matching {@link Normalizer} per
 * dataset, so the `geo` CLI can wire `acquire(manifest, id, { normalizer })`.
 */

import type { SourceManifest } from "@sentropic/geo-core";
import type { Normalizer } from "@sentropic/geo-core";

import { DATASET_CENSUS_DIVISIONS, DATASET_PROVINCES, manifest } from "./manifest.js";
import { censusDivisionsNormalizer, provincesNormalizer } from "./normalizers.js";

export const VERSION = "0.1.0";

export {
  manifest,
  SOURCE_ID,
  PR_SHP_ZIP_URL,
  CD_SHP_ZIP_URL,
  STATCAN_LAYERS,
  DATASET_PROVINCES,
  DATASET_CENSUS_DIVISIONS,
} from "./manifest.js";

export {
  provincesNormalizer,
  censusDivisionsNormalizer,
  isoForPruid,
  levelForPruid,
} from "./normalizers.js";

/** Normalizers keyed by dataset id, ready to pass to `acquire(..., { normalizer })`. */
export const normalizers: Record<string, Normalizer> = {
  [DATASET_PROVINCES]: provincesNormalizer,
  [DATASET_CENSUS_DIVISIONS]: censusDivisionsNormalizer,
};

/** A registered source: its manifest plus the per-dataset normalizers. */
export interface RegisteredSource {
  manifest: SourceManifest;
  normalizers: Record<string, Normalizer>;
}

/**
 * Register the Statistics Canada boundary source. Returns the manifest and the
 * per-dataset normalizers so a host (the `geo` CLI) can build a source registry
 * and call `acquire(manifest, datasetId, { normalizer: normalizers[datasetId] })`.
 */
export function registerSource(): RegisteredSource {
  return { manifest, normalizers };
}
