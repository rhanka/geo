/**
 * served-ids-mapping.ts — the PURE seam of the bascule SERVED leg: turn a
 * `normalized/` served collection (its S3 key + its parsed features) into the
 * `ServedZoneRef` / `ServedLotRef` refs that {@link buildServedCanonicalIds}
 * canonicalizes into `ogc:zones|lots:<slug>:<canon>` tokens.
 *
 * It is isolated from the S3 runner so it is testable without any network: the
 * runner lists + fetches + parses, this module decides `citySlug` (from the key)
 * and reads the join columns (`zone_code` for zones; `NO_LOT` / `no_lot` for
 * lots). No canonicalization / dedup / sort happens here — that stays the single
 * source in {@link buildServedCanonicalIds}; empty/absent columns simply flow
 * through as blank refs and are dropped there (fail-closed by absence).
 */
import { stemOf } from "../storage/canonical-key.js";
import type { ServedLotRef, ServedZoneRef } from "./served-canonical-ids.js";

export type ServedCollectionKind = "zones" | "lots";

/** The minimum a GeoJSON feature must expose for ref extraction. */
export interface MinimalFeature {
  readonly properties?: Record<string, unknown> | null;
}

/**
 * The served-family prefixes stripped from a `normalized/` key stem to recover the
 * bare municipal slug used in immo's canonical_id space. immo tokens already carry
 * the family (`ogc:zones` / `ogc:lots`), so the slug must NOT keep `qc-zonage-` /
 * `qc-lots-`: `qc-zonage-westmount` and the bare `westmount` grid, `qc-lots-laval`
 * and the cadastre `laval`, all fold to the same `westmount` / `laval` the join
 * is keyed on. Longest prefix first so `qc-zonage-norms-` wins over `qc-zonage-`.
 */
const SERVED_FAMILY_PREFIXES = ["qc-zonage-norms-", "qc-zonage-", "qc-lots-"] as const;

/**
 * The bare municipal slug of a canonical `normalized/` served key — the `<slug>`
 * of `ogc:<family>:<slug>:<canon>`. Handles flat (`…/qc-zonage-westmount.geojson`),
 * nested (`…/qc-zonage-westmount/qc-zonage-westmount.geojson`), enriched-lots
 * (`normalized/qc-lots/qc-lots-laval.geojson`) and cadastre-lots
 * (`normalized/qc-cadastre-lots/laval.geojson`) layouts identically.
 */
export function municipalSlugFromNormalizedKey(key: string): string {
  const stem = stemOf(key);
  for (const prefix of SERVED_FAMILY_PREFIXES) {
    if (stem.startsWith(prefix)) return stem.slice(prefix.length);
  }
  return stem;
}

export interface CollectionServedRefs {
  readonly zones: ServedZoneRef[];
  readonly lots: ServedLotRef[];
}

/**
 * Map one served collection's features to canonical-id refs. `citySlug` comes from
 * the key (single municipality per collection); the join column is `zone_code`
 * (zones) or `NO_LOT ?? no_lot` (lots). Absent columns become blank refs, which
 * {@link buildServedCanonicalIds} skips — never invented.
 */
export function collectionFeaturesToRefs(
  key: string,
  kind: ServedCollectionKind,
  features: Iterable<MinimalFeature>,
): CollectionServedRefs {
  const citySlug = municipalSlugFromNormalizedKey(key);
  const zones: ServedZoneRef[] = [];
  const lots: ServedLotRef[] = [];
  for (const feature of features) {
    const props = feature.properties ?? {};
    if (kind === "zones") {
      zones.push({ citySlug, zoneCode: props["zone_code"] });
    } else {
      lots.push({ citySlug, noLot: props["NO_LOT"] ?? props["no_lot"] });
    }
  }
  return { zones, lots };
}
