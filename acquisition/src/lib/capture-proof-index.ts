/**
 * Durable, reconstructible index of capture tuples accepted as v2 geometry
 * proof.  The index is intentionally a projection of capture manifests: it
 * never accepts a URL/hash supplied by a served writer.
 */
import { createHash } from "node:crypto";

import {
  CaptureRunHeaderSchema,
  parseManifestJsonl,
  type CaptureManifestLine,
} from "../../../packages/qc-sources/src/capture/index.js";
import type { GeometrySourceProof } from "./zonage-proof.js";

/** Immutable snapshot namespace; a generated index is never overwritten in place. */
export const CAPTURE_PROOF_INDEX_PREFIX = "capture/_index/by-sha256/";
export const CAPTURE_PROOF_INDEX_CONTENT_TYPE = "application/x-ndjson";

export interface CaptureProofIndexEntry {
  url: string;
  sha256: `sha256:${string}`;
  retrieved_at: string;
  run_id: string;
  manifest_key: string;
  manifest_line: number;
  storage_key: string;
}

/** Complete immutable row identity required when a receipt consumes the index. */
export type CaptureProofIndexRecord = Pick<
  CaptureProofIndexEntry,
  "url" | "sha256" | "retrieved_at" | "run_id" | "manifest_key" | "manifest_line" | "storage_key"
>;

/** Read-only S3 surface used to reconstruct the index from durable manifests. */
export interface CaptureProofManifestReader {
  listManifestKeys(): Promise<string[]>;
  getBytes(key: string): Promise<Buffer>;
}

/**
 * The sole mutable capability needed to publish an index snapshot.  The S3
 * adapter maps this to a conditional PUT followed by a byte-for-byte re-read
 * on a pre-existing key, so a key collision cannot silently replace evidence.
 */
export interface CaptureProofIndexSnapshotStore extends CaptureProofManifestReader {
  putBytesIfAbsentOrEqual(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<"created" | "existing-equal">;
}

export interface PublishedCaptureProofIndex {
  key: string;
  sha256: `sha256:${string}`;
  bytes: number;
  disposition: "created" | "existing-equal";
}

const SHA256_RE = /^sha256:[a-f0-9]{64}$/;

function digestSha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** The index content digest names its immutable S3 snapshot. */
export function captureProofIndexSnapshotKey(bytes: Uint8Array): string {
  return `${CAPTURE_PROOF_INDEX_PREFIX}${digestSha256(bytes).slice("sha256:".length)}.jsonl`;
}

function canonicalEntry(entry: CaptureProofIndexEntry): CaptureProofIndexEntry {
  // Do not serialize the parsed object directly: JSON key insertion order is
  // otherwise attacker-controlled, and a non-canonical S3 index could pass a
  // read/serialize equality check unchanged.
  return {
    url: entry.url,
    sha256: entry.sha256,
    retrieved_at: entry.retrieved_at,
    run_id: entry.run_id,
    manifest_key: entry.manifest_key,
    manifest_line: entry.manifest_line,
    storage_key: entry.storage_key,
  };
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isIndexEntry(value: unknown): value is CaptureProofIndexEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<CaptureProofIndexEntry>;
  return (
    typeof entry.url === "string" && /^https?:\/\//.test(entry.url) &&
    typeof entry.sha256 === "string" && SHA256_RE.test(entry.sha256) &&
    isIsoTimestamp(entry.retrieved_at) &&
    typeof entry.run_id === "string" && entry.run_id.length > 0 &&
    typeof entry.manifest_key === "string" && entry.manifest_key.startsWith("capture/_runs/") &&
    Number.isInteger(entry.manifest_line) && (entry.manifest_line ?? -1) >= 0 &&
    typeof entry.storage_key === "string" && entry.storage_key.startsWith("raw/")
  );
}

/**
 * Only durable successful raw captures become index entries. Failed, redacted,
 * non-CAS and non-HTTP rows remain in their run manifest for diagnosis but can
 * never turn a v2 proof into a write permit.
 */
export function captureProofIndexEntryFromManifest(
  line: CaptureManifestLine,
  manifestKey: string,
  manifestLine: number,
): CaptureProofIndexEntry | null {
  if (
    !manifestKey.startsWith("capture/_runs/") ||
    !Number.isInteger(manifestLine) || manifestLine < 0 ||
    line.http_status === null || line.http_status < 200 || line.http_status >= 300 ||
    line.error !== null || line.redacted || line.robots !== "allowed" ||
    !line.url.startsWith("http://") && !line.url.startsWith("https://") ||
    line.sha256 === null || !SHA256_RE.test(line.sha256) ||
    line.storage_key === null || !line.storage_key.startsWith("raw/") ||
    !isIsoTimestamp(line.retrieved_at) || line.run_id.length === 0
  ) {
    return null;
  }
  return {
    url: line.url,
    // The immediately preceding SHA256_RE guard proves this template shape;
    // CaptureManifestLine intentionally exposes the broader string type.
    sha256: line.sha256 as `sha256:${string}`,
    retrieved_at: line.retrieved_at,
    run_id: line.run_id,
    manifest_key: manifestKey,
    manifest_line: manifestLine,
    storage_key: line.storage_key,
  };
}

/** Stable JSONL projection: one row per observed (URL, SHA-256) pair. */
export function serializeCaptureProofIndex(entries: readonly CaptureProofIndexEntry[]): string {
  const unique = new Map<string, CaptureProofIndexEntry>();
  for (const entry of entries) {
    if (!isIndexEntry(entry)) throw new Error("capture proof index: invalid entry");
    const key = `${entry.url}\u0000${entry.sha256}`;
    const existing = unique.get(key);
    // The first manifest occurrence is deterministic after a lexical manifest
    // scan; do not silently replace it with a later mutable observation.
    if (!existing) unique.set(key, entry);
  }
  return [...unique.values()]
    .sort((a, b) => a.url.localeCompare(b.url) || a.sha256.localeCompare(b.sha256))
    .map((entry) => JSON.stringify(canonicalEntry(entry)))
    .join("\n") + (unique.size > 0 ? "\n" : "");
}

export function parseCaptureProofIndex(bytes: Buffer): CaptureProofIndexEntry[] {
  const text = bytes.toString("utf8");
  if (text.length === 0) return [];
  const entries: CaptureProofIndexEntry[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of text.trimEnd().split("\n").entries()) {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(`capture proof index: line ${index + 1} is not JSON`);
    }
    if (!isIndexEntry(value)) throw new Error(`capture proof index: line ${index + 1} is invalid`);
    const entry = value;
    const tuple = `${entry.url}\u0000${entry.sha256}`;
    if (seen.has(tuple)) throw new Error(`capture proof index: duplicate URL/SHA-256 pair at line ${index + 1}`);
    seen.add(tuple);
    entries.push(entry);
  }
  if (serializeCaptureProofIndex(entries) !== text) {
    throw new Error("capture proof index: bytes are not canonical");
  }
  return entries;
}

/**
 * Reconstruct the complete canonical index from the manifest objects already
 * persisted by capture jobs.  Sorting keys before projecting makes the winner
 * for a repeated URL/SHA tuple deterministic; malformed manifests fail closed
 * instead of silently disappearing from the audit surface.
 */
export async function materializeCaptureProofIndex(reader: CaptureProofManifestReader): Promise<string> {
  const keys = [...new Set(await reader.listManifestKeys())].sort();
  const entries: CaptureProofIndexEntry[] = [];
  for (const key of keys) {
    const match = /^capture\/_runs\/([^/]+)\/manifest\.jsonl$/.exec(key);
    if (!match) {
      throw new Error(`capture proof index: unexpected manifest key ${key}`);
    }
    const runId = match[1]!;
    const headerKey = `capture/_runs/${runId}/run.json`;
    let header: ReturnType<typeof CaptureRunHeaderSchema.parse>;
    try {
      header = CaptureRunHeaderSchema.parse(JSON.parse((await reader.getBytes(headerKey)).toString("utf8")));
    } catch {
      throw new Error(`capture proof index: invalid run header ${headerKey}`);
    }
    if (
      header.run_id !== runId || header.execution !== "cluster"
      || header.finished_at === null || header.exit_code !== 0
    ) {
      throw new Error(`capture proof index: run is not a completed cluster capture ${runId}`);
    }
    const lines = parseManifestJsonl((await reader.getBytes(key)).toString("utf8"));
    for (const [index, line] of lines.entries()) {
      const entry = captureProofIndexEntryFromManifest(line, key, index);
      if (entry !== null) entries.push(entry);
    }
  }
  return serializeCaptureProofIndex(entries);
}

/**
 * Materialize then conditionally publish one immutable index snapshot.  The
 * returned key is content-addressed and must be pinned by every future deposit;
 * there is deliberately no mutable `latest` pointer to race or to rewrite.
 */
export async function publishCaptureProofIndex(
  store: CaptureProofIndexSnapshotStore,
): Promise<PublishedCaptureProofIndex> {
  const body = Buffer.from(await materializeCaptureProofIndex(store), "utf8");
  const sha256 = digestSha256(body);
  const key = captureProofIndexSnapshotKey(body);
  const disposition = await store.putBytesIfAbsentOrEqual(key, body, CAPTURE_PROOF_INDEX_CONTENT_TYPE);
  return { key, sha256, bytes: body.byteLength, disposition };
}

/** Exact v2 tuple membership required by C-1/C-2 before a future served write. */
export function hasCaptureProof(
  entries: readonly CaptureProofIndexEntry[],
  proof: Pick<GeometrySourceProof, "url" | "retrieved_at" | "sha256">,
): boolean {
  return entries.some(
    (entry) => entry.url === proof.url
      && entry.retrieved_at === proof.retrieved_at
      && entry.sha256 === proof.sha256,
  );
}

/**
 * Stronger than tuple membership: a deposit receipt must find its exact
 * manifest row and CAS object in the pinned index, not merely another capture
 * that happened to retrieve identical bytes from the same URL.
 */
export function hasCaptureProofRecord(
  entries: readonly CaptureProofIndexEntry[],
  expected: CaptureProofIndexRecord,
): boolean {
  return entries.some(
    (entry) => entry.url === expected.url
      && entry.retrieved_at === expected.retrieved_at
      && entry.sha256 === expected.sha256
      && entry.run_id === expected.run_id
      && entry.manifest_key === expected.manifest_key
      && entry.manifest_line === expected.manifest_line
      && entry.storage_key === expected.storage_key,
  );
}
