/**
 * One-pass prewarm of the display mirrors of every served lots/zonage
 * collection (SPEC_DISPLAY_MIRROR.md § Publication).
 *
 * Store mode ({@link listDisplaySources} + {@link prewarmDisplayMirrors}) runs
 * ON THE CLUSTER (Job, geo-api image) with the store's own credentials, and
 * writes the mirrors next to the sources. It resolves every served source with
 * the exact serving-index rule (full listing + `.meta.json` datasetIds), then
 * calls {@link ensureDisplayMirror} per collection, sequentially by default.
 * Resumable and idempotent by construction: a fresh mirror costs one GET of
 * `current.json` and one HEAD of the source, so a re-run after an interruption
 * skips everything already done.
 *
 * API mode ({@link warmViaApi}) only issues read-only `?profile=index` requests
 * to a deployed geo-api, which builds with its own credentials. It is bounded to
 * an explicit list of collections: a full sweep through the serving pod would
 * keep its CPU busy for hours (one build at a time, 500m limit) and starve the
 * requests it serves.
 */

import { parseMeta } from "../api/providers/collection-loader.js";
import { isCanonicalGeojsonKey, servedSourceKeys, type Store } from "../storage/index.js";

import { ensureDisplayMirror, isDisplayPublishedCollection, type EnsureAction, type EnsureOptions } from "./publish.js";

const decoder = new TextDecoder();

export interface DisplaySource {
  collection: string;
  sourceKey: string;
}

export interface ListSourcesOptions {
  /** Parallel `.meta.json` reads (default 16). */
  concurrency?: number;
  /** Collection ids to keep (default {@link isDisplayPublishedCollection}). */
  filter?: (collection: string) => boolean;
}

/**
 * Every served collection (id → source key) kept by `filter`, resolved exactly
 * like the serving index: canonical keys, `datasetId ?? stem`, nested-over-flat
 * and sorted last-key-wins on a collision. Sorted by collection id.
 */
export async function listDisplaySources(store: Store, options: ListSourcesOptions = {}): Promise<DisplaySource[]> {
  const filter = options.filter ?? isDisplayPublishedCollection;
  const keys = await store.list("");
  const keySet = new Set(keys);
  const canonical = keys.filter(isCanonicalGeojsonKey);
  const metaOf = (key: string): string => `${key.slice(0, -".geojson".length)}.meta.json`;
  const datasetIds = await mapLimit(canonical, options.concurrency ?? 16, async (key) => {
    const metaKey = metaOf(key);
    if (!keySet.has(metaKey)) return undefined;
    try {
      const bytes = await store.get(metaKey);
      return parseMeta(bytes === undefined ? undefined : decoder.decode(bytes))?.datasetId;
    } catch {
      return undefined;
    }
  });
  const served = servedSourceKeys(canonical.map((key, i) => ({ key, datasetId: datasetIds[i] })));
  return [...served]
    .filter(([collection]) => filter(collection))
    .map(([collection, sourceKey]) => ({ collection, sourceKey }))
    .sort((a, b) => (a.collection < b.collection ? -1 : a.collection > b.collection ? 1 : 0));
}

export interface PrewarmResult {
  collection: string;
  sourceKey: string;
  action: EnsureAction | "failed";
  version?: string;
  reason?: string;
  error?: string;
  ms: number;
}

export interface PrewarmReport {
  total: number;
  counts: Record<EnsureAction | "failed", number>;
  failures: PrewarmResult[];
  ms: number;
}

/**
 * Default per-collection deadline of the prewarm sweep. The largest source
 * (`qc-lots-montreal`) builds in ~560 s on 1 CPU; 20 min leaves room for a
 * throttled CPU while still bounding a stalled collection.
 */
export const DEFAULT_COLLECTION_TIMEOUT_MS = 20 * 60_000;

/** Raised (as the abort reason) when a collection exceeds its deadline. */
export class CollectionTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`collection deadline exceeded (${timeoutMs} ms)`);
    this.name = "CollectionTimeoutError";
  }
}

export interface PrewarmOptions extends EnsureOptions {
  /** Collections processed in parallel (default 1: one build at a time). */
  concurrency?: number;
  /**
   * Deadline of one collection (default {@link DEFAULT_COLLECTION_TIMEOUT_MS};
   * `0` disables). On expiry the collection is recorded `failed` with reason
   * `timeout`, its work is aborted, and the sweep moves on; the next run retries
   * it (the pointer is written last, so an aborted build leaves no partial mirror).
   */
  collectionTimeoutMs?: number;
  /** Called after each collection, in completion order. */
  onResult?: (result: PrewarmResult, done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Ensure the mirror of every source. A failure is recorded and the sweep goes
 * on; the caller decides the exit status from {@link PrewarmReport.failures}.
 */
export async function prewarmDisplayMirrors(
  store: Store,
  sources: readonly DisplaySource[],
  options: PrewarmOptions = {},
): Promise<PrewarmReport> {
  const started = Date.now();
  const counts: PrewarmReport["counts"] = { fresh: 0, adopted: 0, built: 0, "needs-build": 0, failed: 0 };
  const failures: PrewarmResult[] = [];
  let done = 0;
  const ensureOptions: EnsureOptions = {
    ...(options.adopt !== undefined ? { adopt: options.adopt } : {}),
    ...(options.build !== undefined ? { build: options.build } : {}),
    ...(options.now ? { now: options.now } : {}),
  };
  const timeoutMs = options.collectionTimeoutMs ?? DEFAULT_COLLECTION_TIMEOUT_MS;
  await mapLimit(sources, options.concurrency ?? 1, async (source) => {
    if (options.signal?.aborted) return;
    const t0 = Date.now();
    let result: PrewarmResult;
    const deadline = withDeadline(timeoutMs, options.signal);
    try {
      const work = ensureDisplayMirror(store, source.collection, source.sourceKey, {
        ...ensureOptions,
        signal: deadline.signal,
      });
      // The race may leave `work` behind (a store call that ignores the
      // signal): it settles later against an aborted signal; never unhandled.
      work.catch(() => {});
      const r = await Promise.race([work, deadline.expired]);
      result = {
        collection: r.collection,
        sourceKey: r.sourceKey,
        action: r.action,
        ...(r.version !== undefined ? { version: r.version } : {}),
        ...(r.reason !== undefined ? { reason: r.reason } : {}),
        ms: r.ms,
      };
    } catch (error) {
      const timedOut = deadline.timedOut();
      result = {
        ...source,
        action: "failed",
        ...(timedOut ? { reason: "timeout" } : {}),
        error: timedOut
          ? new CollectionTimeoutError(timeoutMs).message
          : error instanceof Error
            ? error.message
            : String(error),
        ms: Date.now() - t0,
      };
      failures.push(result);
    } finally {
      deadline.clear();
    }
    counts[result.action]++;
    done++;
    options.onResult?.(result, done, sources.length);
  });
  return { total: sources.length, counts, failures, ms: Date.now() - started };
}

export interface ApiWarmResult {
  collection: string;
  status: number;
  /** `X-Geo-Display-Version` of the answer (absent on an error). */
  version?: string;
  stale: boolean;
  ms: number;
  error?: string;
}

export interface ApiWarmOptions {
  fetch?: typeof globalThis.fetch;
  /** Per-request timeout (default 10 min: a cold build waits for the build). */
  timeoutMs?: number;
  onResult?: (result: ApiWarmResult, done: number, total: number) => void;
}

/**
 * Warm an explicit list of collections through a deployed geo-api, strictly one
 * request at a time: `GET …/items?profile=index` (the build writes both
 * profiles), headers read, body cancelled. Read-only on the client side.
 */
export async function warmViaApi(
  baseUrl: string,
  collections: readonly string[],
  options: ApiWarmOptions = {},
): Promise<ApiWarmResult[]> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = baseUrl.replace(/\/+$/, "");
  const results: ApiWarmResult[] = [];
  for (const collection of collections) {
    const t0 = Date.now();
    let result: ApiWarmResult;
    try {
      const res = await doFetch(`${base}/collections/${encodeURIComponent(collection)}/items?profile=index`, {
        headers: { "Accept-Encoding": "br, gzip" },
        signal: AbortSignal.timeout(options.timeoutMs ?? 600_000),
      });
      const version = res.headers.get("x-geo-display-version") ?? undefined;
      await res.body?.cancel().catch(() => {});
      result = {
        collection,
        status: res.status,
        ...(version !== undefined ? { version } : {}),
        stale: res.headers.get("x-geo-display-stale") === "1",
        ms: Date.now() - t0,
      };
    } catch (error) {
      result = {
        collection,
        status: 0,
        stale: false,
        ms: Date.now() - t0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    results.push(result);
    options.onResult?.(result, results.length, collections.length);
  }
  return results;
}

interface Deadline {
  /** Aborted on expiry (reason {@link CollectionTimeoutError}) or with `parent`. */
  signal: AbortSignal;
  /** Rejects on expiry; never settles otherwise. */
  expired: Promise<never>;
  timedOut(): boolean;
  clear(): void;
}

/**
 * A per-collection deadline. The timer is deliberately NOT unref'd: when the
 * only pending work is a promise that will never settle, the timer is what
 * keeps the process alive to record the timeout and move on.
 */
function withDeadline(timeoutMs: number, parent?: AbortSignal): Deadline {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fired = false;
  const onParentAbort = (): void => controller.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) onParentAbort();
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }
  const expired = new Promise<never>((_, reject) => {
    if (timeoutMs <= 0) return;
    timer = setTimeout(() => {
      fired = true;
      const error = new CollectionTimeoutError(timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  expired.catch(() => {});
  return {
    signal: controller.signal,
    expired,
    timedOut: () => fired,
    clear: () => {
      if (timer !== undefined) clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

async function mapLimit<T, U>(items: readonly T[], limit: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
