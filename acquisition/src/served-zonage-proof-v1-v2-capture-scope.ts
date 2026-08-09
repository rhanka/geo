/**
 * Materialise the exact, named scope of served proof envelopes that have an
 * HTTPS URL and a SHA-256 but no attached capture receipt.  The resulting
 * worklist de-duplicates a shared URL while the companion scope preserves
 * every affected served collection and its already-served SHA.
 *
 * This does not fetch or write a served object.  The capture Job is the sole
 * network actor and receives the emitted worklist through k8s-capture-run.
 *
 * Usage:
 *   npx tsx acquisition/src/served-zonage-proof-v1-v2-capture-scope.ts \
 *     --partition=work/coverage/preuves-servies-partition-<UTC>.json \
 *     --scan=work/coverage/served-zonage-immo-proof-url-audit-<UTC>.json \
 *     --out=work/coverage/served-zonage-proof-v1-v2-scope-<UTC>.json \
 *     --worklist-out=work/coverage/served-zonage-proof-v1-v2-control-<UTC>.json \
 *     --limit=10
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCaptureWorklist, type CaptureWorklistTarget } from "../../packages/qc-sources/src/capture/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;

type JsonObject = Record<string, unknown>;

interface Partition {
  contract: "preuves-servies-partition/v1";
  validation: { total: number; closed: boolean };
  partition: { URL_SHA_SANS_CAPTURE: { slugs: string[] } };
}

interface ScanRow {
  slug: string;
  key: string;
  layout: "flat" | "nested";
  proof_envelope_samples: Array<{ location: string; proof: unknown }>;
}

interface Scan {
  contract: "served-zonage-immo-proof-url-audit/v2";
  complete: boolean;
  collections: { served: number; read: number };
  rows: ScanRow[];
}

interface ExpectedProof {
  url: string;
  sha256: `sha256:${string}`;
  retrieved_at: string | null;
  locations: string[];
}

interface ScopeRow extends ExpectedProof {
  slug: string;
  key: string;
  layout: "flat" | "nested";
}

interface UniqueUrl {
  url: string;
  expected_sha256: `sha256:${string}`[];
  slugs: string[];
  capture_slug: string;
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
}

function positiveIntegerOption(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be an integer >= 1`);
  return value;
}

function nonNegativeIntegerOption(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be an integer >= 0`);
  return value;
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function expectedProofs(sample: { location: string; proof: unknown }): ExpectedProof[] {
  const proof = asObject(sample.proof);
  if (proof === null) return [];
  const legacy = asObject(asObject(proof.sources)?.geometry);
  const v2 = asObject(proof.geometry_source);
  const candidates: Array<{ url: unknown; sha256: unknown; retrievedAt: unknown }> = [
    { url: legacy?.artifact_uri, sha256: legacy?.sha256, retrievedAt: legacy?.retrieved_at },
    { url: v2?.url, sha256: v2?.sha256, retrievedAt: v2?.retrieved_at },
  ];
  return candidates.flatMap(({ url, sha256, retrievedAt }) => (
    validHttpsUrl(url) && typeof sha256 === "string" && SHA256_RE.test(sha256)
      ? [{
        url,
        sha256: sha256 as `sha256:${string}`,
        retrieved_at: typeof retrievedAt === "string" ? retrievedAt : null,
        locations: [sample.location],
      }]
      : []
  ));
}

function oneExpectedProof(row: ScanRow): ExpectedProof {
  const byTuple = new Map<string, ExpectedProof>();
  for (const sample of row.proof_envelope_samples) {
    for (const candidate of expectedProofs(sample)) {
      const key = JSON.stringify([candidate.url, candidate.sha256, candidate.retrieved_at]);
      const prior = byTuple.get(key);
      byTuple.set(key, prior === undefined
        ? candidate
        : { ...prior, locations: [...new Set([...prior.locations, ...candidate.locations])].sort() });
    }
  }
  if (byTuple.size !== 1) {
    throw new Error(`URL_SHA_SANS_CAPTURE must expose one exact URL/SHA tuple for ${row.slug}; found ${byTuple.size}`);
  }
  return [...byTuple.values()][0]!;
}

function readPartition(path: string): Partition {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Partition>;
  if (
    value.contract !== "preuves-servies-partition/v1" ||
    value.validation?.total !== 871 ||
    value.validation.closed !== true ||
    !Array.isArray(value.partition?.URL_SHA_SANS_CAPTURE?.slugs)
  ) throw new Error(`partition incomplete or incompatible: ${relative(ROOT, path)}`);
  return value as Partition;
}

function readScan(path: string): Scan {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Scan>;
  if (
    value.contract !== "served-zonage-immo-proof-url-audit/v2" ||
    value.complete !== true ||
    value.collections?.served !== 871 ||
    value.collections.read !== 871 ||
    !Array.isArray(value.rows)
  ) throw new Error(`scan incomplete or incompatible: ${relative(ROOT, path)}`);
  return value as Scan;
}

function scopeRows(partition: Partition, scan: Scan): ScopeRow[] {
  const selected = partition.partition.URL_SHA_SANS_CAPTURE.slugs;
  const selectedSet = new Set(selected);
  if (selectedSet.size !== selected.length) throw new Error("partition repeats a URL_SHA_SANS_CAPTURE slug");
  const rows = scan.rows.filter((row) => selectedSet.has(row.slug));
  if (rows.length !== selected.length) {
    const found = new Set(rows.map((row) => row.slug));
    throw new Error(`partition scope absent from scan: ${selected.filter((slug) => !found.has(slug)).join(",")}`);
  }
  return rows.map((row) => ({ ...row, ...oneExpectedProof(row) })).sort((left, right) => left.slug.localeCompare(right.slug));
}

function distinctUrls(rows: readonly ScopeRow[]): UniqueUrl[] {
  const byUrl = new Map<string, ScopeRow[]>();
  for (const row of rows) byUrl.set(row.url, [...(byUrl.get(row.url) ?? []), row]);
  return [...byUrl.entries()].map(([url, members]) => {
    const sortedMembers = [...members].sort((left, right) => left.slug.localeCompare(right.slug));
    return {
      url,
      expected_sha256: [...new Set(sortedMembers.map((member) => member.sha256))].sort() as `sha256:${string}`[],
      slugs: sortedMembers.map((member) => member.slug),
      capture_slug: sortedMembers[0]!.slug,
    };
  }).sort((left, right) => left.url.localeCompare(right.url));
}

function writeNew(path: string, value: unknown): void {
  if (existsSync(path)) throw new Error(`refusing to overwrite: ${relative(ROOT, path)}`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

export function selectCaptureWorklistWindow(
  worklist: readonly CaptureWorklistTarget[],
  offset: number,
  limit: number,
): CaptureWorklistTarget[] {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("worklist offset must be an integer >= 0");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("worklist limit must be an integer >= 1");
  return parseCaptureWorklist(worklist.slice(offset, offset + limit));
}

async function main(): Promise<void> {
  const partitionArgument = option("partition");
  const scanArgument = option("scan");
  const outputArgument = option("out");
  const worklistArgument = option("worklist-out");
  if (!partitionArgument || !scanArgument || !outputArgument || !worklistArgument) {
    throw new Error("--partition=<partition.json> --scan=<scan.json> --out=<scope.json> --worklist-out=<worklist.json> are required");
  }
  const partitionPath = insideRepo(partitionArgument, "partition");
  const scanPath = insideRepo(scanArgument, "scan");
  const outputPath = insideRepo(outputArgument, "out");
  const worklistPath = insideRepo(worklistArgument, "worklist-out");
  if (outputPath === worklistPath) throw new Error("--out and --worklist-out must differ");

  const rows = scopeRows(readPartition(partitionPath), readScan(scanPath));
  const urls = distinctUrls(rows);
  const fullWorklist = parseCaptureWorklist(urls.map((entry) => ({
    slug: entry.capture_slug,
    source: "zones-v1-proof-url",
    urls: [entry.url],
  })));
  const offset = nonNegativeIntegerOption("offset", 0);
  const limit = positiveIntegerOption("limit", fullWorklist.length);
  const worklist = selectCaptureWorklistWindow(fullWorklist, offset, limit);

  const scope = {
    contract: "served-zonage-proof-v1-v2-capture-scope/v1",
    generated_at: new Date().toISOString(),
    partition: relative(ROOT, partitionPath),
    scan: relative(ROOT, scanPath),
    collections: rows.length,
    distinct_urls: urls.length,
    collection_scope: rows,
    unique_url_scope: urls,
  };
  writeNew(outputPath, scope);
  writeNew(worklistPath, worklist);
  console.log(JSON.stringify({
    scope: relative(ROOT, outputPath),
    worklist: relative(ROOT, worklistPath),
    collections: rows.length,
    distinct_urls: urls.length,
    worklist_urls: worklist.length,
    offset,
    limit,
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
