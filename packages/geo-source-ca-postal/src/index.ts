/**
 * @sentropic/geo-source-ca-postal — Canadian postal referential.
 *
 * Statistics Canada 2021 Census cartographic boundary file — **Forward Sortation
 * Areas (FSA)**, the first three characters of a postal code — under the Open
 * Government Licence – Canada (`ogl-ca`), distributed as a zipped ESRI shapefile
 * (EPSG:3347) acquired via GDAL. Exposes a {@link SourceManifest} with one
 * geometry-bearing dataset (`ca-fsa`) and a matching **referential** normalizer,
 * so a host (the `geo` CLI) can wire
 * `acquire(manifest, "ca-fsa", { referentialNormalizer })` — emitting a
 * {@link ReferentialFeatureCollection} (geometry kept) rather than admin units.
 *
 * Geometry data (~1 643 FSA polygons, multi-MB) goes to S3 (ADR-0012), not git.
 */

import type {
  ReferentialFeatureCollection,
  SourceManifest,
} from "@sentropic/geo-core";
import type { NormalizeContext } from "@sentropic/geo-acquire";

import { DATASET_FSA, manifest } from "./manifest.js";
import { fsaReferentialNormalizer } from "./normalizers.js";

export const VERSION = "0.1.0";

export {
  manifest,
  SOURCE_ID,
  DATASET_FSA,
  FSA_SHP_ZIP_URL,
  FSA_INNER,
  FSA_LAYER,
} from "./manifest.js";

export { fsaReferentialNormalizer, fsaGeoId, isoForPruid } from "./normalizers.js";

/**
 * A geometry-bearing referential normalizer: maps the `ogr2ogr` GeoJSON to a
 * {@link ReferentialFeatureCollection}. Matches the `referentialNormalizer`
 * option of `acquire` (geo-acquire does not export this alias).
 */
export type ReferentialNormalizer = (
  raw: unknown,
  ctx: NormalizeContext,
) => ReferentialFeatureCollection;

/**
 * The package's single referential normalizer, re-exported under the conventional
 * `referentialNormalizer` name for callers acquiring the one dataset directly.
 */
export const referentialNormalizer: ReferentialNormalizer = fsaReferentialNormalizer;

/** Referential normalizers keyed by dataset id, ready for `acquire(..., { referentialNormalizer })`. */
export const referentialNormalizers: Record<string, ReferentialNormalizer> = {
  [DATASET_FSA]: fsaReferentialNormalizer,
};

/** A registered source: its manifest plus the per-dataset referential normalizers. */
export interface RegisteredSource {
  manifest: SourceManifest;
  referentialNormalizers: Record<string, ReferentialNormalizer>;
}

/**
 * Register the Statistics Canada FSA postal-referential source. Returns the
 * manifest and the per-dataset referential normalizers so a host (the `geo` CLI)
 * can build a source registry and call
 * `acquire(manifest, datasetId, { referentialNormalizer: referentialNormalizers[datasetId] })`.
 */
export function registerSource(): RegisteredSource {
  return { manifest, referentialNormalizers };
}
