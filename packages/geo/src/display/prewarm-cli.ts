/**
 * Display-mirror prewarm CLI (SPEC_DISPLAY_MIRROR.md § Publication).
 *
 * Store mode — runs ON THE CLUSTER (Job, geo-api image), writes mirrors with the
 * store credentials from the environment (`S3_ENDPOINT`, `S3_REGION`,
 * `S3_ACCESS_KEY`, `S3_SECRET_KEY`):
 *
 *   node packages/geo/dist/display/prewarm-cli.js --store s3://<bucket>/normalized
 *        [--collections a,b] [--limit N] [--concurrency 1] [--no-adopt] [--no-build]
 *
 * API mode — read-only requests to a deployed geo-api, explicit list only:
 *
 *   node packages/geo/dist/display/prewarm-cli.js --api https://<host> --collections a,b
 *
 * One JSON line per collection on stdout, a JSON summary last. Exit 1 when any
 * collection failed, 2 on a usage error.
 */

import { pathToFileURL } from "node:url";

import { createStore, type Store } from "../storage/index.js";

import {
  listDisplaySources,
  prewarmDisplayMirrors,
  warmViaApi,
  type DisplaySource,
} from "./prewarm.js";

export interface PrewarmCliArgs {
  store?: string;
  api?: string;
  collections?: string[];
  limit?: number;
  concurrency: number;
  adopt: boolean;
  build: boolean;
}

export function parsePrewarmArgs(argv: readonly string[]): PrewarmCliArgs {
  const args: PrewarmCliArgs = { concurrency: 1, adopt: true, build: true };
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
    else if (a === "--no-adopt") args.adopt = false;
    else if (a === "--no-build") args.build = false;
    else throw new Error(`unknown argument: ${a}`);
  }
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
  out(JSON.stringify({ start: { mode: "store", store: args.store, total: sources.length, concurrency: args.concurrency, adopt: args.adopt, build: args.build } }));
  const report = await prewarmDisplayMirrors(store, sources, {
    concurrency: args.concurrency,
    adopt: args.adopt,
    build: args.build,
    onResult: (r, done, total) => out(JSON.stringify({ i: done, n: total, ...r })),
  });
  const failed = [...missing, ...report.failures.map((f) => f.collection)];
  out(JSON.stringify({ summary: { mode: "store", total: report.total, counts: report.counts, failed, ms: report.ms } }));
  return failed.length > 0 ? 1 : 0;
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
