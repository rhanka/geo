import { canonicalizeNoLotForJoin, canonicalizeZoneCodeForJoin } from "../zonage/lotZoneJoin.js";

/** A served zone reference: the municipality slug and the raw served zone code. */
export interface ServedZoneRef {
  readonly citySlug: string;
  readonly zoneCode: unknown;
}

/** A served lot reference: the municipality slug and the raw cadastral lot number. */
export interface ServedLotRef {
  readonly citySlug: string;
  readonly noLot: unknown;
}

export interface ServedCanonicalIdsInput {
  readonly zones?: Iterable<ServedZoneRef>;
  readonly lots?: Iterable<ServedLotRef>;
}

/**
 * Byte-order (LC_ALL=C) comparison of two UTF-8 strings, so the emitted set and
 * a downstream `comm -23` / streaming merge-diff order identically regardless of
 * locale.
 */
function byteOrder(a: string, b: string): number {
  return Buffer.from(a, "utf8").compare(Buffer.from(b, "utf8"));
}

/**
 * Build the sorted, deduplicated set of canonical join ids that geo SERVES at a
 * bascule cycle — the payload of `sets/<CYCLE_ID>/served-ids.ndjson.gz` that
 * immo's join-verify diffs against, fail-closed (`immo_refs ⊆ served`).
 *
 * Tokens live in immo's canonical_id space BY CONSTRUCTION, via the single-source
 * `@sentropic/geo` canonicalizers (so no locale/normalizer divergence):
 *   `ogc:zones:<citySlug>:<canonicalizeZoneCodeForJoin(zoneCode)>`
 *   `ogc:lots:<citySlug>:<canonicalizeNoLotForJoin(noLot)>`
 *
 * A ref whose canonical form is empty (a null / out-of-polygon `code_zone`, a
 * blank `no_lot`, or a missing slug) is SKIPPED: its absence is precisely what
 * immo's fail-closed verify must raise if immo still references it. The result is
 * sorted in byte order for a deterministic, streamable diff.
 */
export function buildServedCanonicalIds(input: ServedCanonicalIdsInput): string[] {
  const ids = new Set<string>();
  for (const zone of input.zones ?? []) {
    const code = canonicalizeZoneCodeForJoin(zone.zoneCode);
    if (!zone.citySlug || code === "") continue;
    ids.add(`ogc:zones:${zone.citySlug}:${code}`);
  }
  for (const lot of input.lots ?? []) {
    const noLot = canonicalizeNoLotForJoin(lot.noLot);
    if (!lot.citySlug || noLot === "") continue;
    ids.add(`ogc:lots:${lot.citySlug}:${noLot}`);
  }
  return [...ids].sort(byteOrder);
}

/**
 * Canonical serialization of a served-ids set: newline-terminated, one id per
 * line, already byte-sorted. These are the exact bytes hashed into geo.json
 * `s3_servi.sha256` and streamed (gzipped) as `served-ids.ndjson.gz`, so the
 * hash is reproducible on both sides.
 */
export function serializeServedCanonicalIds(ids: readonly string[]): string {
  return ids.length === 0 ? "" : ids.join("\n") + "\n";
}
