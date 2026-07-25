/**
 * @sentropic/geo-source-ca-qc-cadastre — Québec **cadastre allégé** source.
 *
 * One provincial source, capitalized from radar-immobilier (ADR-0013, P-immo
 * Lot 4), mirroring the `geo-source-ca-qc-constraints` pattern: a geo-core
 * {@link SourceManifest} capturing the real cadastre-allégé endpoint/query/
 * format/CRS, plus a {@link Normalizer} mapping raw lot polygons onto
 * {@link AdminProperties} (`geoId = ca/qc/lot/<noLot>`):
 *
 *   - `ca-qc/cadastre` — cadastral lots keyed by `NO_LOT` (ArcGIS REST layer 0).
 *
 * Geometry output goes to S3 (ADR-0012), not git. The source exposes its
 * `manifest` + per-dataset `normalizers`; {@link registerSource} returns the
 * manifest with its normalizers so the `geo` CLI can build a registry and call
 * `acquire(manifest, datasetId, { normalizer: normalizers[datasetId] })`.
 *
 * Because the province-wide layer 0 **rejects an unbounded `where=1=1` (HTTP
 * 404)**, the source also exposes a bespoke province-entière crawl recipe,
 * {@link crawlQcCadastreLots}: it drives the generic ArcGIS crawler in its
 * **bbox-tiling** strategy over the Québec extent ({@link QC_EXTENT}) — every
 * tile carries an ESRI spatial envelope filter, so the bare `where=1=1` is never
 * sent alone — then normalizes the merged WGS84 GeoJSON via the same normalizer.
 *
 * Deliberately left to immo (ADR-0013 separation): the **lots API**, the
 * per-city bbox table, and the lot **scoring / zone** enrichment
 * (`api/src/services/geo/lots.ts`, `geo-lots.ts`, the "carte-steve" rôle
 * dataset). This package publishes only the generic cadastre acquisition recipe.
 */

import type { SourceManifest } from "@sentropic/geo-core";
import type { Normalizer } from "@sentropic/geo-core";

import {
  manifest as cadastreManifest,
  DATASET_LOTS,
} from "./cadastre/manifest.js";
import { cadastreNormalizer } from "./cadastre/normalizer.js";

export const VERSION = "0.1.0";

// ── Cadastre allégé — lots (ArcGIS REST MapServer layer 0) ────────────────────
export {
  manifest,
  manifest as cadastreManifest,
  SOURCE_ID as CADASTRE_SOURCE_ID,
  CADASTRE_SERVICE_URL,
  CADASTRE_LAYER_LOTS,
  CADASTRE_FIELD_NO_LOT,
  CADASTRE_SIMPLIFY,
  DATASET_LOTS,
} from "./cadastre/manifest.js";
export {
  cadastreNormalizer,
  cadastreNormalizer as normalizer,
  CADASTRE_GEOID_KIND,
  NO_LOT_FIELD,
  MUNICIPALITY_CODE_FIELDS,
} from "./cadastre/normalizer.js";

// ── Province-wide acquisition recipe (bbox-tiling crawl over the QC extent) ───
export {
  crawlQcCadastreLots,
  QC_EXTENT,
  CADASTRE_CRAWL_VERSION,
  type CrawlQcCadastreLotsOptions,
  type CrawlQcCadastreLotsResult,
} from "./cadastre/crawl.js";

/** Cadastre normalizers keyed by dataset id. */
export const cadastreNormalizers: Record<string, Normalizer> = {
  [DATASET_LOTS]: cadastreNormalizer,
};

// ── Registry ──────────────────────────────────────────────────────────────────

/** A registered source: its manifest plus the per-dataset normalizers. */
export interface RegisteredSource {
  manifest: SourceManifest;
  normalizers: Record<string, Normalizer>;
}

/**
 * Register the Québec cadastre-allégé source. Returns the manifest with its
 * per-dataset normalizers so a host (the `geo` CLI) can build a source registry
 * and call `acquire(manifest, datasetId, { normalizer: normalizers[datasetId] })`.
 */
export function registerSource(): RegisteredSource {
  return { manifest: cadastreManifest, normalizers: cadastreNormalizers };
}
