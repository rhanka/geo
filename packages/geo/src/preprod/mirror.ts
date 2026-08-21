/**
 * Preprod récup cycle — PURE logic for the geo jamb (SPEC geo-preprod-serving
 * §5/§6.1, ADR-0027). No I/O: the runnable wrapper (`scripts/geo-preprod-sync.mjs`)
 * lists/copies S3 and reads the served count, then calls these to decide WHAT to
 * mirror and WHAT coherence manifest to stamp. Kept in the lib (principe
 * fondateur : ce qui sert à chaque refresh se capitalise, avec test) so the
 * full-mirror selection and the manifest shape have one tested source of truth,
 * shared with the reader side (`StoreProvider` serves the same `coherence.json`).
 */

import { createHash } from "node:crypto";

// Règle canonique PARTAGÉE (même source que le serving) — import direct du module
// pur pour garder cette lib légère (pas de dépendance @aws-sdk via le barrel storage).
import { isCanonicalGeojsonKey } from "../storage/canonical-key.js";

/** Manifest object name at the data root; store key is relative to the prefix. */
export const COHERENCE_MANIFEST_BASENAME = "coherence.json";

/**
 * Canonical hash of a served collection-id SET (ADR-0027 §7 A5). Order- and
 * duplicate-independent: ids are deduped and sorted before hashing, so the same
 * set always yields the same digest regardless of listing order. The gate hashes
 * geo-preprod's `/collections` ids the SAME way and compares to the manifest
 * `set_hash` — a true set-match (a drop+add keeping the count equal still fails),
 * closing the gap a bare count-match leaves open.
 */
export function computeSetHash(ids: readonly string[]): string {
  const canonical = [...new Set(ids)].sort().join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

/** Trim leading/trailing slashes from a key prefix. */
function trimPrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "");
}

/** The coherence manifest's full dest key under `destPrefix` (`""` → root). */
export function coherenceManifestKeyFor(destPrefix: string): string {
  const dp = trimPrefix(destPrefix);
  return dp ? `${dp}/${COHERENCE_MANIFEST_BASENAME}` : COHERENCE_MANIFEST_BASENAME;
}

/**
 * Remap a source object key from under `srcPrefix` to the same relative path
 * under `destPrefix` (full-mirror: the relative tree is preserved byte-for-byte).
 */
export function destKeyForMirror(srcKey: string, srcPrefix: string, destPrefix: string): string {
  const sp = trimPrefix(srcPrefix);
  const dp = trimPrefix(destPrefix);
  const rest = sp && srcKey.startsWith(`${sp}/`) ? srcKey.slice(sp.length + 1) : srcKey;
  return dp ? `${dp}/${rest}` : rest;
}

/** One planned copy: a source key and its mirrored destination key. */
export interface MirrorCopy {
  srcKey: string;
  destKey: string;
}

/** The full-mirror plan for a listing of source keys. */
export interface MirrorPlan {
  /** Every source object to copy (full mirror — no whitelist). */
  copies: MirrorCopy[];
  /** The dest key the runner stamps its own manifest at (excluded from copies). */
  coherenceKey: string;
  /** Source keys deliberately not copied (a source-side `coherence.json`). */
  skipped: string[];
  /**
   * Dest keys to PRUNE so the SERVED mirror is exact parity, not add-only (§4
   * GELÉ, ADR-0027): **CANONICAL** dest objects ({@link isCanonicalGeojsonKey})
   * matching no mirrored source key. Non-canonical dest keys — backups
   * (`_replaced/`, `_zone-source-fold-backups/`), prebackups, sidecars, the
   * `coherence.json` manifest — are NEVER pruned: they are audit/reversibility
   * provenance, and the serving already excludes them from the index, so parity
   * of the SERVED set holds without deleting a byte of provenance. Empty when no
   * dest listing is given, OR when `srcKeys` is empty — the safety default that
   * refuses to prune against an empty/failed source listing (mass-delete guard,
   * garde-fou #1); the runner additionally verifies the source list fully
   * succeeded and bounds the delete count before executing.
   */
  deletes: string[];
}

/**
 * Plan a FULL mirror of `srcKeys` from `srcPrefix` to `destPrefix`: every object
 * is copied (data-driven parity — geo-prod serves 3885 collections incl. 1088
 * bare-slug ones a whitelist would miss), EXCEPT a source object that would land
 * on the dest coherence manifest key — the runner stamps its own, so mirroring a
 * stray source `coherence.json` must not clobber it.
 *
 * When `destKeys` (the current dest listing) is supplied, also computes
 * {@link MirrorPlan.deletes} = **canonical** dest keys matching no mirrored source
 * key, so the runner can PRUNE the served set to exact parity while PRESERVING all
 * non-canonical provenance (backups/prebackups/sidecars). An empty `srcKeys` yields
 * no deletes (safety: never mass-delete against an empty/failed source).
 */
export function planFullMirror(
  srcKeys: readonly string[],
  srcPrefix: string,
  destPrefix: string,
  destKeys: readonly string[] = [],
): MirrorPlan {
  const coherenceKey = coherenceManifestKeyFor(destPrefix);
  const copies: MirrorCopy[] = [];
  const skipped: string[] = [];
  for (const srcKey of srcKeys) {
    const destKey = destKeyForMirror(srcKey, srcPrefix, destPrefix);
    if (destKey === coherenceKey) {
      skipped.push(srcKey);
      continue;
    }
    copies.push({ srcKey, destKey });
  }
  // Prune plan: delete ONLY canonical surplus (a served-eligible dest key matching
  // no mirrored source key). Non-canonical keys (backups/prebackups/sidecars/the
  // manifest) are PRESERVED — provenance, and not served anyway. Refuse to prune
  // when the source is empty (mass-delete guard #1).
  const expected = new Set(copies.map((c) => c.destKey));
  expected.add(coherenceKey);
  const deletes =
    srcKeys.length === 0
      ? []
      : destKeys.filter((k) => isCanonicalGeojsonKey(k) && !expected.has(k));
  return { copies, coherenceKey, skipped, deletes };
}

/**
 * Safety bound for a prune (garde-fou #2): is deleting `deleteCount` of
 * `destCount` objects too much? A full/partial source-listing failure would make
 * the prune try to delete a large share of the dest; abort past `maxFraction`.
 * A known-empty dest with anything to delete is treated as exceeded (defensive).
 */
export function pruneBoundExceeded(
  deleteCount: number,
  destCount: number,
  maxFraction: number,
): boolean {
  if (deleteCount <= 0) return false;
  if (destCount <= 0) return true;
  return deleteCount / destCount > maxFraction;
}

/** Default prune safety bound: abort if a run would delete > 25% of the dest. */
export const DEFAULT_MAX_DELETE_FRACTION = 0.25;

/** Dataset-level freshness + completeness manifest stamped at the data root. */
export interface CoherenceManifest {
  /** Watermark of the prod snapshot mirrored (shared cross-repo with immo, §6.1). */
  coherence_id: string;
  /** Number of collections geo serves for this snapshot (completeness reference). */
  served_count: number;
  /** Hash of the served collection-id set (true set-match, §7 A5). */
  set_hash: string;
  /** ISO-8601 stamp time (injected — never read the clock here, for testability). */
  generated_at: string;
  /** The prod snapshot watermark; defaults to `coherence_id`. */
  prod_watermark: string;
}

/**
 * Build the `coherence.json` payload. FAIL-CLOSED on a missing/invalid
 * `servedCount` (non-negative integer), empty `coherenceId`, or empty `setHash`:
 * the completeness/parity proof is only meaningful with a real count AND set
 * hash, so the runner must refuse to stamp rather than publish a manifest a gate
 * would trust blindly.
 */
export function buildCoherenceManifest(input: {
  coherenceId: string;
  servedCount: number;
  setHash: string;
  generatedAt: string;
  prodWatermark?: string;
}): CoherenceManifest {
  if (typeof input.coherenceId !== "string" || input.coherenceId.length === 0) {
    throw new Error("buildCoherenceManifest: coherenceId is required and must be non-empty");
  }
  if (!Number.isInteger(input.servedCount) || input.servedCount < 0) {
    throw new Error("buildCoherenceManifest: servedCount must be a non-negative integer (completeness proof)");
  }
  if (typeof input.setHash !== "string" || input.setHash.length === 0) {
    throw new Error("buildCoherenceManifest: setHash is required and must be non-empty (parity proof)");
  }
  if (typeof input.generatedAt !== "string" || input.generatedAt.length === 0) {
    throw new Error("buildCoherenceManifest: generatedAt is required");
  }
  return {
    coherence_id: input.coherenceId,
    served_count: input.servedCount,
    set_hash: input.setHash,
    generated_at: input.generatedAt,
    prod_watermark: input.prodWatermark ?? input.coherenceId,
  };
}
