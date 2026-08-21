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
 * The SERVED collection id for a canonical dataset — the SINGLE source of truth
 * used by BOTH the serving index and the sync parity stamp (§4). Equals the
 * dataset's `datasetId` when its `.meta.json` carries one, else the key stem.
 *
 * This distinction is LOAD-BEARING and version-independent: e.g.
 * `normalized/abercorn.geojson` (zonage → id `abercorn`) and
 * `normalized/qc-cadastre-lots/abercorn.geojson` (lots, `datasetId=qc-lots-abercorn`)
 * SHARE the stem `abercorn` but are DISTINCT served collections. A stem-only id
 * would MERGE them (data loss + broken immo refs); `datasetId ?? stem` keeps them
 * separate — the ground truth immo consumes.
 */
export function servedCollectionId(stem: string, datasetId: string | undefined): string {
  return datasetId ?? stem;
}

/**
 * The SERVED collection id SET derived from canonical `{key, datasetId?}` entries,
 * via {@link servedCollectionId} — deduped + sorted. The ONE derivation shared by
 * the serving index (`store-provider`) and the sync stamp (runner reads the source
 * `.meta.json` of each canonical key) so `stamp-set == served-set` BY CONSTRUCTION,
 * regardless of the prod image's index freshness (§4 re-spec, meta-exact).
 */
export function servedDatasetIds(
  entries: readonly { key: string; datasetId?: string | undefined }[],
): string[] {
  const ids = new Set<string>();
  for (const e of entries) {
    if (!isCanonicalGeojsonKey(e.key)) continue;
    ids.add(servedCollectionId(stemOf(e.key), e.datasetId));
  }
  return [...ids].sort();
}
