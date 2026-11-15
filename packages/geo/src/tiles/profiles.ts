/**
 * Tile layer profiles (SPEC_VECTOR_TILES.md § Properties): which source
 * properties a tile layer keeps, under which output name, from which zoom, and
 * how the MVT feature id is derived.
 *
 * A profile is a WHITELIST. Every other source property is dropped from the
 * tiles (the exact feature stays available through `/items`). A whitelisted
 * property that the source does not carry is simply absent from the tile
 * (`missing source`): nothing is invented, no default is filled in. MVT has no
 * null, so a null source value is absent too.
 *
 * Property tiers (T1): below {@link LayerProfile.fullFromZoom} a tile carries
 * only {@link LayerProfile.lowZoomProperties} (lots: `zoneCode`; zones:
 * `code`) besides the feature id; the full whitelist from that zoom on.
 */

export type TileValue = string | number | boolean;

export interface PropertyRule {
  /** Output name in the tile. */
  out: string;
  /** Source property names tried in order; the first non-null one wins. */
  from: readonly string[];
  /** Emit as a string (a numeric source value is converted, e.g. `noLot`). */
  asString?: boolean;
}

/** How the MVT feature id of a layer is derived (see {@link FeatureIdAssigner}). */
export type FeatureIdRule = "noLot" | "ordinal";

export interface LayerProfile {
  /** MVT layer name. */
  layer: string;
  /** Collection id prefix this profile applies to (`qc-lots-`, `qc-zonage-`). */
  collectionPrefix: string;
  properties: readonly PropertyRule[];
  /** Emit `citySlug` derived from the collection id (not a source property). */
  citySlug: boolean;
  /** Output properties kept below {@link fullFromZoom}. */
  lowZoomProperties: readonly string[];
  /** First zoom carrying the full whitelist. */
  fullFromZoom: number;
  featureId: FeatureIdRule;
}

/** Source properties holding the cadastre lot number, first non-null wins. */
export const NO_LOT_SOURCES = ["noLot", "NO_LOT", "lot_id"] as const;

/**
 * Lots. Whitelist: `noLot` (string, z14+), `zoneCode`, `tod` (z14+),
 * `citySlug` (z14+). Feature id: the lot number (see {@link FeatureIdAssigner}).
 *
 * Not in the tiles (T1 decision): `priorite`, `multifamilial4plus`,
 * `potentialScore` (computed by immo, which joins them client-side by
 * `noLot`), and `fid` (the MVT feature id carries the identity).
 * `tod`: source `in_tod` (present, null on 100% of the two T0 cities).
 */
export const LOTS_PROFILE: LayerProfile = {
  layer: "lots",
  collectionPrefix: "qc-lots-",
  citySlug: true,
  properties: [
    { out: "noLot", from: NO_LOT_SOURCES, asString: true },
    { out: "zoneCode", from: ["zone_code", "code_zone", "zoneCode"] },
    { out: "tod", from: ["in_tod", "tod"] },
  ],
  lowZoomProperties: ["zoneCode"],
  fullFromZoom: 14,
  featureId: "noLot",
};

/**
 * Zones. Whitelist: `code` (alias zone → code: a source `zone` feeds `code`
 * when `zone_code` / `code` are absent; no `zone` output), `kind`,
 * `affectation`, `reglementMillesime`, `citySlug`. Feature id: the source
 * ordinal (zones have no numeric key); `fid` is not in the tiles.
 */
export const ZONES_PROFILE: LayerProfile = {
  layer: "zones",
  collectionPrefix: "qc-zonage-",
  citySlug: true,
  properties: [
    { out: "code", from: ["zone_code", "code", "zone"] },
    { out: "kind", from: ["kind"] },
    { out: "affectation", from: ["affectation"] },
    { out: "reglementMillesime", from: ["reglement_millesime", "reglementMillesime"] },
  ],
  lowZoomProperties: ["code"],
  fullFromZoom: 14,
  featureId: "ordinal",
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

/** Apply a profile to one source feature's properties (full whitelist). */
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
        out[rule.out] = rule.asString ? String(v) : v;
        break;
      }
    }
  }
  if (profile.citySlug && citySlug !== undefined) out.citySlug = citySlug;
  return out;
}

/** The properties a tile of zoom `z` carries (tiers, see the module comment). */
export function tierProperties(full: Record<string, TileValue>, profile: LayerProfile, z: number): Record<string, TileValue> {
  if (z >= profile.fullFromZoom) return full;
  const out: Record<string, TileValue> = {};
  for (const k of profile.lowZoomProperties) {
    const v = full[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Feature ids that are not lot numbers start here (2^52). Québec lot numbers
 * (7 digits, e.g. `5 530 108`) are far below, so a fallback id never collides
 * with a lot-number id, and every id stays a safe integer (MVT ids are uint64,
 * MapLibre reads them as JS numbers).
 */
export const FALLBACK_ID_BASE = 2 ** 52;

/** `"5 530 108"` → 5530108; undefined when not a plain decimal lot number below {@link FALLBACK_ID_BASE}. */
export function lotNumberId(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 && value < FALLBACK_ID_BASE ? value : undefined;
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/\s+/g, "");
  if (!/^\d{1,16}$/.test(digits)) return undefined;
  const n = Number(digits);
  return n < FALLBACK_ID_BASE ? n : undefined;
}

export interface FeatureIdStats {
  rule: FeatureIdRule;
  /** Ids derived from the lot number. */
  fromNoLot: number;
  /** Fallback ids (`FALLBACK_ID_BASE + ordinal`) by cause. */
  missingNoLot: number;
  nonNumericNoLot: number;
  duplicateNoLot: number;
}

/**
 * Deterministic MVT feature ids for one source version.
 *
 * - `noLot` (lots): the lot number without spaces, as an integer. A feature
 *   whose lot number is missing, not a plain number, or already used by an
 *   EARLIER feature (source order) gets `FALLBACK_ID_BASE + ordinal`; the
 *   causes are counted.
 * - `ordinal` (zones): the feature's ordinal in the source collection (stable
 *   for one source version only).
 */
export class FeatureIdAssigner {
  readonly #rule: FeatureIdRule;
  readonly #used = new Set<number>();
  readonly stats: FeatureIdStats;

  constructor(rule: FeatureIdRule) {
    this.#rule = rule;
    this.stats = { rule, fromNoLot: 0, missingNoLot: 0, nonNumericNoLot: 0, duplicateNoLot: 0 };
  }

  /** Id of the feature at `ordinal` (source order) with source `properties`. */
  assign(ordinal: number, properties: Record<string, unknown> | null | undefined): number {
    if (this.#rule === "ordinal") return ordinal;
    let raw: unknown;
    for (const key of NO_LOT_SOURCES) {
      const v = properties?.[key];
      if (v !== null && v !== undefined) {
        raw = v;
        break;
      }
    }
    if (raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
      this.stats.missingNoLot++;
      return FALLBACK_ID_BASE + ordinal;
    }
    const id = lotNumberId(raw);
    if (id === undefined) {
      this.stats.nonNumericNoLot++;
      return FALLBACK_ID_BASE + ordinal;
    }
    if (this.#used.has(id)) {
      this.stats.duplicateNoLot++;
      return FALLBACK_ID_BASE + ordinal;
    }
    this.#used.add(id);
    this.stats.fromNoLot++;
    return id;
  }
}
