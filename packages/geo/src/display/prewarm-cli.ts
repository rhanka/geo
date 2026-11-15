/**
 * Display-mirror prewarm CLI (SPEC_DISPLAY_MIRROR.md § Publication).
 *
 * Store mode — runs ON THE CLUSTER (Job, geo-api image), writes mirrors with the
 * store credentials from the environment (`S3_ENDPOINT`, `S3_REGION`,
 * `S3_ACCESS_KEY`, `S3_SECRET_KEY`):
 *
 *   node packages/geo/dist/display/prewarm-cli.js --store s3://<bucket>/normalized
 *        [--collections a,b] [--limit N] [--concurrency 1] [--no-adopt] [--no-build]
 *        [--collection-timeout-ms 1200000] [--no-tiles | --tiles-only]
 *
 * Each collection gets its display mirror, then (lots/zonage) its vector tile
 * archive (SPEC_VECTOR_TILES.md), each step under its own deadline.
 * `--no-tiles` skips the tile step, `--tiles-only` the display step.
 *
 * `--collection-timeout-ms` bounds one collection (default 20 min, `0` = none):
 * on expiry it is reported `{"action":"failed","reason":"timeout"}` and the
 * sweep moves on; a re-run retries it. Each S3 call is also bounded by the
 * store's HTTP timeouts (`S3_*_TIMEOUT_MS`, see `DEFAULT_S3_HTTP_TIMEOUTS`).
 *
 * API mode — read-only requests to a deployed geo-api, explicit list only:
 *
 *   node packages/geo/dist/display/prewarm-cli.js --api https://<host> --collections a,b
 *
 * One JSON line per collection on stdout, a JSON summary last. Exit 1 when any
 * collection failed for a reason other than `too-large` (store mode: such a
 * source is refused on purpose, stays listed under `failed` and `tooLarge` in
 * the summary, and does not fail the Job), 2 on a usage error.
 */

import { pathToFileURL } from "node:url";

import { createStore, type Store } from "../storage/index.js";

import {
  DEFAULT_COLLECTION_TIMEOUT_MS,
  listDisplaySources,
  prewarmDisplayMirrors,
  warmViaApi,
  type DisplaySource,
  type PrewarmResult,
} from "./prewarm.js";

export interface PrewarmCliArgs {
  store?: string;
  api?: string;
  collections?: string[];
  limit?: number;
  concurrency: number;
  adopt: boolean;
  build: boolean;
  /** Per-collection deadline in ms (store mode); `0` disables. */
  collectionTimeoutMs: number;
  /** Display mirror step (store mode; `--tiles-only` turns it off). */
  display: boolean;
  /** Tile archive step (store mode; `--no-tiles` turns it off). */
  tiles: boolean;
}

export function parsePrewarmArgs(argv: readonly string[]): PrewarmCliArgs {
  const args: PrewarmCliArgs = {
    concurrency: 1,
    adopt: true,
    build: true,
    collectionTimeoutMs: DEFAULT_COLLECTION_TIMEOUT_MS,
    display: true,
    tiles: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--store") args.store = value();
    else if (a === "--api") args.api = value();
    else if (a === "--collections") args.collections = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--limit") args.limit = positiveInt(a, value());
    else if (a === "--concurrency") args.concurrency = positiveInt(a, value());
    else if (a === "--collection-timeout-ms") args.collectionTimeoutMs = nonNegativeInt(a, value());
    else if (a === "--no-adopt") args.adopt = false;
    else if (a === "--no-build") args.build = false;
    else if (a === "--no-tiles") args.tiles = false;
    else if (a === "--tiles-only") args.display = false;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.display && !args.tiles) throw new Error("--tiles-only and --no-tiles leave nothing to do");
  if ((args.store === undefined) === (args.api === undefined)) throw new Error("exactly one of --store or --api is required");
  if (args.api !== undefined && (!args.collections || args.collections.length === 0)) {
    throw new Error("--api needs an explicit --collections list (a full sweep through the serving pod would starve it)");
  }
  return args;
}

function positiveInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`);
  return n;
}

function nonNegativeInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} must be a non-negative integer`);
  return n;
}

export interface PrewarmCliDeps {
  createStore?: (uri: string) => Store;
  fetch?: typeof globalThis.fetch;
  out?: (line: string) => void;
}

/** Run the CLI; resolves with the process exit code. */
export async function runPrewarmCli(argv: readonly string[], deps: PrewarmCliDeps = {}): Promise<number> {
  const out = deps.out ?? ((line: string) => console.log(line));
  let args: PrewarmCliArgs;
  try {
    args = parsePrewarmArgs(argv);
  } catch (error) {
    console.error(`display-prewarm: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  if (args.api !== undefined) {
    const results = await warmViaApi(args.api, args.collections!, {
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      onResult: (r, done, total) => out(JSON.stringify({ i: done, n: total, ...r })),
    });
    const failed = results.filter((r) => r.status !== 200 || r.version === undefined);
    out(JSON.stringify({ summary: { mode: "api", total: results.length, failed: failed.length } }));
    return failed.length > 0 ? 1 : 0;
  }

  const store = (deps.createStore ?? createStore)(args.store!);
  let sources: DisplaySource[] = await listDisplaySources(store);
  let missing: string[] = [];
  if (args.collections) {
    const wanted = new Set(args.collections);
    const served = new Set(sources.map((s) => s.collection));
    missing = args.collections.filter((c) => !served.has(c));
    for (const collection of missing) out(JSON.stringify({ collection, action: "failed", error: "not a served lots/zonage collection" }));
    sources = sources.filter((s) => wanted.has(s.collection));
  }
  if (args.limit !== undefined) sources = sources.slice(0, args.limit);
  out(JSON.stringify({ start: { mode: "store", store: args.store, total: sources.length, concurrency: args.concurrency, adopt: args.adopt, build: args.build, collectionTimeoutMs: args.collectionTimeoutMs, display: args.display, tiles: args.tiles } }));
  const report = await prewarmDisplayMirrors(store, sources, {
    concurrency: args.concurrency,
    adopt: args.adopt,
    build: args.build,
    collectionTimeoutMs: args.collectionTimeoutMs,
    display: args.display,
    tiles: args.tiles,
    onResult: (r, done, total) => out(JSON.stringify({ i: done, n: total, ...r })),
  });
  const failed = [...missing, ...report.failures.map((f) => f.collection)];
  const tooLarge = report.failures.filter(isTooLarge).map((f) => f.collection);
  const tiles = {
    counts: report.tilesCounts,
    failed: report.tilesFailures.map((f) => f.collection),
    tooLarge: report.tilesFailures.filter((f) => f.tiles?.reason === "too-large").map((f) => f.collection),
  };
  out(JSON.stringify({ summary: { mode: "store", total: report.total, counts: report.counts, failed, tooLarge, tiles, ms: report.ms } }));
  return storeExitCode(missing, report.failures, report.tilesFailures);
}

/** A deliberate refusal of a source over the builder's budgets. */
function isTooLarge(result: PrewarmResult): boolean {
  return result.reason === "too-large";
}

/**
 * Exit status of a store sweep: 1 only when a collection failed (display or
 * tiles step) for a reason other than `too-large`. A `too-large` source is
 * refused on purpose and fails identically on every re-run (same bytes, same
 * budgets): exiting 1 for it makes the Job controller (backoffLimit) replay the
 * whole sweep for nothing. It stays visible: counted in `counts.failed` /
 * `tiles.counts.failed`, listed in `failed` and in `tooLarge`.
 */
export function storeExitCode(
  missing: readonly string[],
  failures: readonly PrewarmResult[],
  tilesFailures: readonly PrewarmResult[] = [],
): number {
  if (missing.length > 0 || failures.some((f) => !isTooLarge(f))) return 1;
  return tilesFailures.some((f) => f.tiles?.reason !== "too-large") ? 1 : 0;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runPrewarmCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error("display-prewarm: fatal", error);
      process.exit(1);
    },
  );
}
