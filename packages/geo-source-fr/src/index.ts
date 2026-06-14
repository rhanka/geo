/**
 * @sentropic/geo-source-fr — French administrative boundaries.
 *
 * IGN « ADMIN EXPRESS COG CARTO » (whole-France WGS84 delivery), under Licence
 * Ouverte / Open Licence 2.0 (Etalab), distributed as a bulk GeoPackage.
 * Exposes a {@link SourceManifest} with three datasets (`fr-regions`,
 * `fr-departements`, `fr-communes`) and a matching {@link Normalizer} per
 * dataset, so a host (the `geo` CLI) can wire acquisition.
 */

import type { SourceManifest } from "@sentropic/geo-core";
import type { Normalizer } from "@sentropic/geo-core";

import {
  DATASET_COMMUNES,
  DATASET_DEPARTEMENTS,
  DATASET_REGIONS,
  manifest,
} from "./manifest.js";
import {
  communesNormalizer,
  departementsNormalizer,
  regionsNormalizer,
} from "./normalizers.js";

export const VERSION = "0.1.0";

export {
  manifest,
  SOURCE_ID,
  ADMIN_EXPRESS_7Z_URL,
  ADMIN_EXPRESS_INNER_GPKG,
  ADMIN_EXPRESS_HOMEPAGE,
  ADE_LAYERS,
  DATASET_REGIONS,
  DATASET_DEPARTEMENTS,
  DATASET_COMMUNES,
} from "./manifest.js";

export {
  regionsNormalizer,
  departementsNormalizer,
  communesNormalizer,
  REGION_INSEE_TO_ISO,
} from "./normalizers.js";

/** Normalizers keyed by dataset id, ready to pass to `acquire(..., { normalizer })`. */
export const normalizers: Record<string, Normalizer> = {
  [DATASET_REGIONS]: regionsNormalizer,
  [DATASET_DEPARTEMENTS]: departementsNormalizer,
  [DATASET_COMMUNES]: communesNormalizer,
};

/** A registered source: its manifest plus the per-dataset normalizers. */
export interface RegisteredSource {
  manifest: SourceManifest;
  normalizers: Record<string, Normalizer>;
}

/**
 * Register the French ADMIN EXPRESS source. Returns the manifest and the
 * per-dataset normalizers so a host (the `geo` CLI) can build a source registry
 * and call `acquire(manifest, datasetId, { normalizer: normalizers[datasetId] })`.
 */
export function registerSource(): RegisteredSource {
  return { manifest, normalizers };
}
