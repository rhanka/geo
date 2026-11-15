/**
 * Feature-size scan CLI — strictly READ-ONLY (see feature-size-scan.ts).
 *
 * Runs ON THE CLUSTER (Job, geo-api image, deploy/k8s/display-prewarm/feature-scan-preprod.yaml)
 * with the store credentials from the environment (`S3_ENDPOINT`, `S3_REGION`,
 * `S3_ACCESS_KEY`, `S3_SECRET_KEY`):
 *
 *   node packages/geo/dist/display/feature-size-scan-cli.js --store s3://<bucket>/normalized
 *        [--collections a,b] [--limit N] [--concurrency 2] [--display-only]
 *
 * Scans every served collection (the serving cap applies to all of them);
 * `--display-only` keeps the lots/zonage collections of the display prewarm.
 *
 * One JSON line per collection on stdout ({collection, sourceKey, features,
 * maxFeatureBytes, maxFeatureIndex, over8MiB, over16MiB, over32MiB, over64MiB,
 * ms[, error]}), a JSON summary last listing, per bucket, the collections with
 * at least one Feature over it. Exit 1 when a collection could not be scanned,
 * 2 on a usage error; oversized Features are a finding, not a failure.
 */

import { pathToFileURL } from "node:url";

import { createStore, type Store } from "../storage/index.js";

import { FEATURE_SIZE_THRESHOLDS, readOnlyStore, scanFeatureSizes } from "./feature-size-scan.js";
import { listDisplaySources, type DisplaySource } from "./prewarm.js";
import { isDisplayPublishedCollection } from "./publish.js";

export interface FeatureSizeScanCliArgs {
  store: string;
  collections?: string[];
  limit?: number;
  concurrency: number;
  displayOnly: boolean;
}

export function parseFeatureSizeScanArgs(argv: readonly string[]): FeatureSizeScanCliArgs {
  let store: string | undefined;
  const args: Omit<FeatureSizeScanCliArgs, "store"> = { concurrency: 2, displayOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--store") store = value();
    else if (a === "--collections") args.collections = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--limit") args.limit = positiveInt(a, value());
    else if (a === "--concurrency") args.concurrency = positiveInt(a, value());
    else if (a === "--display-only") args.displayOnly = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (store === undefined) throw new Error("--store is required");
  return { store, ...args };
}

function positiveInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`);
  return n;
}

export interface FeatureSizeScanCliDeps {
  createStore?: (uri: string) => Store;
  out?: (line: string) => void;
}

/** Run the CLI; resolves with the process exit code. */
export async function runFeatureSizeScanCli(argv: readonly string[], deps: FeatureSizeScanCliDeps = {}): Promise<number> {
  const out = deps.out ?? ((line: string) => console.log(line));
  let args: FeatureSizeScanCliArgs;
  try {
    args = parseFeatureSizeScanArgs(argv);
  } catch (error) {
    console.error(`feature-size-scan: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  // Listing and scan both go through the read-only view: no write is possible.
  const store = readOnlyStore((deps.createStore ?? createStore)(args.store));
  let sources: DisplaySource[] = await listDisplaySources(store, {
    filter: args.displayOnly ? isDisplayPublishedCollection : () => true,
  });
  let missing: string[] = [];
  if (args.collections) {
    const wanted = new Set(args.collections);
    const served = new Set(sources.map((s) => s.collection));
    missing = args.collections.filter((c) => !served.has(c));
    const error = args.displayOnly ? "not a served lots/zonage collection" : "not a served collection";
    for (const collection of missing) out(JSON.stringify({ collection, error }));
    sources = sources.filter((s) => wanted.has(s.collection));
  }
  if (args.limit !== undefined) sources = sources.slice(0, args.limit);
  out(JSON.stringify({ start: { mode: "feature-size-scan", store: args.store, total: sources.length, concurrency: args.concurrency, displayOnly: args.displayOnly, thresholds: FEATURE_SIZE_THRESHOLDS } }));
  const report = await scanFeatureSizes(store, sources, {
    concurrency: args.concurrency,
    onResult: (r, done, total) => out(JSON.stringify({ i: done, n: total, ...r })),
  });
  const failed = [...missing, ...report.failed];
  out(JSON.stringify({ summary: { total: report.total, scanned: report.scanned, failed, ...report.offenders, ms: report.ms } }));
  return failed.length > 0 ? 1 : 0;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runFeatureSizeScanCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error("feature-size-scan: fatal", error);
      process.exit(1);
    },
  );
}
