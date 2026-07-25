/**
 * Province-wide acquisition recipe for the **Cadastre allégé du Québec**
 * (`ca-qc/cadastre`, dataset {@link DATASET_LOTS}).
 *
 * ── Why a bespoke crawl recipe (not the engine default) ───────────────────────
 * The cadastre allégé MapServer layer 0 is a province-scale polygon layer that
 * **rejects an unbounded `where=1=1` query with HTTP 404** (manifest.ts §Observed
 * query, immo `lots.ts` + the Valleyfield spike). The engine's default
 * `acquire()` path for `format: "arcgis-rest"` issues exactly one such request
 * (`arcgisQueryUrl` → `where=1=1`), so it cannot acquire this layer province-wide.
 *
 * Instead we drive the generic ArcGIS crawler (`crawlArcgisLayer`, Lot A) in its
 * **bbox-tiling strategy**: it recursively quad-subdivides {@link QC_EXTENT} and
 * queries each tile with an `esriGeometryEnvelope` spatial filter
 * (`geometry` + `geometryType=esriGeometryEnvelope` + `spatialRel` + `inSR`),
 * paging by subdivision rather than `resultOffset`. Every request is therefore
 * **spatially bounded** — the bare `where=1=1` that the server 404s is never sent
 * on its own; it always rides alongside a tile envelope, exactly like the
 * verified immo per-city recipe (but here over the whole province).
 *
 * The per-city bbox table + lot scoring/zone enrichment stay in immo (ADR-0013);
 * geo owns only this generic province-entière crawl. The merged WGS84 GeoJSON is
 * normalized by {@link cadastreNormalizer} (NO_LOT preserved verbatim as the key).
 * ──────────────────────────────────────────────────────────────────────────────
 */

import {
  crawlArcgisLayer,
  type ArcgisCrawlProvenance,
  type ArcgisExtent,
} from "@sentropic/geo";
import type { AdminFeatureCollection, NormalizeContext } from "@sentropic/geo-core";
import { getDataset } from "@sentropic/geo-core";

import {
  CADASTRE_FIELD_NO_LOT,
  CADASTRE_LAYER_LOTS,
  CADASTRE_SERVICE_URL,
  DATASET_LOTS,
  manifest as cadastreManifest,
} from "./manifest.js";
import { cadastreNormalizer } from "./normalizer.js";

/**
 * Approximate bounding envelope of the Province of Québec in WGS84
 * (`[west, south, east, north]`), used as the root extent for bbox tiling.
 *
 * Bounds (lon/lat, °): west ≈ −79.76 (Ontario border, far SW), east ≈ −57.1
 * (Blanc-Sablon / Lower North Shore + Anticosti), south ≈ 44.99 (US border, Lac
 * Champlain area), north ≈ 62.58 (Cap Wolstenholme, the Nunavik tip). Rounded
 * out slightly so every parcel falls strictly inside the root tile; tiles
 * covering empty ocean/land return zero features and cost one request each.
 */
export const QC_EXTENT: ArcgisExtent = [-79.8, 44.9, -57.1, 62.6];

/** Recipe version stamped into the crawl provenance. */
export const CADASTRE_CRAWL_VERSION = "0.1.0";

/** Options for {@link crawlQcCadastreLots}. */
export interface CrawlQcCadastreLotsOptions {
  /** Injected fetch (defaults to the global `fetch`). Required to stay hermetic in tests. */
  readonly fetchImpl?: typeof fetch;
  /** Injected sleep (defaults to a real timer). Tests pass a no-op to skip throttle waits. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injected clock for the provenance timestamp (defaults to `() => new Date()`). */
  readonly now?: () => Date;
  /**
   * Root extent for the bbox tiling (WGS84 `[w,s,e,n]`). Defaults to
   * {@link QC_EXTENT} (the whole province). Override to crawl a sub-region.
   */
  readonly extent?: ArcgisExtent;
  /** Max bbox recursion depth (each level quadrisects). Forwarded to the crawler. */
  readonly maxBboxDepth?: number;
  /** Polite pause (ms) between tile requests. Forwarded to the crawler. */
  readonly throttleMs?: number;
  /** Page-size hint; clamped by the server's `maxRecordCount` (≈ 2000 for this layer). */
  readonly pageSize?: number;
  /** Extra request headers (e.g. a `User-Agent`). Forwarded to the crawler. */
  readonly headers?: Record<string, string>;
}

/**
 * Result of a province-wide cadastre crawl: the **normalized** lot collection
 * (`AdminProperties`, keyed by `NO_LOT`, WGS84 geometry) plus the underlying
 * ArcGIS crawl provenance.
 */
export interface CrawlQcCadastreLotsResult {
  /** Lots mapped onto {@link AdminFeatureCollection} (geoId `ca/qc/lot/<noLot>`). */
  readonly collection: AdminFeatureCollection;
  /** Provenance from the underlying bbox crawl (url, strategy, pages, …). */
  readonly provenance: ArcgisCrawlProvenance;
  /** Recipe version stamp. */
  readonly recipeVersion: string;
}

/** Build the {@link NormalizeContext} for the cadastre lots dataset. */
function lotsContext(): NormalizeContext {
  const dataset = getDataset(cadastreManifest, DATASET_LOTS);
  if (!dataset) {
    throw new Error(
      `ca-qc/cadastre crawl: dataset "${DATASET_LOTS}" missing from the cadastre manifest.`,
    );
  }
  return { manifest: cadastreManifest, dataset };
}

/**
 * Crawl the Québec cadastre allégé (layer 0) **province-wide** by bbox tiling,
 * then normalize the merged WGS84 GeoJSON into an {@link AdminFeatureCollection}.
 *
 * Drives {@link crawlArcgisLayer} on {@link CADASTRE_SERVICE_URL} /
 * {@link CADASTRE_LAYER_LOTS} with `strategy: "bbox"` over {@link QC_EXTENT},
 * restricting the response to the sole verified field ({@link CADASTRE_FIELD_NO_LOT}).
 * Each tile carries the ESRI spatial envelope filter, so the unbounded
 * `where=1=1` the server 404s is never sent alone.
 *
 * A parcel straddling a tile boundary can be returned by two adjacent tiles; the
 * crawler does not de-duplicate. Because every lot is normalized to a stable
 * `geoId` (`ca/qc/lot/<noLot>`), callers persisting to S3 (ADR-0012) can dedupe
 * downstream on that key if needed; the recipe keeps the raw merged set so no
 * data is silently dropped here.
 *
 * Inject `fetchImpl` / `sleep` / `now` for hermetic tests (ADR-0007) — no real
 * network or wall-clock is touched.
 */
export async function crawlQcCadastreLots(
  options: CrawlQcCadastreLotsOptions = {},
): Promise<CrawlQcCadastreLotsResult> {
  const extent = options.extent ?? QC_EXTENT;

  const { collection: raw, provenance } = await crawlArcgisLayer(
    CADASTRE_SERVICE_URL,
    CADASTRE_LAYER_LOTS,
    {
      strategy: "bbox",
      extent,
      // Match the manifest query: only NO_LOT is verified on this layer.
      query: { outFields: CADASTRE_FIELD_NO_LOT },
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(options.maxBboxDepth !== undefined ? { maxBboxDepth: options.maxBboxDepth } : {}),
      ...(options.throttleMs !== undefined ? { throttleMs: options.throttleMs } : {}),
      ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
      ...(options.headers !== undefined ? { headers: options.headers } : {}),
    },
  );

  const collection = cadastreNormalizer(raw, lotsContext());

  return { collection, provenance, recipeVersion: CADASTRE_CRAWL_VERSION };
}
