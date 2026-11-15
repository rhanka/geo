/**
 * Tile layer profiles (SPEC_VECTOR_TILES.md § Properties): which source
 * properties a tile layer keeps, under which output name.
 *
 * A profile is a WHITELIST. Every other source property is dropped from the
 * tiles (the exact feature stays available through `/items`). A whitelisted
 * property that the source does not carry is simply absent from the tile
 * (`missing source`): nothing is invented, no default is filled in. MVT has no
 * null, so a null source value is absent too.
 */

export type TileValue = string | number | boolean;

export interface PropertyRule {
  /** Output name in the tile. */
  out: string;
  /** Source property names tried in order; the first non-null one wins. */
  from: readonly string[];
}

export interface LayerProfile {
  /** MVT layer name. */
  layer: string;
  /** Collection id prefix this profile applies to (`qc-lots-`, `qc-zonage-`). */
  collectionPrefix: string;
  properties: readonly PropertyRule[];
  /** Emit `citySlug` derived from the collection id (not a source property). */
  citySlug: boolean;
}

/**
 * Lots. Requested by immo: fid, noLot, zoneCode, citySlug, priorite,
 * multifamilial4plus, tod, potentialScore.
 *
 * - `fid`: no source feature id or `fid` property exists in `qc-lots-*`
 *   (measured on rawdon and saint-eustache); the MVT feature id is the source
 *   ordinal instead (see `TileFeatureId` in build.ts).
 * - `priorite`, `multifamilial4plus`, `potentialScore`: `missing source` (no
 *   such property, under any spelling, in the served lots). Rules are kept so
 *   that a later source that carries them is picked up without a code change.
 * - `tod`: source `in_tod` (present, null on 100% of the two T0 cities).
 */
export const LOTS_PROFILE: LayerProfile = {
  layer: "lots",
  collectionPrefix: "qc-lots-",
  citySlug: true,
  properties: [
    { out: "fid", from: ["fid"] },
    { out: "noLot", from: ["noLot", "NO_LOT", "lot_id"] },
    { out: "zoneCode", from: ["zone_code", "code_zone", "zoneCode"] },
    { out: "priorite", from: ["priorite"] },
    { out: "multifamilial4plus", from: ["multifamilial4plus"] },
    { out: "tod", from: ["in_tod", "tod"] },
    { out: "potentialScore", from: ["potentialScore", "potential_score"] },
  ],
};

/**
 * Zones. Requested by immo: fid, code, kind, affectation, reglementMillesime,
 * citySlug, with the alias zone → code (a source property `zone` feeds `code`
 * when `zone_code` / `code` are absent).
 */
export const ZONES_PROFILE: LayerProfile = {
  layer: "zones",
  collectionPrefix: "qc-zonage-",
  citySlug: true,
  properties: [
    { out: "fid", from: ["fid"] },
    { out: "code", from: ["zone_code", "code", "zone"] },
    { out: "kind", from: ["kind"] },
    { out: "affectation", from: ["affectation"] },
    { out: "reglementMillesime", from: ["reglement_millesime", "reglementMillesime"] },
  ],
};

export const LAYER_PROFILES: readonly LayerProfile[] = [LOTS_PROFILE, ZONES_PROFILE];

/** Profile of a served collection id, or undefined (norms, events, … are not tiled). */
export function profileForCollection(collection: string): LayerProfile | undefined {
  if (collection.startsWith("qc-zonage-norms-")) return undefined;
  return LAYER_PROFILES.find((p) => collection.startsWith(p.collectionPrefix) && collection.length > p.collectionPrefix.length);
}

/** `qc-lots-saint-eustache` → `saint-eustache` (derived from the id, not read from the source). */
export function citySlugFromCollection(collection: string, profile: LayerProfile): string | undefined {
  return collection.startsWith(profile.collectionPrefix) ? collection.slice(profile.collectionPrefix.length) || undefined : undefined;
}

function tileValue(v: unknown): TileValue | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  return undefined; // null, undefined, arrays and objects are not tile values
}

/** Apply a profile to one source feature's properties. */
export function pickProperties(
  source: Record<string, unknown> | null | undefined,
  profile: LayerProfile,
  citySlug: string | undefined,
): Record<string, TileValue> {
  const out: Record<string, TileValue> = {};
  const props = source ?? {};
  for (const rule of profile.properties) {
    for (const key of rule.from) {
      const v = tileValue(props[key]);
      if (v !== undefined) {
        out[rule.out] = v;
        break;
      }
    }
  }
  if (profile.citySlug && citySlug !== undefined) out.citySlug = citySlug;
  return out;
}
