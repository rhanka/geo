/**
 * Read-only scan of the per-Feature JSON size of every served collection.
 *
 * The serving path refuses a collection with HTTP 503 `FeatureTooLarge` as soon
 * as one of its Features is over `GEO_MAX_FEATURE_BYTES` (default
 * {@link SERVING_MAX_FEATURE_BYTES}, 16 MiB). This scan answers, before that cap
 * is promoted, which served collections it would refuse: for each one, the
 * largest Feature and how many Features are over 8 / 16 / 32 / 64 MiB.
 *
 * Same listing as the prewarm ({@link listDisplaySources}: the serving-index
 * rule), and the same byte count as the cap ({@link scanFeatureByteSizes}: raw
 * bytes from `{` to `}`, nothing decoded, nothing retained). Strictly read-only:
 * the store is wrapped by {@link readOnlyStore}, whose writes throw.
 */

import { scanFeatureByteSizes, SERVING_MAX_FEATURE_BYTES } from "../api/providers/collection-loader.js";
import type { Store } from "../storage/index.js";

import type { DisplaySource } from "./prewarm.js";

const MiB = 1024 * 1024;

/** Reported size buckets: a Feature counts in a bucket when its bytes are `>` the bound. */
export const FEATURE_SIZE_THRESHOLDS = {
  over8MiB: 8 * MiB,
  over16MiB: SERVING_MAX_FEATURE_BYTES,
  over32MiB: 32 * MiB,
  over64MiB: 64 * MiB,
} as const;

export type FeatureSizeBucket = keyof typeof FEATURE_SIZE_THRESHOLDS;

const BUCKETS = Object.keys(FEATURE_SIZE_THRESHOLDS) as FeatureSizeBucket[];

export interface FeatureSizeScanResult extends Record<FeatureSizeBucket, number> {
  collection: string;
  sourceKey: string;
  /** Features scanned (all of them on success). */
  features: number;
  /** JSON bytes of the largest Feature (0 for an empty collection). */
  maxFeatureBytes: number;
  /** 0-based index of the largest Feature (-1 for an empty collection). */
  maxFeatureIndex: number;
  ms: number;
  /** Set when the source could not be read or is not a FeatureCollection. */
  error?: string;
}

/** One collection over a bucket, for the summary. */
export interface FeatureSizeOffender {
  collection: string;
  maxFeatureBytes: number;
  /** Features of that collection over the bucket bound. */
  count: number;
}

export interface FeatureSizeScanReport {
  total: number;
  scanned: number;
  failed: string[];
  /** Collections with at least one Feature over each bucket bound, largest first. */
  offenders: Record<FeatureSizeBucket, FeatureSizeOffender[]>;
  ms: number;
}

export interface FeatureSizeScanOptions {
  /** Collections scanned in parallel (default 2). */
  concurrency?: number;
  /** Called after each collection, in completion order. */
  onResult?: (result: FeatureSizeScanResult, done: number, total: number) => void;
}

/**
 * A view of `store` that can only read: `put`/`delete` throw. The scan goes
 * through it, so a bug can never turn it into a writer.
 */
export function readOnlyStore(store: Store): Store {
  const refuse = (op: string) => async (key: string): Promise<never> => {
    throw new Error(`read-only store: ${op} ${key} refused`);
  };
  return {
    get: (key) => store.get(key),
    has: (key) => store.has(key),
    list: (prefix) => store.list(prefix),
    ...(store.stat ? { stat: (key: string) => store.stat!(key) } : {}),
    ...(store.getStream ? { getStream: (key: string, opts?: Parameters<NonNullable<Store["getStream"]>>[1]) => store.getStream!(key, opts) } : {}),
    put: refuse("put"),
    delete: refuse("delete"),
  };
}

/** Scan one served source. Never throws: a failure is reported in `error`. */
export async function scanCollectionFeatureSizes(store: Store, source: DisplaySource): Promise<FeatureSizeScanResult> {
  const t0 = Date.now();
  const result: FeatureSizeScanResult = {
    ...source,
    features: 0,
    maxFeatureBytes: 0,
    maxFeatureIndex: -1,
    over8MiB: 0,
    over16MiB: 0,
    over32MiB: 0,
    over64MiB: 0,
    ms: 0,
  };
  try {
    // Streaming only: `get` would hold a whole (up to ~1 GB) object in memory.
    if (!store.getStream) throw new Error("store has no getStream (bounded-memory scan needs a streaming read)");
    const stream = await store.getStream(source.sourceKey);
    if (!stream) throw new Error(`object missing: ${source.sourceKey}`);
    const { features } = await scanFeatureByteSizes(stream, (index, bytes) => {
      if (bytes > result.maxFeatureBytes) {
        result.maxFeatureBytes = bytes;
        result.maxFeatureIndex = index;
      }
      for (const bucket of BUCKETS) if (bytes > FEATURE_SIZE_THRESHOLDS[bucket]) result[bucket]++;
    });
    result.features = features;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  result.ms = Date.now() - t0;
  return result;
}

/** Scan every source (read-only) and build the summary. */
export async function scanFeatureSizes(
  store: Store,
  sources: readonly DisplaySource[],
  options: FeatureSizeScanOptions = {},
): Promise<FeatureSizeScanReport> {
  const started = Date.now();
  const reader = readOnlyStore(store);
  const offenders = Object.fromEntries(BUCKETS.map((b) => [b, [] as FeatureSizeOffender[]])) as FeatureSizeScanReport["offenders"];
  const failed: string[] = [];
  let scanned = 0;
  let done = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= sources.length) return;
      const result = await scanCollectionFeatureSizes(reader, sources[index]!);
      if (result.error !== undefined) failed.push(result.collection);
      else scanned++;
      for (const bucket of BUCKETS) {
        if (result[bucket] > 0) offenders[bucket].push({ collection: result.collection, maxFeatureBytes: result.maxFeatureBytes, count: result[bucket] });
      }
      done++;
      options.onResult?.(result, done, sources.length);
    }
  };
  const workers = Math.min(Math.max(1, options.concurrency ?? 2), sources.length);
  await Promise.all(Array.from({ length: workers }, worker));
  for (const bucket of BUCKETS) offenders[bucket].sort((a, b) => b.maxFeatureBytes - a.maxFeatureBytes || (a.collection < b.collection ? -1 : 1));
  failed.sort();
  return { total: sources.length, scanned, failed, offenders, ms: Date.now() - started };
}
