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
  const slash = key.lastIndexOf("/");
  const base = slash === -1 ? key : key.slice(slash + 1);
  const stem = base.slice(0, -GEOJSON_SUFFIX.length);
  return !stem.includes("__") && !stem.includes(".");
}
