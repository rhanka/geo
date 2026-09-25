import { createHash } from "node:crypto";

/**
 * Content-addressed backup key for an irreplaceable object. The name IS the
 * sha256, so the store deduplicates across cycles (a sha256 already present is a
 * no-op copy) and integrity is verifiable by construction (`sha256(bytes) ==
 * key`). Prefix defaults to the bascule layout `geo-objects/cas`.
 */
export function casObjectKey(sha256: string, prefix = "geo-objects/cas"): string {
  return `${prefix}/${sha256}`;
}

/** One irreplaceable source object captured for a cycle. */
export interface CasSourceEntry {
  /** Prod source key, e.g. `raw/<src>/cas/<sha256>.<ext>` or a capture manifest. */
  readonly sourceKey: string;
  readonly sha256: string;
  readonly size: number;
}

export interface CasInventoryEntry {
  readonly sha256: string;
  readonly size: number;
  readonly sourceKey: string;
}

export interface CasInventory {
  readonly cycleId: string;
  readonly count: number;
  readonly totalBytes: number;
  /** Deduplicated by sha256, sorted by sha256 in byte order. */
  readonly entries: readonly CasInventoryEntry[];
  /** sha256 over the sorted, newline-terminated sha256 list — the `sha256set`. */
  readonly setHash: string;
}

/**
 * Build the per-cycle CAS inventory for `sets/<cycleId>/inventory.json`:
 * deduplicate by sha256 (content-addressed → identical bytes collapse), sort by
 * sha256 in byte order for determinism, and hash the set. The first sourceKey
 * seen for a sha256 wins (they are byte-identical anyway). This is the pure
 * core; the thin S3 runner lists/copies and feeds it {sourceKey, sha256, size}.
 */
export function buildCasInventory(cycleId: string, entries: Iterable<CasSourceEntry>): CasInventory {
  const bySha = new Map<string, CasInventoryEntry>();
  for (const e of entries) {
    if (!e.sha256) continue;
    if (!bySha.has(e.sha256)) bySha.set(e.sha256, { sha256: e.sha256, size: e.size, sourceKey: e.sourceKey });
  }
  const sorted = [...bySha.values()].sort((a, b) =>
    Buffer.from(a.sha256, "utf8").compare(Buffer.from(b.sha256, "utf8")),
  );
  const setHash = createHash("sha256")
    .update(sorted.length === 0 ? "" : sorted.map((e) => e.sha256).join("\n") + "\n")
    .digest("hex");
  const totalBytes = sorted.reduce((sum, e) => sum + e.size, 0);
  return { cycleId, count: sorted.length, totalBytes, entries: sorted, setHash };
}

/** A target-side observation of a backup object (from listing the backup bucket). */
export interface CasTargetEntry {
  readonly size: number;
  /** Present only when the backup bucket has object versioning enabled (QUALIF 3). */
  readonly versionId?: string;
}

export interface CasReconcileResult {
  readonly ok: boolean;
  readonly checked: number;
  /** sha256 in the inventory but absent from the backup. */
  readonly missing: string[];
  /** sha256 present but with a divergent byte size. */
  readonly sizeMismatch: { sha256: string; expected: number; actual: number }[];
}

/**
 * Reconcile a cycle inventory against the actual backup listing, fail-closed:
 * every inventory sha256 must be present (as `casObjectKey(sha256)`) with a
 * matching size. For CAS the key IS the sha256, so key-presence + size is strong
 * integrity by construction; a periodic deep pass re-hashes bytes separately
 * (out of this pure step). Version-id is an OPTIONAL dimension: when the backup
 * bucket has versioning off it is simply absent and never hard-fails here
 * (QUALIF 3) — key + sha remains strong for CAS.
 */
export function reconcileCasInventory(
  inventory: CasInventory,
  target: ReadonlyMap<string, CasTargetEntry>,
  prefix = "geo-objects/cas",
): CasReconcileResult {
  const missing: string[] = [];
  const sizeMismatch: { sha256: string; expected: number; actual: number }[] = [];
  for (const e of inventory.entries) {
    const t = target.get(casObjectKey(e.sha256, prefix));
    if (!t) {
      missing.push(e.sha256);
      continue;
    }
    if (t.size !== e.size) sizeMismatch.push({ sha256: e.sha256, expected: e.size, actual: t.size });
  }
  return {
    ok: missing.length === 0 && sizeMismatch.length === 0,
    checked: inventory.entries.length,
    missing,
    sizeMismatch,
  };
}
