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
import type { Normalizer } from "@sentropic/geo-core";

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
import {
  DATASET_MUNICIPALITIES_POLYGONS,
  manifest as statcanCsdManifest,
} from "./statcan-csd.js";
import { statcanCsdNormalizer } from "./statcan-csd-normalizer.js";

export const VERSION = "0.1.0";

// ── QC municipality registry (1106 entries, geographic fields only) ──────────
export {
  QC_MUNICIPALITIES,
  bySlug,
  byName,
  byCode,
  normalizeName,
  isMunicipality,
  validateMunicipalities,
  type Municipality,
} from "./municipalities/municipalities.js";

// ── QC municipal website directory (MAMH-sourced, Lot D unblocker) ───────────
export {
  QC_MUNICIPAL_DIRECTORY,
  MAMH_REPERTOIRE_PACKAGE_ID,
  MAMH_MUN_CSV_URL,
  websiteForSlug,
  directoryEntry,
  directoryWebsites,
  type MunicipalDirectory,
  type MunicipalDirectoryEntry,
} from "./municipalities/municipal-directory.js";
export {
  municipalDirectoryManifest,
  MUNICIPAL_DIRECTORY_SOURCE_ID,
  DATASET_MUNICIPAL_DIRECTORY,
} from "./municipalities/municipal-directory-manifest.js";

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

// ── StatCan CSD municipal polygons (immo's SDA-timeout fallback) ──────────────

export {
  CSD_SOURCE_ID,
  DATASET_MUNICIPALITIES_POLYGONS,
  STATCAN_CSD_SERVICE_URL,
  STATCAN_CSD_LAYER,
  STATCAN_QC_PRUID,
  STATCAN_CSD_FIELDS,
  STATCAN_CSD_PAGE_SIZE,
  STATCAN_CSD_SIMPLIFY,
  CSDTYPE_PRIORITY,
} from "./statcan-csd.js";
export {
  statcanCsdNormalizer,
  makeStatCanCsdNormalizer,
} from "./statcan-csd-normalizer.js";

/** The StatCan CSD municipal-polygons source manifest (immo's SDA fallback). */
export { statcanCsdManifest };

/** Normalizers for the StatCan CSD source, keyed by dataset id. */
export const statcanCsdNormalizers: Record<string, Normalizer> = {
  [DATASET_MUNICIPALITIES_POLYGONS]: statcanCsdNormalizer,
};

/**
 * Register the StatCan CSD municipal-polygons source (immo's working fallback
 * for the SDA geometry timeout). Returns its manifest plus the per-dataset
 * normalizer (CSD → AdminProperties, joined to the QC registry).
 */
export function registerStatCanCsdSource(): RegisteredSource {
  return { manifest: statcanCsdManifest, normalizers: statcanCsdNormalizers };
}
