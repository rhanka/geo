/**
 * Generic, robust **ArcGIS REST crawler** for vector layers
 * (`.../FeatureServer/<n>/query`, `.../MapServer/<n>/query`).
 *
 * Where {@link arcgisQueryUrl} builds the URL for a *single* `query` request,
 * this module drives the **full crawl** of a layer that exceeds the server's
 * `maxRecordCount`: it pages through every feature, normalizes them into one
 * WGS84 GeoJSON {@link FeatureCollection}, and attaches provenance. The merged
 * collection is left **raw-but-normalized in CRS/format** (a plain
 * `FeatureCollection<Geometry | null>`): mapping onto the standard
 * {@link import("@sentropic/geo-core").AdminProperties} model is a downstream
 * source recipe's job (`featuresToCollection` then runs there). It is the
 * reusable acquisition primitive behind municipal zonage and large cadastral
 * layers (cadrage zones+lots §3 — pagination ESRI, throttle+backoff,
 * normalisation GeoJSON WGS84, provenance).
 *
 * Design notes (cadrage §3 / §6):
 *   - **`outSR=4326`, `f=geojson`, `outFields=*`, `returnGeometry=true`,
 *     `where=1=1`** by default — emit RFC 7946 WGS84 with no client reprojection.
 *   - **maxRecordCount detection**: a `?f=json` metadata probe reads the layer's
 *     `maxRecordCount`, used as the page size (capped by `pageSize` if given).
 *   - **Pagination by `resultOffset`/`resultRecordCount`** (default): covers the
 *     common case (municipal zonage is small per city). The cadrage notes some
 *     endpoints answer 400 on pure offset over very large volumes, so an optional
 *     **bbox-tiling mode** (`strategy: "bbox"`) recursively subdivides an extent
 *     — more robust for province-scale layers.
 *   - **Throttle + exponential backoff** on HTTP 429/5xx: a configurable polite
 *     pause between pages, plus exponential (jittered) retry with `Retry-After`
 *     respected. No documented MELCC rate limit → prudent defaults.
 *   - **Hermetic** (ADR-0007): `fetchImpl` and `sleep`/`now` are injectable; no
 *     real network or wall-clock is touched in tests.
 *
 * The crawler is intentionally CRS/format-opinionated (WGS84 GeoJSON) and
 * normalizer-agnostic: it returns the raw-but-merged FeatureCollection. Mapping
 * onto {@link AdminProperties} (zone code / usage `fieldMap`) is the job of a
 * source recipe/normalizer downstream, exactly like the cadastre recipe.
 */

import type { BBox, Feature, FeatureCollection, Geometry } from "@sentropic/geo-core";
import { isFeatureCollection } from "@sentropic/geo-core";

import { arcgisQueryUrl, ARCGIS_QUERY_DEFAULTS } from "./arcgis.js";

/** Conservative page size used when the server advertises no `maxRecordCount`. */
export const ARCGIS_DEFAULT_PAGE_SIZE = 1000;

/** Hard cap on pages so a misbehaving server can never spin the crawler forever. */
export const ARCGIS_DEFAULT_MAX_PAGES = 10_000;

/** Polite pause (ms) between successful page requests. Prudent default (no documented limit). */
export const ARCGIS_DEFAULT_THROTTLE_MS = 200;

/** Default retry budget for a single page on 429/5xx before giving up. */
export const ARCGIS_DEFAULT_MAX_RETRIES = 4;

/** Base backoff (ms); the nth retry waits ~`base * 2^(n-1)` (+ jitter), unless Retry-After. */
export const ARCGIS_DEFAULT_BACKOFF_BASE_MS = 500;

/** Pagination strategy. `offset` = resultOffset/resultRecordCount; `bbox` = recursive envelope tiling. */
export type ArcgisCrawlStrategy = "offset" | "bbox";

/** [west, south, east, north] extent in the crawl's `outSR` (WGS84 by default). */
export type ArcgisExtent = readonly [number, number, number, number];

/** Provenance carried alongside every crawl result (cadrage §3). */
export interface ArcgisCrawlProvenance {
  /** The `<service>/<layer>/query` URL the crawl targeted (no pagination params). */
  readonly url: string;
  /** ISO 8601 timestamp when the crawl started. */
  readonly fetchedAt: string;
  /** Pagination strategy actually used. */
  readonly strategy: ArcgisCrawlStrategy;
  /** Server-advertised `maxRecordCount`, when detected via the `?f=json` probe. */
  readonly maxRecordCount?: number;
  /** Page size used for requests. */
  readonly pageSize: number;
  /** Number of `query` page requests issued (excludes the metadata probe + retries). */
  readonly pages: number;
}

/** A crawl result: the merged WGS84 GeoJSON collection plus provenance. */
export interface ArcgisCrawlResult {
  readonly collection: FeatureCollection<Geometry | null>;
  readonly provenance: ArcgisCrawlProvenance;
}

/** Options for {@link crawlArcgisLayer}. */
export interface ArcgisCrawlOptions {
  /** Injected fetch (defaults to global `fetch`). Required to be hermetic in tests. */
  readonly fetchImpl?: typeof fetch;
  /** Injected sleep (defaults to a real timer). Tests pass a no-op to skip waits. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injected clock for the provenance timestamp (defaults to `() => new Date()`). */
  readonly now?: () => Date;
  /** Pagination strategy; defaults to `"offset"`. */
  readonly strategy?: ArcgisCrawlStrategy;
  /**
   * Page size (features per request). Defaults to the detected `maxRecordCount`,
   * else {@link ARCGIS_DEFAULT_PAGE_SIZE}. When given, it is clamped to the
   * server's `maxRecordCount` (the server silently caps anyway).
   */
  readonly pageSize?: number;
  /** Skip the `?f=json` metadata probe (use `pageSize`/default directly). */
  readonly skipMetadataProbe?: boolean;
  /** Extra `query` params merged over the WGS84/GeoJSON defaults (e.g. `where`, `outFields`). */
  readonly query?: Record<string, string | number | boolean>;
  /** Polite pause between pages (ms). Defaults to {@link ARCGIS_DEFAULT_THROTTLE_MS}. */
  readonly throttleMs?: number;
  /** Retry budget per page on 429/5xx. Defaults to {@link ARCGIS_DEFAULT_MAX_RETRIES}. */
  readonly maxRetries?: number;
  /** Base backoff (ms). Defaults to {@link ARCGIS_DEFAULT_BACKOFF_BASE_MS}. */
  readonly backoffBaseMs?: number;
  /** Page cap (safety). Defaults to {@link ARCGIS_DEFAULT_MAX_PAGES}. */
  readonly maxPages?: number;
  /** Extra request headers. */
  readonly headers?: Record<string, string>;
  /**
   * Initial extent for `strategy: "bbox"` (WGS84 by default). When omitted, the
   * crawl queries the layer's full extent from the `?f=json` metadata; if that is
   * unavailable it falls back to the whole-world envelope.
   */
  readonly extent?: ArcgisExtent;
  /**
   * Max recursion depth for bbox tiling (each level quadrisects the extent).
   * Bounds the worst case; defaults to 8 (≈ 65 536 tiles). Ignored for `offset`.
   */
  readonly maxBboxDepth?: number;
}

/** Whole-world WGS84 envelope, the bbox-tiling fallback when no extent is known. */
const WORLD_EXTENT: ArcgisExtent = [-180, -90, 180, 90];

/** A `Number.isFinite` integer ≥ 0, else `undefined`. */
function asNonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

/** Build the canonical `<service>/<layer>/query` URL with no pagination params. */
function baseQueryUrl(serviceUrl: string, layer: string | number): string {
  return arcgisQueryUrl(serviceUrl, layer).split("?")[0] ?? "";
}

/** Merge the WGS84/GeoJSON defaults with caller params, then extra page params. */
function pageUrl(
  serviceUrl: string,
  layer: string | number,
  query: Record<string, string | number | boolean>,
  extra: Record<string, string | number | boolean>,
): string {
  return arcgisQueryUrl(serviceUrl, layer, { ...query, ...extra });
}

/** Parse a `Retry-After` header (delta-seconds form) into ms, when present. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/**
 * Fetch one URL with throttle-aware exponential backoff on HTTP 429/5xx. A
 * non-retryable error (4xx other than 429) throws immediately; the retry budget
 * is exhausted with a final throw. `fetchImpl` rejections (network) are retried
 * the same way.
 */
async function fetchWithBackoff(
  url: string,
  opts: Required<
    Pick<ArcgisCrawlOptions, "maxRetries" | "backoffBaseMs">
  > & {
    fetchImpl: typeof fetch;
    sleep: (ms: number) => Promise<void>;
    headers?: Record<string, string>;
  },
): Promise<Response> {
  const init = opts.headers ? { headers: opts.headers } : undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await opts.fetchImpl(url, init);
    } catch (cause) {
      lastError = cause;
    }

    if (response) {
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) {
        throw new Error(
          `arcgis-crawl: non-retryable HTTP ${response.status} ${response.statusText} for ${url}`,
        );
      }
      lastError = new Error(
        `arcgis-crawl: HTTP ${response.status} ${response.statusText} for ${url}`,
      );
      if (attempt < opts.maxRetries) {
        const after = retryAfterMs(response);
        await opts.sleep(after ?? backoffDelay(attempt, opts.backoffBaseMs));
        continue;
      }
    } else if (attempt < opts.maxRetries) {
      // Network rejection: back off and retry.
      await opts.sleep(backoffDelay(attempt, opts.backoffBaseMs));
      continue;
    }
  }

  throw new Error(
    `arcgis-crawl: exhausted ${opts.maxRetries} retries for ${url}` +
      (lastError instanceof Error ? ` (last: ${lastError.message})` : ""),
  );
}

/** Exponential backoff with full jitter: ~`base * 2^attempt`, randomized. */
function backoffDelay(attempt: number, baseMs: number): number {
  const ceil = baseMs * 2 ** attempt;
  return Math.floor(Math.random() * ceil) + 1;
}

/** Parse a Response body as JSON, with a clear error on malformed payloads. */
async function parseJson(response: Response, url: string): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`arcgis-crawl: failed to parse JSON from ${url}`, { cause });
  }
}

/** Layer metadata we care about from the `?f=json` probe. */
interface LayerMetadata {
  maxRecordCount?: number;
  extent?: ArcgisExtent;
}

/**
 * Probe `<service>/<layer>?f=json` for `maxRecordCount` and the layer extent.
 * Failures are swallowed (returns `{}`) — the crawl proceeds with defaults, so a
 * server that hides metadata never blocks acquisition.
 */
async function probeMetadata(
  serviceUrl: string,
  layer: string | number,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  maxRetries: number,
  backoffBaseMs: number,
  headers?: Record<string, string>,
): Promise<LayerMetadata> {
  const base = baseQueryUrl(serviceUrl, layer);
  // `<service>/<layer>` (drop the trailing `/query`) + `?f=json`.
  const metaUrl = `${base.replace(/\/query$/, "")}?f=json`;
  let raw: unknown;
  try {
    const response = await fetchWithBackoff(metaUrl, {
      fetchImpl,
      sleep,
      maxRetries,
      backoffBaseMs,
      ...(headers ? { headers } : {}),
    });
    raw = await parseJson(response, metaUrl);
  } catch {
    return {};
  }

  if (typeof raw !== "object" || raw === null) return {};
  const record = raw as Record<string, unknown>;
  const meta: LayerMetadata = {};

  const maxRecordCount = asNonNegativeInt(record["maxRecordCount"]);
  if (maxRecordCount !== undefined && maxRecordCount > 0) meta.maxRecordCount = maxRecordCount;

  const extent = parseEsriExtent(record["extent"]);
  if (extent) meta.extent = extent;

  return meta;
}

/** Read `{ xmin, ymin, xmax, ymax }` from an Esri extent object, when present & finite. */
function parseEsriExtent(value: unknown): ArcgisExtent | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const ext = value as Record<string, unknown>;
  const xmin = ext["xmin"];
  const ymin = ext["ymin"];
  const xmax = ext["xmax"];
  const ymax = ext["ymax"];
  if (
    typeof xmin === "number" &&
    typeof ymin === "number" &&
    typeof xmax === "number" &&
    typeof ymax === "number" &&
    [xmin, ymin, xmax, ymax].every((n) => Number.isFinite(n)) &&
    xmax > xmin &&
    ymax > ymin
  ) {
    return [xmin, ymin, xmax, ymax];
  }
  return undefined;
}

/** Coerce a fetched payload into a feature array, validating it is a FeatureCollection. */
function featuresOf(raw: unknown, url: string): Feature<Geometry | null>[] {
  if (!isFeatureCollection(raw)) {
    throw new Error(
      `arcgis-crawl: expected a GeoJSON FeatureCollection from ${url}, got ` +
        `${raw === null ? "null" : typeof raw}.`,
    );
  }
  return raw.features as Feature<Geometry | null>[];
}

/**
 * Crawl an ArcGIS REST layer to completion, returning one merged WGS84 GeoJSON
 * {@link FeatureCollection} plus {@link ArcgisCrawlProvenance}.
 *
 * @param serviceUrl FeatureServer/MapServer base, e.g.
 *   `https://host/arcgis/rest/services/Zonage/FeatureServer` (trailing slash ok).
 * @param layer Layer index/name, e.g. `0`.
 * @param options See {@link ArcgisCrawlOptions}. Inject `fetchImpl`/`sleep` for
 *   hermetic tests.
 */
export async function crawlArcgisLayer(
  serviceUrl: string,
  layer: string | number,
  options: ArcgisCrawlOptions = {},
): Promise<ArcgisCrawlResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => new Date());
  const strategy = options.strategy ?? "offset";
  const throttleMs = options.throttleMs ?? ARCGIS_DEFAULT_THROTTLE_MS;
  const maxRetries = options.maxRetries ?? ARCGIS_DEFAULT_MAX_RETRIES;
  const backoffBaseMs = options.backoffBaseMs ?? ARCGIS_DEFAULT_BACKOFF_BASE_MS;
  const maxPages = options.maxPages ?? ARCGIS_DEFAULT_MAX_PAGES;
  // WGS84/GeoJSON defaults (`ARCGIS_QUERY_DEFAULTS`: where=1=1, outFields=*,
  // outSR=4326, f=geojson) + an explicit `returnGeometry=true` the shared
  // single-request defaults omit, then caller overrides. The shared constant is
  // not mutated (the cadastre manifest + arcgis.test.ts pin its exact shape).
  const query = {
    returnGeometry: true,
    ...ARCGIS_QUERY_DEFAULTS,
    ...(options.query ?? {}),
  };

  const fetchedAt = now().toISOString();

  // 1. Detect maxRecordCount (and the layer extent for bbox tiling) up front.
  const metadata = options.skipMetadataProbe
    ? {}
    : await probeMetadata(
        serviceUrl,
        layer,
        fetchImpl,
        sleep,
        maxRetries,
        backoffBaseMs,
        options.headers,
      );

  const detected = metadata.maxRecordCount;
  const pageSize = resolvePageSize(options.pageSize, detected);

  const backoff = {
    fetchImpl,
    sleep,
    maxRetries,
    backoffBaseMs,
    ...(options.headers ? { headers: options.headers } : {}),
  } as const;

  const fetchPage = async (extra: Record<string, string | number | boolean>) => {
    const url = pageUrl(serviceUrl, layer, query, extra);
    const response = await fetchWithBackoff(url, backoff);
    return featuresOf(await parseJson(response, url), url);
  };

  const features: Feature<Geometry | null>[] = [];
  let pages = 0;

  if (strategy === "bbox") {
    const extent =
      options.extent ?? metadata.extent ?? WORLD_EXTENT;
    const maxDepth = options.maxBboxDepth ?? 8;
    pages = await crawlByBbox(
      extent,
      maxDepth,
      pageSize,
      maxPages,
      throttleMs,
      sleep,
      fetchPage,
      features,
    );
  } else {
    pages = await crawlByOffset(
      pageSize,
      maxPages,
      throttleMs,
      sleep,
      fetchPage,
      features,
    );
  }

  const provenance: ArcgisCrawlProvenance = {
    url: baseQueryUrl(serviceUrl, layer),
    fetchedAt,
    strategy,
    pageSize,
    pages,
    ...(detected !== undefined ? { maxRecordCount: detected } : {}),
  };

  return {
    collection: { type: "FeatureCollection", features },
    provenance,
  };
}

/** Resolve the page size: caller's (clamped to detected) → detected → default. */
function resolvePageSize(requested: number | undefined, detected: number | undefined): number {
  if (requested !== undefined && requested > 0) {
    return detected !== undefined ? Math.min(requested, detected) : requested;
  }
  return detected ?? ARCGIS_DEFAULT_PAGE_SIZE;
}

/**
 * Page through a layer with `resultOffset`/`resultRecordCount`. Stops when a page
 * returns fewer than `pageSize` features (last page) or zero, or when `maxPages`
 * is hit. `returnExceededLimit`-style flags are unnecessary: short page = done.
 */
async function crawlByOffset(
  pageSize: number,
  maxPages: number,
  throttleMs: number,
  sleep: (ms: number) => Promise<void>,
  fetchPage: (extra: Record<string, string | number | boolean>) => Promise<Feature<Geometry | null>[]>,
  sink: Feature<Geometry | null>[],
): Promise<number> {
  let offset = 0;
  let pages = 0;

  while (pages < maxPages) {
    const batch = await fetchPage({
      resultOffset: offset,
      resultRecordCount: pageSize,
    });
    pages += 1;
    for (const feature of batch) sink.push(feature);

    if (batch.length < pageSize) break; // last (or only / empty) page.
    offset += pageSize;
    if (throttleMs > 0) await sleep(throttleMs);
  }

  return pages;
}

/**
 * Page through a layer by recursively quad-subdividing a bbox envelope. A tile
 * whose page comes back **full** (`length === pageSize`) is assumed to have more
 * features than one page can hold and is split into four child tiles; otherwise
 * its features are taken as complete. Robust where pure `resultOffset` 400s on
 * very large layers (cadrage §3/§6). Bounded by `maxDepth` and `maxPages`.
 *
 * Features are queried with an `esriGeometryEnvelope` spatial filter in the
 * crawl's `outSR` (WGS84), `spatialRel=esriSpatialRelIntersects`. A parcel
 * straddling a tile boundary can appear in two tiles; callers that need strict
 * de-duplication should dedupe downstream by a stable feature key.
 */
async function crawlByBbox(
  extent: ArcgisExtent,
  maxDepth: number,
  pageSize: number,
  maxPages: number,
  throttleMs: number,
  sleep: (ms: number) => Promise<void>,
  fetchPage: (extra: Record<string, string | number | boolean>) => Promise<Feature<Geometry | null>[]>,
  sink: Feature<Geometry | null>[],
): Promise<number> {
  let pages = 0;
  const queue: Array<{ extent: ArcgisExtent; depth: number }> = [{ extent, depth: 0 }];

  while (queue.length > 0 && pages < maxPages) {
    const tile = queue.shift();
    if (!tile) break;
    const [west, south, east, north] = tile.extent;

    const batch = await fetchPage({
      geometry: `${west},${south},${east},${north}`,
      geometryType: "esriGeometryEnvelope",
      spatialRel: "esriSpatialRelIntersects",
      inSR: 4326,
    });
    pages += 1;

    if (batch.length >= pageSize && tile.depth < maxDepth) {
      // Tile likely truncated: subdivide into four quadrants instead of taking it.
      for (const child of quadrants(tile.extent)) {
        queue.push({ extent: child, depth: tile.depth + 1 });
      }
    } else {
      for (const feature of batch) sink.push(feature);
    }

    if (throttleMs > 0 && queue.length > 0) await sleep(throttleMs);
  }

  return pages;
}

/** Split an extent into its four quadrant child extents. */
function quadrants(extent: ArcgisExtent): ArcgisExtent[] {
  const [west, south, east, north] = extent;
  const midX = (west + east) / 2;
  const midY = (south + north) / 2;
  return [
    [west, south, midX, midY],
    [midX, south, east, midY],
    [west, midY, midX, north],
    [midX, midY, east, north],
  ];
}

/** Narrow a {@link BBox} to the crawler's 2D extent shape, when 2D. */
export function bboxToExtent(bbox: BBox): ArcgisExtent | undefined {
  if (bbox.length === 4) return [bbox[0], bbox[1], bbox[2], bbox[3]];
  if (bbox.length === 6) return [bbox[0], bbox[1], bbox[3], bbox[4]];
  return undefined;
}
