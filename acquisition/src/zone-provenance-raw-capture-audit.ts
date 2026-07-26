/**
 * Audit one preserved provenance matrix against the current immutable capture
 * evidence.  It is read-only on S3 and records the exact manifest/sidecar
 * values for every historical proof whose manifest receipt can still be read.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *   npx tsx acquisition/src/zone-provenance-raw-capture-audit.ts \
 *     --matrix=work/coverage/zone-provenance-quality-matrix-YYYYMMDD-<hash>.json
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../packages/qc-sources/src/capture/index.js";
import { getBytes, listObjectEntries, s3Client } from "./lib/s3.js";
import {
  captureManifestKeyFromListedRest,
  captureReceiptFromManifest,
  proofTuple,
  type CaptureReceipt,
} from "./lib/zone-provenance-quality.js";
import { verifyRawCapturePayload } from "./lib/zone-provenance-raw-capture.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const COVERAGE = resolve(ROOT, "work", "coverage");
const CAPTURE_RUNS_PREFIX = "capture/_runs/";
const S3_READ_TIMEOUT_MS = 300_000;
const argv = process.argv.slice(2);

interface BaselineProof {
  city_slug: string;
  collection_key: string | null;
  proof: {
    url: string;
    retrieved_at: string;
    sha256: `sha256:${string}`;
  };
}

interface MatrixLike {
  proof_without_attachable_capture?: unknown;
}

function option(name: string): string | null {
  const prefix = `--${name}=`;
  const value = argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function errorText(error: unknown): string {
  const value = error as { name?: unknown; message?: unknown; $metadata?: { httpStatusCode?: unknown } };
  const status = value?.$metadata?.httpStatusCode;
  return `${String(value?.name ?? "Error")}: ${String(value?.message ?? error)}${status ? ` (HTTP ${status})` : ""}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  renameSync(temp, path);
}

async function retryS3<T>(label: string, fn: (abortSignal: AbortSignal) => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      try {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, S3_READ_TIMEOUT_MS);
        return await fn(controller.signal);
      } catch (error) {
        if (timedOut) throw new Error(`lecture S3 expirée après ${S3_READ_TIMEOUT_MS}ms: ${label}`);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (error) {
      last = error;
      if (attempt < 3) console.error(`[raw-capture-audit] retry ${attempt}/2: ${label}: ${errorText(error)}`);
    }
  }
  throw last;
}

function baselineProofs(value: unknown): BaselineProof[] {
  if (!Array.isArray(value)) throw new Error("matrice: proof_without_attachable_capture absent ou invalide");
  return value.map((row, index) => {
    if (!row || typeof row !== "object") throw new Error(`matrice: ligne ${index} invalide`);
    const candidate = row as { city_slug?: unknown; collection_key?: unknown; proof?: unknown };
    const wrapper = candidate.proof as { geometry_source?: unknown } | null;
    const proof = wrapper?.geometry_source as { url?: unknown; retrieved_at?: unknown; sha256?: unknown } | null;
    if (
      typeof candidate.city_slug !== "string"
      || (typeof candidate.collection_key !== "string" && candidate.collection_key !== null)
      || !proof
      || typeof proof.url !== "string"
      || typeof proof.retrieved_at !== "string"
      || typeof proof.sha256 !== "string"
      || !/^sha256:[a-f0-9]{64}$/.test(proof.sha256)
    ) throw new Error(`matrice: preuve v2 invalide ligne ${index}`);
    return {
      city_slug: candidate.city_slug,
      collection_key: candidate.collection_key,
      proof: { url: proof.url, retrieved_at: proof.retrieved_at, sha256: proof.sha256 as `sha256:${string}` },
    };
  });
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      result[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return result;
}

async function main(): Promise<void> {
  const source = option("matrix");
  if (!source) throw new Error("--matrix=work/coverage/zone-provenance-quality-matrix-...json est requis");
  const matrixPath = resolve(ROOT, source);
  if (!existsSync(matrixPath)) throw new Error(`matrice introuvable: ${matrixPath}`);
  const baseline = baselineProofs((JSON.parse(readFileSync(matrixPath, "utf8")) as MatrixLike).proof_without_attachable_capture);
  const s3 = s3Client();

  const listed = await retryS3(`ListObjectsV2 ${CAPTURE_RUNS_PREFIX}`, (signal) => listObjectEntries(s3, CAPTURE_RUNS_PREFIX, undefined, signal));
  const manifestKeys = listed.flatMap((entry) => {
    const key = captureManifestKeyFromListedRest(entry.key.slice(CAPTURE_RUNS_PREFIX.length));
    return key === entry.key ? [key] : [];
  });
  const scanned = await mapConcurrent(manifestKeys, 4, async (key) => {
    const text = (await retryS3(`GetObject ${key}`, (signal) => getBytes(s3, key, undefined, signal))).toString("utf8");
    return parseManifestJsonl(text).flatMap((line: CaptureManifestLine, lineIndex) => {
      const receipt = captureReceiptFromManifest(line, key, lineIndex);
      return receipt ? [receipt] : [];
    });
  });
  const byTuple = new Map<string, CaptureReceipt[]>();
  for (const receipt of scanned.flat()) {
    const tuple = proofTuple(receipt);
    byTuple.set(tuple, [...(byTuple.get(tuple) ?? []), receipt]);
  }

  const matches = baseline.flatMap((entry) => (byTuple.get(proofTuple(entry.proof)) ?? []).map((receipt) => ({ entry, receipt })));
  const observations = await mapConcurrent(matches, 4, async ({ entry, receipt }) => {
    const bytes = await retryS3(`GetObject ${receipt.storage_key}`, (signal) => getBytes(s3, receipt.storage_key, undefined, signal));
    const sidecar = JSON.parse((await retryS3(`GetObject ${receipt.storage_key}.meta.json`, (signal) => getBytes(s3, `${receipt.storage_key}.meta.json`, undefined, signal))).toString("utf8")) as unknown;
    const checked = verifyRawCapturePayload(receipt, bytes, sidecar);
    return { baseline: entry, verified: checked.verified, reason: checked.reason, ...checked.observation };
  });
  const report = {
    contract: "zone-provenance-raw-capture-audit/v1",
    generated_at: new Date().toISOString(),
    read_only_s3: true,
    baseline_matrix: source,
    baseline_proofs: baseline.length,
    manifests_scanned: manifestKeys.length,
    manifest_receipts: scanned.flat().length,
    matched_receipts: matches.length,
    verified: observations.filter((row) => row.verified).length,
    rejected: observations.filter((row) => !row.verified).length,
    observations,
  };
  const output = resolve(COVERAGE, `zone-provenance-raw-capture-audit-${sha256(JSON.stringify(report)).slice(0, 16)}.json`);
  if (existsSync(output)) throw new Error(`audit déjà présent, refus d'écraser: ${output}`);
  writeAtomic(output, report);
  console.log(JSON.stringify({ output, ...report, observations: undefined }, null, 2));
}

try {
  await main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
