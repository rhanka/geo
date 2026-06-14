/**
 * @sentropic/geo-source-ca-qc-constraints — Québec geographic *constraints*.
 *
 * Three provincial constraint sources, capitalized from radar-immobilier spikes
 * (ADR-0013, P-immo Lot 3), each mirroring the `geo-source-ca-qc` pattern: a
 * geo-core {@link SourceManifest} capturing the real endpoint/query/format/CRS,
 * plus a {@link Normalizer} mapping raw features onto {@link AdminProperties}
 * (tagged `constraint: <id>`):
 *
 *   - `ca-qc/cptaq-zone-agricole` — CPTAQ agricultural-zone polygons (SHP ZIP).
 *   - `ca-qc/bdzi-flood-zones`    — BDZI flood-zone polygons (ArcGIS REST layer 22).
 *   - `ca-qc/grhq-hydrography`    — GRHQ hydrographic network (ArcGIS REST 104/101).
 *
 * Geometry output goes to S3 (ADR-0012), not git. Each source exposes its
 * `manifest` + per-dataset `normalizers`; {@link registerSources} returns all
 * three so the `geo` CLI can build a registry and call
 * `acquire(manifest, datasetId, { normalizer: normalizers[datasetId] })`.
 */

import type { SourceManifest } from "@sentropic/geo-core";
import type { Normalizer } from "@sentropic/geo-acquire";

import {
  manifest as cptaqManifest,
  DATASET_ZONE_AGRICOLE,
} from "./cptaq/manifest.js";
import { cptaqNormalizer } from "./cptaq/normalizer.js";

import {
  manifest as bdziManifest,
  DATASET_FLOOD_ZONES,
} from "./bdzi/manifest.js";
import { bdziNormalizer } from "./bdzi/normalizer.js";

import {
  manifest as grhqManifest,
  DATASET_WATERBODIES,
  DATASET_NETWORK,
} from "./grhq/manifest.js";
import { grhqNormalizer } from "./grhq/normalizer.js";

export const VERSION = "0.1.0";

// ── CPTAQ — zone agricole transposée (SHP ZIP) ───────────────────────────────
export {
  manifest as cptaqManifest,
  SOURCE_ID as CPTAQ_SOURCE_ID,
  CPTAQ_ZA_SHP_ZIP_URL,
  CPTAQ_WMS_URL,
  CPTAQ_LAYER_POLYGON,
  DATASET_ZONE_AGRICOLE,
} from "./cptaq/manifest.js";
export { cptaqNormalizer, CPTAQ_CONSTRAINT } from "./cptaq/normalizer.js";

/** CPTAQ normalizers keyed by dataset id. */
export const cptaqNormalizers: Record<string, Normalizer> = {
  [DATASET_ZONE_AGRICOLE]: cptaqNormalizer,
};

// ── BDZI — base de données des zones inondables (ArcGIS REST layer 22) ────────
export {
  manifest as bdziManifest,
  SOURCE_ID as BDZI_SOURCE_ID,
  BDZI_SERVICE_URL,
  BDZI_LAYER_POLYGONS,
  BDZI_GPKG_ZIP_URL,
  BDZI_SIMPLIFY,
  DATASET_FLOOD_ZONES,
} from "./bdzi/manifest.js";
export { bdziNormalizer, BDZI_CONSTRAINT } from "./bdzi/normalizer.js";

/** BDZI normalizers keyed by dataset id. */
export const bdziNormalizers: Record<string, Normalizer> = {
  [DATASET_FLOOD_ZONES]: bdziNormalizer,
};

// ── GRHQ — géobase du réseau hydrographique (ArcGIS REST layers 104/101) ──────
export {
  manifest as grhqManifest,
  SOURCE_ID as GRHQ_SOURCE_ID,
  GRHQ_SERVICE_URL,
  GRHQ_LAYER_WATERBODIES,
  GRHQ_LAYER_NETWORK,
  GRHQ_WMS_URL,
  GRHQ_INDEX_CSV_URL,
  GRHQ_SIMPLIFY,
  DATASET_WATERBODIES,
  DATASET_NETWORK,
} from "./grhq/manifest.js";
export { grhqNormalizer, GRHQ_CONSTRAINT } from "./grhq/normalizer.js";

/** GRHQ normalizers keyed by dataset id (one normalizer serves both layers). */
export const grhqNormalizers: Record<string, Normalizer> = {
  [DATASET_WATERBODIES]: grhqNormalizer,
  [DATASET_NETWORK]: grhqNormalizer,
};

// ── Combined registry ────────────────────────────────────────────────────────

/** A registered source: its manifest plus the per-dataset normalizers. */
export interface RegisteredSource {
  manifest: SourceManifest;
  normalizers: Record<string, Normalizer>;
}

/**
 * Register all three Québec constraint sources (CPTAQ, BDZI, GRHQ). Returns each
 * manifest with its per-dataset normalizers so a host (the `geo` CLI) can build a
 * source registry and call
 * `acquire(manifest, datasetId, { normalizer: normalizers[datasetId] })`.
 */
export function registerSources(): RegisteredSource[] {
  return [
    { manifest: cptaqManifest, normalizers: cptaqNormalizers },
    { manifest: bdziManifest, normalizers: bdziNormalizers },
    { manifest: grhqManifest, normalizers: grhqNormalizers },
  ];
}
