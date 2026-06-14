/**
 * @sentropic/geo-source-fr-postal — French postal referential.
 *
 * La Poste « Base officielle des codes postaux » (data.gouv.fr), under Licence
 * Ouverte / Open Licence 2.0 (Etalab), distributed as a `;`-delimited CSV.
 * Exposes a {@link SourceManifest} with one dataset (`fr-codes-postaux`) and a
 * matching {@link CsvNormalizer}, so a host (the `geo` CLI) can wire
 * `acquire(manifest, "fr-codes-postaux", { csvNormalizer })`.
 */

import type { SourceManifest } from "@sentropic/geo-core";
import type { CsvNormalizer } from "@sentropic/geo-core";

import { DATASET_CODES_POSTAUX, manifest } from "./manifest.js";
import { codesPostauxNormalizer } from "./normalizers.js";

export const VERSION = "0.1.0";

export {
  manifest,
  SOURCE_ID,
  DATASET_CODES_POSTAUX,
  CODES_POSTAUX_CSV_URL,
  CODES_POSTAUX_HOMEPAGE,
  CP_COLUMNS,
} from "./manifest.js";

export { codesPostauxNormalizer, postalGeoId } from "./normalizers.js";

/**
 * The package's single CSV normalizer. Re-exported under the conventional
 * `csvNormalizer` name for callers that acquire the one dataset directly.
 */
export const csvNormalizer: CsvNormalizer = codesPostauxNormalizer;

/** CSV normalizers keyed by dataset id, ready for `acquire(..., { csvNormalizer })`. */
export const normalizers: Record<string, CsvNormalizer> = {
  [DATASET_CODES_POSTAUX]: codesPostauxNormalizer,
};

/** A registered source: its manifest plus the per-dataset CSV normalizers. */
export interface RegisteredSource {
  manifest: SourceManifest;
  normalizers: Record<string, CsvNormalizer>;
}

/**
 * Register the French postal referential source. Returns the manifest and the
 * per-dataset CSV normalizers so a host (the `geo` CLI) can build a source
 * registry and call
 * `acquire(manifest, datasetId, { csvNormalizer: normalizers[datasetId] })`.
 */
export function registerSource(): RegisteredSource {
  return { manifest, normalizers };
}
