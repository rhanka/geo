/**
 * Durable, reconstructible index of capture tuples accepted as v2 geometry
 * proof.  The index is intentionally a projection of capture manifests: it
 * never accepts a URL/hash supplied by a served writer.
 */
import type { CaptureManifestLine } from "../../../packages/qc-sources/src/capture/index.js";
import type { GeometrySourceProof } from "./zonage-proof.js";

export const CAPTURE_PROOF_INDEX_KEY = "capture/_index/by-sha256.jsonl";

export interface CaptureProofIndexEntry {
  url: string;
  sha256: `sha256:${string}`;
  retrieved_at: string;
  run_id: string;
  manifest_key: string;
  manifest_line: number;
  storage_key: string;
}

const SHA256_RE = /^sha256:[a-f0-9]{64}$/;

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

/** Exact pair membership required by C-1/C-2 before a future served write. */
export function hasCaptureProof(entries: readonly CaptureProofIndexEntry[], proof: Pick<GeometrySourceProof, "url" | "sha256">): boolean {
  return entries.some((entry) => entry.url === proof.url && entry.sha256 === proof.sha256);
}
