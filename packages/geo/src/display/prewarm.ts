/**
 * One-pass prewarm of the display mirrors of every served lots/zonage
 * collection (SPEC_DISPLAY_MIRROR.md § Publication).
 *
 * Store mode ({@link listDisplaySources} + {@link prewarmDisplayMirrors}) runs
 * ON THE CLUSTER (Job, geo-api image) with the store's own credentials, and
 * writes the mirrors next to the sources. It resolves every served source with
 * the exact serving-index rule (full listing + `.meta.json` datasetIds), then
 * calls {@link ensureDisplayMirror} per collection, sequentially by default,
 * then `ensureTilesArchive` (vector tiles, SPEC_VECTOR_TILES.md) for the same
 * collection, each step under its own deadline.
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

import type { EnsureTilesAction } from "../tiles/archive.js";

import { DisplayTooLargeError } from "./mirror.js";
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

/** Tile archive step of one collection (SPEC_VECTOR_TILES.md § Publication). */
export interface TilesStepResult {
  action: EnsureTilesAction | "failed";
  version?: string;
  reason?: string;
  error?: string;
  ms: number;
}

export interface PrewarmResult {
  collection: string;
  sourceKey: string;
  /** Display mirror step; `skipped` when the sweep runs tiles only. */
  action: EnsureAction | "failed" | "skipped";
  version?: string;
  reason?: string;
  error?: string;
  ms: number;
  /** Tile archive step (lots/zonage, unless disabled). */
  tiles?: TilesStepResult;
}

export interface PrewarmReport {
  total: number;
  counts: Record<EnsureAction | "failed" | "skipped", number>;
  /** Collections whose display step failed. */
  failures: PrewarmResult[];
  tilesCounts: Record<EnsureTilesAction | "failed", number>;
  /** Collections whose tile step failed. */
  tilesFailures: PrewarmResult[];
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
   * A source over the builder's budgets is recorded `failed` with reason
   * `too-large` ({@link DisplayTooLargeError}) — never an OOM of the sweep.
   */
  collectionTimeoutMs?: number;
  /** Ensure the display mirror (default true). */
  display?: boolean;
  /**
   * Ensure the tile archive of lots/zonage collections (default true), after
   * the display mirror, with its own deadline of `collectionTimeoutMs`. A
   * `too-large` source is recorded with that reason, like the display step.
   */
  tiles?: boolean;
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
  const counts: PrewarmReport["counts"] = { fresh: 0, adopted: 0, built: 0, "needs-build": 0, failed: 0, skipped: 0 };
  const tilesCounts: PrewarmReport["tilesCounts"] = { fresh: 0, adopted: 0, built: 0, "needs-build": 0, failed: 0 };
  const failures: PrewarmResult[] = [];
  const tilesFailures: PrewarmResult[] = [];
  let done = 0;
  const ensureOptions: EnsureOptions = {
    ...(options.adopt !== undefined ? { adopt: options.adopt } : {}),
    ...(options.build !== undefined ? { build: options.build } : {}),
    ...(options.now ? { now: options.now } : {}),
  };
  const timeoutMs = options.collectionTimeoutMs ?? DEFAULT_COLLECTION_TIMEOUT_MS;
  // Loaded on demand (see display/publish.ts): the display graph stays free of the tile builder.
  const tilesModule = options.tiles === false ? undefined : await import("../tiles/archive.js");
  await mapLimit(sources, options.concurrency ?? 1, async (source) => {
    if (options.signal?.aborted) return;
    let result: PrewarmResult;
    if (options.display === false) {
      result = { ...source, action: "skipped", ms: 0 };
    } else {
      const step = await withinDeadline(timeoutMs, options.signal, (signal) =>
        ensureDisplayMirror(store, source.collection, source.sourceKey, { ...ensureOptions, signal }),
      );
      result = step.ok
        ? {
            collection: step.value.collection,
            sourceKey: step.value.sourceKey,
            action: step.value.action,
            ...(step.value.version !== undefined ? { version: step.value.version } : {}),
            ...(step.value.reason !== undefined ? { reason: step.value.reason } : {}),
            ms: step.value.ms,
          }
        : { ...source, action: "failed", ...failureFields(step, timeoutMs, DisplayTooLargeError) };
      if (result.action === "failed") failures.push(result);
    }
    if (tilesModule?.isTilesPublishedCollection(source.collection) && !options.signal?.aborted) {
      const step = await withinDeadline(timeoutMs, options.signal, (signal) =>
        tilesModule.ensureTilesArchive(store, source.collection, source.sourceKey, { ...ensureOptions, signal }),
      );
      result.tiles = step.ok
        ? {
            action: step.value.action,
            ...(step.value.version !== undefined ? { version: step.value.version } : {}),
            ...(step.value.reason !== undefined ? { reason: step.value.reason } : {}),
            ms: step.value.ms,
          }
        : { action: "failed", ...failureFields(step, timeoutMs, tilesModule.TilesTooLargeError) };
      tilesCounts[result.tiles.action]++;
      if (result.tiles.action === "failed") tilesFailures.push(result);
    }
    counts[result.action]++;
    done++;
    options.onResult?.(result, done, sources.length);
  });
  return { total: sources.length, counts, failures, tilesCounts, tilesFailures, ms: Date.now() - started };
}

type StepOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown; timedOut: boolean; ms: number };

/** Run one step under its own deadline; never throws. */
async function withinDeadline<T>(
  timeoutMs: number,
  parent: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<StepOutcome<T>> {
  const t0 = Date.now();
  const deadline = withDeadline(timeoutMs, parent);
  try {
    const work = run(deadline.signal);
    // The race may leave `work` behind (a store call that ignores the
    // signal): it settles later against an aborted signal; never unhandled.
    work.catch(() => {});
    return { ok: true, value: await Promise.race([work, deadline.expired]) };
  } catch (error) {
    return { ok: false, error, timedOut: deadline.timedOut(), ms: Date.now() - t0 };
  } finally {
    deadline.clear();
  }
}

/** `reason` / `error` / `ms` of a failed step: `timeout`, `too-large` (an instance of `tooLarge`), or the error. */
function failureFields(
  step: { error: unknown; timedOut: boolean; ms: number },
  timeoutMs: number,
  tooLarge: new (...args: never[]) => Error,
): { reason?: string; error: string; ms: number } {
  const isTooLarge = !step.timedOut && step.error instanceof tooLarge;
  return {
    ...(step.timedOut ? { reason: "timeout" } : isTooLarge ? { reason: "too-large" } : {}),
    error: step.timedOut
      ? new CollectionTimeoutError(timeoutMs).message
      : step.error instanceof Error
        ? step.error.message
        : String(step.error),
    ms: step.ms,
  };
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
