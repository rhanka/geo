/**
 * @sentropic/geo-source-fr-stat — France statistical referential (INSEE COG).
 *
 * Exposes the INSEE **Code Officiel Géographique** as a {@link SourceManifest}
 * (`fr/insee-cog`, `kind: "statistical"`, Licence Ouverte 2.0) with one CSV
 * dataset — `fr-cog-communes` — and a matching {@link CsvNormalizer} that maps
 * the raw COG rows onto null-geometry {@link ReferentialFeature}s. A host (the
 * `geo` CLI) wires `acquire(manifest, "fr-cog-communes", { csvNormalizer })`.
 */

import type { SourceManifest } from "@sentropic/geo-core";
import type { CsvNormalizer } from "@sentropic/geo-core";

import { DATASET_COMMUNES, manifest } from "./manifest.js";
import { communesNormalizer } from "./normalizers.js";

export const VERSION = "0.1.0";

export {
  manifest,
  SOURCE_ID,
  COG_COMMUNES_URL,
  DATASET_COMMUNES,
} from "./manifest.js";

export { communesNormalizer } from "./normalizers.js";

/** CSV normalizers keyed by dataset id, ready for `acquire(..., { csvNormalizer })`. */
export const csvNormalizers: Record<string, CsvNormalizer> = {
  [DATASET_COMMUNES]: communesNormalizer,
};

/** A registered CSV referential source: its manifest plus per-dataset CSV normalizers. */
export interface RegisteredSource {
  manifest: SourceManifest;
  csvNormalizers: Record<string, CsvNormalizer>;
}

/**
 * Register the INSEE COG source. Returns the manifest and the per-dataset CSV
 * normalizers so a host can build a registry and call
 * `acquire(manifest, datasetId, { csvNormalizer: csvNormalizers[datasetId] })`.
 */
export function registerSource(): RegisteredSource {
  return { manifest, csvNormalizers };
}
