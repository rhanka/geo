/**
 * Index/mirror admission rule — the SHARED source of truth for "is this store
 * key a canonical served dataset?" (contrat d'index-discipline FIGÉ, ADR-0027).
 *
 * Used by BOTH the serving index ({@link ../api/providers/store-provider}) and the
 * sync prune ({@link ../preprod/mirror}) so the SERVED set and the PRUNED set are
 * computed from the same rule — no drift between "what geo-api serves" and "what
 * the mirror keeps".
 *
 * A backup / prebackup / sidecar must never be served nor pruned-as-surplus: the
 * serving excludes it (so a bare `.geojson` filter over a recursive `list()` does
 * not publish it), and the prune preserves it (audit/reversibility provenance).
 */

const GEOJSON_SUFFIX = ".geojson";

/** The `<name>` stem of a `.geojson` store key (basename without directory nor
 *  suffix). Shared so the serving index and the sync stamp derive ids identically. */
export function stemOf(geojsonKey: string): string {
  const slash = geojsonKey.lastIndexOf("/");
  const base = slash === -1 ? geojsonKey : geojsonKey.slice(slash + 1);
  return base.slice(0, -GEOJSON_SUFFIX.length);
}

/**
 * A store key is a CANONICAL served geojson dataset SSI:
 *   (a) no path segment starts with `_` (excludes `_replaced/`,
 *       `_zone-source-fold-backups/…`);
 *   (b) the basename stem (before `.geojson`) contains neither `__` nor `.`
 *       (excludes `…__flat.<ts>`, `.additive-prebackup`, `.contour-auto-preclip`,
 *       `.<ISO-ts>` infixes).
 *
 * Family-agnostic: admits `qc-lots-*`, `qc-zonage-*`, `qc-zonage-norms-*`,
 * `qc-tod-*`, `qc-zoning-events*`, bare municipal slugs, and `--` homonyms
 * (`saint-cyprien--les-etchemins`). Operates on the RAW KEY (path + basename), so a
 * backup carrying a `.meta.json` with a `datasetId` is still rejected on its path,
 * before any `datasetId` remap.
 */
export function isCanonicalGeojsonKey(key: string): boolean {
  if (!key.endsWith(GEOJSON_SUFFIX)) return false;
  if (key.split("/").some((segment) => segment.startsWith("_"))) return false;
  const stem = stemOf(key);
  return !stem.includes("__") && !stem.includes(".");
}

/**
 * The CANONICAL served dataset ids derived from a store-key listing, via the SAME
 * admission + stem rule the serving index uses — deduped (a flat + nested key of
 * the same collection collapse to one id, sharing a stem) and sorted.
 *
 * This is the version-independent DATA-parity target the sync stamps into
 * `coherence.json` (`served_count` = length, `set_hash` = hash of these ids):
 * computed from the SOURCE data the mirror already lists, NOT from a possibly-stale
 * prod `/collections` — so the preprod gate matches the canonical serving by
 * construction, regardless of the prod image's index freshness (§4 re-spec).
 */
export function canonicalServedIds(keys: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const key of keys) if (isCanonicalGeojsonKey(key)) ids.add(stemOf(key));
  return [...ids].sort();
}
