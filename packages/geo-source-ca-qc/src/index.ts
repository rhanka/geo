/**
 * @sentropic/geo-source-ca-qc — Québec administrative boundaries.
 *
 * Données Québec « Découpages administratifs » (SDA), provider MRNF, CC-BY 4.0,
 * served from an ArcGIS REST MapServer. Exposes a {@link SourceManifest} with
 * three datasets (`qc-regions`, `qc-mrc`, `qc-municipalites`) and a matching
 * {@link Normalizer} per dataset, so the `geo` CLI can wire
 * `acquire(manifest, id, { normalizer })`.
 */

import type { SourceManifest } from "@sentropic/geo-core";
import type { Normalizer } from "@sentropic/geo-acquire";

import {
  DATASET_MRC,
  DATASET_MUNICIPALITES,
  DATASET_REGIONS,
  manifest,
} from "./manifest.js";
import {
  mrcNormalizer,
  municipalitesNormalizer,
  regionsNormalizer,
} from "./normalizers.js";

export const VERSION = "0.1.0";

export {
  manifest,
  SOURCE_ID,
  SDA_SERVICE_URL,
  SDA_LAYERS,
  DATASET_REGIONS,
  DATASET_MRC,
  DATASET_MUNICIPALITES,
} from "./manifest.js";

export {
  regionsNormalizer,
  mrcNormalizer,
  municipalitesNormalizer,
} from "./normalizers.js";

/** Normalizers keyed by dataset id, ready to pass to `acquire(..., { normalizer })`. */
export const normalizers: Record<string, Normalizer> = {
  [DATASET_REGIONS]: regionsNormalizer,
  [DATASET_MRC]: mrcNormalizer,
  [DATASET_MUNICIPALITES]: municipalitesNormalizer,
};

/** A registered source: its manifest plus the per-dataset normalizers. */
export interface RegisteredSource {
  manifest: SourceManifest;
  normalizers: Record<string, Normalizer>;
}

/**
 * Register the Québec SDA source. Returns the manifest and the per-dataset
 * normalizers so a host (the `geo` CLI) can build a source registry and call
 * `acquire(manifest, datasetId, { normalizer: normalizers[datasetId] })`.
 */
export function registerSource(): RegisteredSource {
  return { manifest, normalizers };
}
