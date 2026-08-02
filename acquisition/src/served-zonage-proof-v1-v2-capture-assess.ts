/**
 * Assess one completed cluster capture against the SHA-256 values already
 * served by the collections in a v1→v2 proof scope.  It is deliberately
 * read-only: a captured digest can confirm an existing assertion, never
 * replace it.  The report counts unique URL captures and the collections that
 * each shared URL affects separately.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/served-zonage-proof-v1-v2-capture-assess.ts \
 *     --scope=work/coverage/served-zonage-proof-v1-v2-capture-scope-<UTC>.json \
 *     --worklist=work/coverage/served-zonage-proof-v1-v2-control-<UTC>.json \
 *     --run-stamp=<YYYYMMDDTHHMMSSZ> \
 *     --out=work/coverage/served-zonage-proof-v1-v2-capture-assessment-<UTC>.json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCaptureWorklist,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";

import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";
import { captureReceiptFromManifest } from "./lib/zone-provenance-quality.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;

type CaptureOutcome = "SHA_IDENTIQUE" | "SHA_DIFFERENT" | "HTTP_404" | "AUTRE";

interface ScopeRow {
  slug: string;
  key: string;
  url: string;
  sha256: `sha256:${string}`;
  retrieved_at: string | null;
}

interface Scope {
  contract: "served-zonage-proof-v1-v2-capture-scope/v1";
  collections: number;
  distinct_urls: number;
  collection_scope: ScopeRow[];
}

interface RunHeader {
  run_id: string;
  exit_code: number | null;
}

interface CapturedObservation {
  http_status: number | null;
  sha256: `sha256:${string}` | null;
  retrieved_at: string | null;
  manifest_key: string;
  line_index: number;
  raw_payload_verified: boolean;
  verification_detail: string | null;
}

interface UrlAssessment extends CapturedObservation {
  url: string;
  outcome: CaptureOutcome;
  slugs: string[];
  expected_sha256: `sha256:${string}`[];
}

interface CaptureTarget {
  slug: string;
  source: string;
  url: string;
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value === undefined ? null : value.slice(prefix.length);
}

function insideRepo(path: string, name: string): string {
  const resolved = resolve(ROOT, path);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error(`--${name} must resolve inside the repository`);
  return resolved;
}

function validRunStamp(value: string): boolean {
  return /^\d{8}T\d{6}Z$/.test(value);
}

function readScope(path: string): Scope {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Scope>;
  if (
    value.contract !== "served-zonage-proof-v1-v2-capture-scope/v1" ||
    !Number.isInteger(value.collections) ||
    !Number.isInteger(value.distinct_urls) ||
    !Array.isArray(value.collection_scope) ||
    value.collection_scope.length !== value.collections
  ) throw new Error(`scope incomplete or incompatible: ${relative(ROOT, path)}`);
  for (const row of value.collection_scope) {
    if (
      !row || typeof row.slug !== "string" || typeof row.key !== "string" || typeof row.url !== "string" ||
      typeof row.sha256 !== "string" || !SHA256_RE.test(row.sha256) ||
      (row.retrieved_at !== null && typeof row.retrieved_at !== "string")
    ) throw new Error(`scope row invalid: ${relative(ROOT, path)}`);
  }
  return value as Scope;
}

function readRunHeader(bytes: Buffer, key: string): RunHeader {
  const value = JSON.parse(bytes.toString("utf8")) as Partial<RunHeader>;
  if (typeof value.run_id !== "string" || (value.exit_code !== null && typeof value.exit_code !== "number")) {
    throw new Error(`capture run header invalid: ${key}`);
  }
  return value as RunHeader;
}

function outcomeFor(observation: CapturedObservation, expected: readonly `sha256:${string}`[]): CaptureOutcome {
  if (observation.http_status === 404) return "HTTP_404";
  if (observation.http_status !== 200 || !observation.raw_payload_verified || observation.sha256 === null) return "AUTRE";
  return expected.includes(observation.sha256) ? "SHA_IDENTIQUE" : "SHA_DIFFERENT";
}

export function classifyCapturedSha(
  httpStatus: number | null,
  capturedSha256: `sha256:${string}` | null,
  rawPayloadVerified: boolean,
  expectedSha256: readonly `sha256:${string}`[],
): CaptureOutcome {
  return outcomeFor({
    http_status: httpStatus,
    sha256: capturedSha256,
    retrieved_at: null,
    manifest_key: "capture/_runs/test/manifest.jsonl",
    line_index: 0,
    raw_payload_verified: rawPayloadVerified,
    verification_detail: null,
  }, expectedSha256);
}

/** A repeated source URL is safe only when each named collection has its own
 * capture-manifest line.  The slug is therefore part of the match, never an
 * inferred association made from the URL alone. */
export function lineForControlTarget<T extends { source: string; url: string; slugs: string[] }>(
  target: CaptureTarget,
  lines: readonly T[],
): T {
  const matches = lines.filter((line) => (
    line.source === target.source && line.url === target.url && line.slugs.includes(target.slug)
  ));
  if (matches.length !== 1) {
    throw new Error(`capture manifest is not one-to-one with control target ${target.slug}: ${matches.length}`);
  }
  return matches[0]!;
}

async function observedCapture(
  line: CaptureManifestLine,
  manifestKey: string,
  lineIndex: number,
): Promise<CapturedObservation> {
  const base = {
    http_status: line.http_status,
    sha256: line.sha256 !== null && SHA256_RE.test(line.sha256) ? line.sha256 as `sha256:${string}` : null,
    retrieved_at: line.retrieved_at,
    manifest_key: manifestKey,
    line_index: lineIndex,
  };
  if (line.http_status !== 200) return { ...base, raw_payload_verified: false, verification_detail: null };
  const receipt = captureReceiptFromManifest(line, manifestKey, lineIndex);
  if (receipt === null) return { ...base, raw_payload_verified: false, verification_detail: "manifest-receipt-invalid" };
  try {
    const [payload, sidecar] = await Promise.all([
      getBytes(s3Client(), receipt.storage_key),
      getBytes(s3Client(), `${receipt.storage_key}.meta.json`),
    ]);
    const checked = verifyRawCapturePayload(receipt, payload, JSON.parse(sidecar.toString("utf8")) as unknown);
    return {
      ...base,
      sha256: receipt.sha256,
      retrieved_at: receipt.retrieved_at,
      raw_payload_verified: checked.verified,
      verification_detail: checked.reason,
    };
  } catch (error) {
    return {
      ...base,
      raw_payload_verified: false,
      verification_detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

async function completedRunLines(runStamp: string): Promise<Array<{ manifestKey: string; lineIndex: number; line: CaptureManifestLine }>> {
  const prefix = `capture/_runs/zones-${runStamp}-`;
  const entries = await listObjectEntries(s3Client(), prefix);
  const manifestKeys = entries.map((entry) => entry.key)
    .filter((key) => /^capture\/_runs\/zones-\d{8}T\d{6}Z-[^/]+\/manifest\.jsonl$/.test(key))
    .sort();
  const headerKeys = entries.map((entry) => entry.key)
    .filter((key) => /^capture\/_runs\/zones-\d{8}T\d{6}Z-[^/]+\/run\.json$/.test(key))
    .sort();
  if (manifestKeys.length === 0 || headerKeys.length !== manifestKeys.length) {
    throw new Error(`capture run incomplete: manifests=${manifestKeys.length}, headers=${headerKeys.length}`);
  }
  const headers = await Promise.all(headerKeys.map(async (key) => readRunHeader(await getBytes(s3Client(), key), key)));
  if (headers.some((header) => header.exit_code !== 0)) {
    throw new Error(`capture run incomplete: non-zero exit code in ${runStamp}`);
  }
  const manifests = await Promise.all(manifestKeys.map(async (manifestKey) => ({
    manifestKey,
    lines: parseManifestJsonl((await getBytes(s3Client(), manifestKey)).toString("utf8")),
  })));
  return manifests.flatMap(({ manifestKey, lines }) => lines.map((line, lineIndex) => ({ manifestKey, lineIndex, line })));
}

function closedPartition<T extends { outcome: CaptureOutcome }>(rows: readonly T[]): Record<CaptureOutcome | "total" | "closed", number | boolean> {
  const partition: Record<CaptureOutcome | "total", number> = {
    SHA_IDENTIQUE: 0,
    SHA_DIFFERENT: 0,
    HTTP_404: 0,
    AUTRE: 0,
    total: rows.length,
  };
  for (const row of rows) partition[row.outcome]++;
  return { ...partition, closed: partition.total === rows.length };
}

async function main(): Promise<void> {
  const scopeArgument = option("scope");
  const worklistArgument = option("worklist");
  const runStamp = option("run-stamp");
  const outputArgument = option("out");
  if (!scopeArgument || !worklistArgument || !runStamp || !outputArgument) {
    throw new Error("--scope=<scope.json> --worklist=<worklist.json> --run-stamp=<YYYYMMDDTHHMMSSZ> --out=<assessment.json> are required");
  }
  if (!validRunStamp(runStamp)) throw new Error("--run-stamp must be YYYYMMDDTHHMMSSZ");
  const scopePath = insideRepo(scopeArgument, "scope");
  const worklistPath = insideRepo(worklistArgument, "worklist");
  const outputPath = insideRepo(outputArgument, "out");
  if (existsSync(outputPath)) throw new Error(`refusing to overwrite: ${relative(ROOT, outputPath)}`);

  const scope = readScope(scopePath);
  const worklist = parseCaptureWorklist(JSON.parse(readFileSync(worklistPath, "utf8")) as unknown);
  const scopeBySlug = new Map(scope.collection_scope.map((row) => [row.slug, row]));
  if (scopeBySlug.size !== scope.collection_scope.length) throw new Error("scope repeats a slug");
  const targets = worklist.flatMap((target): CaptureTarget[] => {
    if (target.urls.length !== 1) throw new Error(`control worklist target must have exactly one URL: ${target.slug}`);
    const scopeRow = scopeBySlug.get(target.slug);
    if (!scopeRow || scopeRow.url !== target.urls[0]) throw new Error(`control worklist target does not exactly match scope: ${target.slug}`);
    return [{ slug: target.slug, source: target.source, url: target.urls[0]! }];
  });
  if (targets.length !== scope.collection_scope.length) throw new Error("control worklist and scope collection counts differ");
  if (new Set(targets.map((target) => target.slug)).size !== targets.length) throw new Error("control worklist repeats a slug");

  const lines = await completedRunLines(runStamp);

  const urls: UrlAssessment[] = [];
  for (const target of targets) {
    const captured = lineForControlTarget(target, lines.map(({ line }) => line));
    const capturedEntry = lines.find(({ line }) => line === captured);
    if (!capturedEntry) throw new Error(`capture manifest line vanished for ${target.slug}`);
    const member = scopeBySlug.get(target.slug)!;
    const observation = await observedCapture(capturedEntry.line, capturedEntry.manifestKey, capturedEntry.lineIndex);
    const expected = [member.sha256];
    urls.push({
      url: target.url,
      ...observation,
      outcome: outcomeFor(observation, expected),
      slugs: [member.slug],
      expected_sha256: expected,
    });
  }
  const collections = urls.flatMap((url) => url.slugs.map((slug) => ({ slug, url: url.url, outcome: url.outcome })));
  const changed = urls.flatMap((url) => url.outcome === "SHA_DIFFERENT"
    ? url.slugs.map((slug) => ({ slug, url: url.url, served_sha256: url.expected_sha256, captured_sha256: url.sha256, manifest_key: url.manifest_key, line_index: url.line_index }))
    : []);
  const report = {
    contract: "served-zonage-proof-v1-v2-capture-assessment/v1",
    generated_at: new Date().toISOString(),
    complete: true,
    scope: relative(ROOT, scopePath),
    worklist: relative(ROOT, worklistPath),
    run_stamp: runStamp,
    captures: { unique_urls: urls.length, partition: closedPartition(urls) },
    collections: { affected: collections.length, partition: closedPartition(collections) },
    urls,
    sha_changed_collections: changed,
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    output: relative(ROOT, outputPath),
    captures: report.captures,
    collections: report.collections,
    sha_changed_collections: changed.map((row) => row.slug),
  }, null, 2));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
