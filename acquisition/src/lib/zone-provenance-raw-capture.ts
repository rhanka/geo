/**
 * Byte-identity checks for a capture receipt matched to a served v2 proof.
 *
 * The capture manifest is the authoritative record of one fetch
 * (URL + retrieval instant + declared SHA).  The adjacent CAS sidecar instead
 * identifies the bytes at one content-addressed location.  A CAS dedup keeps
 * its first sidecar while later manifests legitimately describe other fetches
 * of those same bytes, so fetch facts must never be compared to the sidecar.
 */
import { createHash } from "node:crypto";

import type { CaptureReceipt } from "./zone-provenance-quality.js";

export interface RawCaptureSidecarObservation {
  sourceUrl: unknown;
  sha256: unknown;
  fetchedAt: unknown;
  storageKey: unknown;
  backfilled: boolean;
}

export interface RawCaptureVerificationObservation {
  receipt: CaptureReceipt;
  actual_sha256: `sha256:${string}`;
  sidecar: RawCaptureSidecarObservation | null;
}

export interface RawCapturePayloadVerification {
  verified: boolean;
  reason: string | null;
  observation: RawCaptureVerificationObservation;
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sidecarObservation(value: unknown): RawCaptureSidecarObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const meta = value as {
    sourceUrl?: unknown;
    sha256?: unknown;
    fetchedAt?: unknown;
    storageKey?: unknown;
    backfilled?: unknown;
    provenance?: { backfilled?: unknown };
  };
  return {
    sourceUrl: meta.sourceUrl,
    sha256: meta.sha256,
    fetchedAt: meta.fetchedAt,
    storageKey: meta.storageKey,
    backfilled: meta.backfilled === true || meta.provenance?.backfilled === true,
  };
}

/**
 * Verify the two distinct authorities required by proof v2.
 *
 * The matched manifest already supplies the exact served URL/retrieved_at/SHA
 * tuple.  This function proves the payload at its CAS key is those bytes and
 * that the sidecar belongs to that same content-addressed object.  It keeps the
 * backfill exclusion, but deliberately does not compare sidecar sourceUrl or
 * fetchedAt: those belong to the first fetch that populated a deduplicated CAS.
 */
export function verifyRawCapturePayload(
  receipt: CaptureReceipt,
  bytes: Uint8Array,
  rawSidecar: unknown,
): RawCapturePayloadVerification {
  const actual_sha256 = sha256(bytes);
  const sidecar = sidecarObservation(rawSidecar);
  const observation = { receipt, actual_sha256, sidecar };
  if (actual_sha256 !== receipt.sha256) {
    return { verified: false, reason: `cas-sha-mismatch:${actual_sha256}`, observation };
  }
  if (sidecar === null) {
    return { verified: false, reason: "capture-meta-invalid", observation };
  }
  if (sidecar.backfilled) {
    return { verified: false, reason: "capture-backfilled", observation };
  }

  const expectedSha256 = receipt.sha256.slice("sha256:".length);
  const failures: string[] = [];
  if (sidecar.sha256 !== expectedSha256) failures.push("capture-meta-sha256-does-not-match-manifest");
  if (sidecar.storageKey !== receipt.storage_key) failures.push("capture-meta-storage-key-does-not-match-manifest");
  return failures.length === 0
    ? { verified: true, reason: null, observation }
    : { verified: false, reason: failures.join("+"), observation };
}
