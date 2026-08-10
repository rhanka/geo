/**
 * Readback audit for the `zone_source_url` / `zone_source_level` fold onto
 * served qc-zonage collections (`fold-zone-source-provenance-to-zonage.ts`).
 *
 * That fold's own run counters were noised by an unstable S3 network
 * (bursty ETIMEDOUT). This script re-derives the REAL state by reading the
 * SERVED objects back, independent of any prior run log: it enumerates the
 * served qc-zonage universe from S3 itself (`listSlugs`, which wraps
 * `ListObjectsV2`), then for each collection reads the served object
 * (`getGeoJsonFeatureCollection`) and checks a small feature sample for the
 * two stamped properties.
 *
 * A collection can have TWO coexisting S3 keys — flat
 * `qc-zonage-<slug>.geojson` and mirrored sub-folder
 * `qc-zonage-<slug>/qc-zonage-<slug>.geojson` — and geo-api serves the
 * sub-folder key when both exist (see memory `fold-double-key-s3-serving`).
 * This script reads the SAME key geo-api would serve.
 *
 * Classification per collection:
 *   STAMPED       both fields present on the sample, url non-null
 *   STAMPED_NULL  both fields present on the sample, url === null (honest null)
 *   UNSTAMPED     either field absent (or the sample disagrees) on the sample
 *   READ_ERROR    the object could not be read after bounded retries
 *
 * A read failure on ONE collection never aborts the run — it is recorded as
 * READ_ERROR and the audit continues (bounded retries absorb the bursty
 * ETIMEDOUT network; only a fully exhausted retry budget counts as an error).
 *
 * Usage (from the repo root):
 *   npx tsx acquisition/src/_zone-source-readback-audit.ts
 *   npx tsx acquisition/src/_zone-source-readback-audit.ts --concurrency 8
 *   npx tsx acquisition/src/_zone-source-readback-audit.ts --limit 20
 *   npx tsx acquisition/src/_zone-source-readback-audit.ts --slugs saguenay,dunham
 *
 * Resume mode — only re-test collections that were READ_ERROR in a prior
 * report (network too unstable for one pass), merging the rest as-is:
 *   npx tsx acquisition/src/_zone-source-readback-audit.ts \
 *     --only-errors work/coverage/zone-source-readback-audit-20260724.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { S3Client } from "@aws-sdk/client-s3";

import { exists, getGeoJsonFeatureCollection, isServedZoneKey, listSlugs, s3Client } from "./lib/s3.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_OUT = resolve(ROOT, "work", "coverage", "zone-source-readback-audit-20260724.json");
const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const URL_FIELD = "zone_source_url";
const LEVEL_FIELD = "zone_source_level";
const CONTRACT = "zone-source-readback-audit/v1";

type Status = "STAMPED" | "STAMPED_NULL" | "UNSTAMPED" | "READ_ERROR";

interface ZoneFeature {
  type?: unknown;
  properties?: Record<string, unknown> | null;
}

interface DetailRecord {
  slug: string;
  status: Status;
  key: string | null;
  keysFound: string[];
  url: unknown;
  level: unknown;
  features: number;
  sampled: number;
  notes: string[];
  error: string | null;
}

interface Report {
  contract: string;
  generatedAt: string;
  prefix: string;
  total: number;
  stamped: number;
  stamped_null: number;
  unstamped: number;
  read_error: number;
  slugs: { stamped: string[]; stamped_null: string[]; unstamped: string[]; read_error: string[] };
  details: DetailRecord[];
}

interface Args {
  onlyErrors: string | null;
  merge: string | null;
  out: string | null;
  date: string | null;
  concurrency: number;
  limit: number | null;
  slugs: string[] | null;
  discoverOnly: boolean;
  dropSlugs: string[] | null;
}

/**
 * Full served-slug universe = flat-key slugs UNION nested-only slugs (a
 * collection can exist ONLY as a nested/sub-folder key with no flat
 * companion — flat-only `listSlugs` would silently miss it).
 *
 * Both branches are validated through `isServedZoneKey` (not just a loose
 * prefix/suffix split): the `ca-qc-zonage` prefix also holds unrelated
 * side-artifacts that share the `qc-zonage-<slug>` stem with an extra
 * dotted suffix (observed: `qc-zonage-<slug>.contour-auto-preclip.geojson`,
 * a cadastre-clip intermediate — NOT a served collection). A real slug is
 * exactly `[a-z0-9-]+`; anything else must be rejected here.
 */
async function discoverServedSlugs(s3: S3Client): Promise<{ flat: Set<string>; nestedOnly: Set<string> }> {
  const flatRest = await retry(() => listSlugs(s3, `${ZONAGE_PREFIX}qc-zonage-`, ".geojson", true), 6);
  const flat = new Set<string>();
  for (const rest of flatRest) {
    if (isServedZoneKey(`${ZONAGE_PREFIX}qc-zonage-${rest}.geojson`)) flat.add(rest);
  }
  const allRest = await retry(() => listSlugs(s3, ZONAGE_PREFIX, ".geojson", false), 6);
  const nestedOnly = new Set<string>();
  const nestedPattern = /^qc-zonage-([a-z0-9-]+)\/qc-zonage-\1$/;
  for (const rest of allRest) {
    const match = nestedPattern.exec(rest);
    if (!match) continue;
    const slug = match[1]!;
    if (!isServedZoneKey(`${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`)) continue;
    if (!flat.has(slug)) nestedOnly.add(slug);
  }
  return { flat, nestedOnly };
}

/** `--discover-only`: print the flat/nested-only/union split, read no collection body. */
async function discoverUniverse(s3: S3Client): Promise<void> {
  const { flat, nestedOnly } = await discoverServedSlugs(s3);
  console.log(`flat-key slugs: ${flat.size}`);
  console.log(`nested-only slugs (no flat companion): ${nestedOnly.size}`);
  if (nestedOnly.size > 0) console.log([...nestedOnly].sort().join(", "));
  console.log(`union total: ${flat.size + nestedOnly.size}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function owns(object: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, field);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** Definitive 404 — never worth retrying. Mirrors lib/s3.ts's private isMissingObjectError. */
function isMissingObjectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const detail = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return detail.name === "NotFound" || detail.name === "NoSuchKey" || detail.$metadata?.httpStatusCode === 404;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error)) {
    const name = typeof error.name === "string" ? error.name : null;
    const message = typeof error.message === "string" ? error.message : null;
    const status = isRecord(error.$metadata) && typeof error.$metadata.httpStatusCode === "number"
      ? ` HTTP ${error.$metadata.httpStatusCode}`
      : "";
    if (name || message || status) return `${name ?? "S3 error"}${status}${message ? `: ${message}` : ""}`;
  }
  return String(error) || "unknown error";
}

/**
 * Bounded retry for a single S3 read. The network fails in bursts (bounded
 * bursts of ETIMEDOUT that clear up), not permanently — a handful of
 * exponential-ish backoff attempts absorbs that without stalling forever. A
 * definitive 404 is never retried.
 */
async function retry<T>(operation: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  const delays = [0, 400, 1000, 2500, 5000].slice(0, attempts);
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (isMissingObjectError(error)) break;
    }
  }
  throw lastError;
}

async function collectionKeys(s3: S3Client, slug: string): Promise<{ flat: string; nested: string; keys: string[] }> {
  const flat = `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`;
  const nested = `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  const keys: string[] = [];
  if (await retry(() => exists(s3, flat))) keys.push(flat);
  if (await retry(() => exists(s3, nested))) keys.push(nested);
  return { flat, nested, keys };
}

interface FeatureCheck {
  hasUrlProp: boolean;
  url: unknown;
  hasLevelProp: boolean;
  level: unknown;
  levelIsString: boolean;
}

function checkFeature(feature: ZoneFeature): FeatureCheck {
  const props = isRecord(feature.properties) ? feature.properties : null;
  const hasUrlProp = !!props && owns(props, URL_FIELD);
  const hasLevelProp = !!props && owns(props, LEVEL_FIELD);
  const level = hasLevelProp ? props![LEVEL_FIELD] : undefined;
  return {
    hasUrlProp,
    url: hasUrlProp ? props![URL_FIELD] : undefined,
    hasLevelProp,
    level,
    levelIsString: typeof level === "string" && level.length > 0,
  };
}

/** First, middle, last — up to 3 distinct indices spread across the collection. */
export function sampleIndices(n: number): number[] {
  if (n <= 0) return [];
  const idx = new Set<number>([0, n - 1]);
  if (n > 2) idx.add(Math.floor(n / 2));
  return [...idx].sort((left, right) => left - right);
}

interface Classification {
  status: Status;
  url: unknown;
  level: unknown;
  sampled: number;
  notes: string[];
}

export function classifyCollection(features: ZoneFeature[]): Classification {
  const notes: string[] = [];
  if (features.length === 0) {
    notes.push("empty-collection-0-features");
    return { status: "UNSTAMPED", url: undefined, level: undefined, sampled: 0, notes };
  }
  const indices = sampleIndices(features.length);
  const checks = indices.map((index) => checkFeature(features[index]!));
  const allPresent = checks.every((check) => check.hasUrlProp && check.hasLevelProp && check.levelIsString);
  if (!allPresent) {
    return { status: "UNSTAMPED", url: undefined, level: undefined, sampled: indices.length, notes };
  }
  const first = checks[0]!;
  const consistentUrl = checks.every((check) => check.url === first.url);
  const consistentLevel = checks.every((check) => check.level === first.level);
  if (!consistentUrl || !consistentLevel) {
    notes.push(`inconsistent-sample consistentUrl=${consistentUrl} consistentLevel=${consistentLevel}`);
    return { status: "UNSTAMPED", url: first.url, level: first.level, sampled: indices.length, notes };
  }
  if (first.url === null) return { status: "STAMPED_NULL", url: null, level: first.level, sampled: indices.length, notes };
  return { status: "STAMPED", url: first.url, level: first.level, sampled: indices.length, notes };
}

async function processSlug(s3: S3Client, slug: string): Promise<DetailRecord> {
  try {
    const { flat, nested, keys } = await collectionKeys(s3, slug);
    if (keys.length === 0) {
      return {
        slug,
        status: "READ_ERROR",
        key: null,
        keysFound: [],
        url: undefined,
        level: undefined,
        features: 0,
        sampled: 0,
        notes: [],
        error: `no served flat (${flat}) or nested (${nested}) key found`,
      };
    }
    // geo-api serves the sub-folder key when both coexist (fold-double-key-s3-serving).
    const servedKey = keys.includes(nested) ? nested : flat;
    const collection = await retry(() => getGeoJsonFeatureCollection<ZoneFeature>(s3, servedKey));
    const features = collection.features ?? [];
    const classification = classifyCollection(features);
    return {
      slug,
      status: classification.status,
      key: servedKey,
      keysFound: keys,
      url: classification.url,
      level: classification.level,
      features: features.length,
      sampled: classification.sampled,
      notes: classification.notes,
      error: null,
    };
  } catch (error) {
    return {
      slug,
      status: "READ_ERROR",
      key: null,
      keysFound: [],
      url: undefined,
      level: undefined,
      features: 0,
      sampled: 0,
      notes: [],
      error: errorText(error),
    };
  }
}

function showUrl(url: unknown): string {
  if (url === undefined) return "-";
  if (url === null) return "null";
  return JSON.stringify(url);
}

function logLine(detail: DetailRecord): void {
  console.log(
    `${detail.status.padEnd(12)} ${detail.slug} key=${detail.key ?? "-"} features=${detail.features} ` +
      `url=${showUrl(detail.url)} level=${detail.level ?? "-"}` +
      `${detail.notes.length ? ` notes=${detail.notes.join(";")}` : ""}` +
      `${detail.error ? ` error=${detail.error}` : ""}`,
  );
}

export function buildReport(details: DetailRecord[]): Report {
  const slugs = { stamped: [] as string[], stamped_null: [] as string[], unstamped: [] as string[], read_error: [] as string[] };
  for (const detail of details) {
    if (detail.status === "STAMPED") slugs.stamped.push(detail.slug);
    else if (detail.status === "STAMPED_NULL") slugs.stamped_null.push(detail.slug);
    else if (detail.status === "UNSTAMPED") slugs.unstamped.push(detail.slug);
    else slugs.read_error.push(detail.slug);
  }
  return {
    contract: CONTRACT,
    generatedAt: new Date().toISOString(),
    prefix: ZONAGE_PREFIX,
    total: details.length,
    stamped: slugs.stamped.length,
    stamped_null: slugs.stamped_null.length,
    unstamped: slugs.unstamped.length,
    read_error: slugs.read_error.length,
    slugs,
    details,
  };
}

function loadReport(path: string): Report {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (
    !isRecord(raw) ||
    raw.contract !== CONTRACT ||
    !isRecord(raw.slugs) ||
    !Array.isArray(raw.slugs.read_error) ||
    !raw.slugs.read_error.every((slug) => typeof slug === "string") ||
    !Array.isArray(raw.details) ||
    !raw.details.every((detail) => isRecord(detail) && typeof detail.slug === "string" && typeof detail.status === "string")
  ) {
    fail(`${path} is not a recognised ${CONTRACT} report`);
  }
  return raw as unknown as Report;
}

function parseArgs(argv: string[]): Args {
  let onlyErrors: string | null = null;
  let merge: string | null = null;
  let out: string | null = null;
  let date: string | null = null;
  let concurrency = 16;
  let limit: number | null = null;
  let slugs: string[] | null = null;
  let discoverOnly = false;
  let dropSlugs: string[] | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = (): string => {
      const value = argv[++index];
      if (!value || value.startsWith("--")) fail(`missing value after ${arg}`);
      return value;
    };
    if (arg === "--only-errors") onlyErrors = next();
    else if (arg === "--merge") merge = next();
    else if (arg === "--out") out = next();
    else if (arg.startsWith("--out=")) {
      out = arg.slice("--out=".length);
      if (!out) fail("--out requires a path");
    } else if (arg.startsWith("--date=")) {
      date = arg.slice("--date=".length);
      if (!/^\d{8}$/.test(date)) fail("--date must use YYYYMMDD format");
    }
    else if (arg === "--concurrency") concurrency = Number(next());
    else if (arg === "--limit") limit = Number(next());
    else if (arg === "--slugs") slugs = next().split(",").map((slug) => slug.trim()).filter(Boolean);
    else if (arg === "--discover-only") discoverOnly = true;
    else if (arg === "--drop-slugs") dropSlugs = next().split(",").map((slug) => slug.trim()).filter(Boolean);
    else fail(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(concurrency) || concurrency <= 0) fail("--concurrency must be a positive number");
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) fail("--limit must be a positive number");
  if (onlyErrors && slugs) fail("pass either --only-errors or --slugs, not both");
  if (onlyErrors && merge) fail("pass either --only-errors or --merge, not both");
  if (dropSlugs && !merge) fail("--drop-slugs requires --merge <path> naming the report to clean");
  return { onlyErrors, merge, out, date, concurrency, limit, slugs, discoverOnly, dropSlugs };
}

/** `--drop-slugs` against `--merge <path>`: pure JSON surgery, no S3 read. */
function dropSlugsFromReport(mergePath: string, dropSlugs: string[], outPath: string | null): void {
  const resolvedMergePath = resolve(ROOT, mergePath);
  const baseline = loadReport(resolvedMergePath);
  const toDrop = new Set(dropSlugs);
  const missing = [...toDrop].filter((slug) => !baseline.details.some((detail) => detail.slug === slug));
  if (missing.length > 0) fail(`--drop-slugs slug(s) not found in ${resolvedMergePath}: ${missing.join(", ")}`);
  const kept = baseline.details.filter((detail) => !toDrop.has(detail.slug));
  const report = buildReport(kept);
  const resolvedOutPath = outPath ? resolve(ROOT, outPath) : resolvedMergePath;
  writeFileSync(resolvedOutPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `dropped ${toDrop.size} slug(s): ${[...toDrop].join(", ")}\n` +
      `DONE total=${report.total} stamped=${report.stamped} stamped_null=${report.stamped_null} ` +
      `unstamped=${report.unstamped} read_error=${report.read_error} out=${resolvedOutPath}`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.dropSlugs) {
    dropSlugsFromReport(args.merge!, args.dropSlugs, args.out);
    return;
  }
  const s3 = s3Client();
  if (args.discoverOnly) return discoverUniverse(s3);
  let baseline: Report | null = null;
  let slugsToProcess: string[];

  if (args.onlyErrors) {
    baseline = loadReport(resolve(ROOT, args.onlyErrors));
    slugsToProcess = [...baseline.slugs.read_error].sort();
    console.log(`only-errors mode: reprocessing ${slugsToProcess.length} previously READ_ERROR slug(s) from ${args.onlyErrors}`);
  } else if (args.slugs) {
    slugsToProcess = args.slugs;
    if (args.merge) {
      baseline = loadReport(resolve(ROOT, args.merge));
      console.log(`merge mode: processing ${slugsToProcess.length} explicit slug(s) on top of ${baseline.details.length} baseline collection(s) from ${args.merge}`);
    } else {
      console.log(`explicit --slugs mode: ${slugsToProcess.length} slug(s)`);
    }
  } else {
    const { flat, nestedOnly } = await discoverServedSlugs(s3);
    slugsToProcess = [...flat, ...nestedOnly].sort();
    console.log(
      `discovered ${slugsToProcess.length} served qc-zonage collections under ${ZONAGE_PREFIX} ` +
        `(flat=${flat.size} nested-only=${nestedOnly.size})`,
    );
    if (args.merge) {
      baseline = loadReport(resolve(ROOT, args.merge));
      console.log(`merge mode: baseline has ${baseline.details.length} collection(s) from ${args.merge}`);
    }
  }

  if (args.limit) slugsToProcess = slugsToProcess.slice(0, args.limit);

  const detailsBySlug = new Map<string, DetailRecord>();
  if (baseline) for (const detail of baseline.details) detailsBySlug.set(detail.slug, detail);

  let done = 0;
  const runOne = async (slug: string): Promise<void> => {
    const detail = await processSlug(s3, slug);
    detailsBySlug.set(slug, detail);
    done += 1;
    logLine(detail);
    if (done % 100 === 0) console.log(`... progress ${done}/${slugsToProcess.length}`);
  };
  for (let start = 0; start < slugsToProcess.length; start += args.concurrency) {
    await Promise.all(slugsToProcess.slice(start, start + args.concurrency).map(runOne));
  }

  const allDetails = [...detailsBySlug.values()].sort((left, right) => left.slug.localeCompare(right.slug));
  const report = buildReport(allDetails);
  const outPath = args.out
    ? resolve(ROOT, args.out)
    : args.date
      ? resolve(ROOT, "work", "coverage", `zone-source-readback-audit-${args.date}.json`)
    : args.onlyErrors
      ? resolve(ROOT, args.onlyErrors)
      : args.merge
        ? resolve(ROOT, args.merge)
        : DEFAULT_OUT;
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `DONE total=${report.total} stamped=${report.stamped} stamped_null=${report.stamped_null} ` +
      `unstamped=${report.unstamped} read_error=${report.read_error} out=${outPath}`,
  );
  const errorRate = report.total > 0 ? report.read_error / report.total : 0;
  if (errorRate > 0.3) {
    console.log(
      `WARNING read_error rate ${(errorRate * 100).toFixed(1)}% > 30% — network too unstable for one pass; ` +
        `rerun with --only-errors ${outPath} to retest only the READ_ERROR slugs`,
    );
  }
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
