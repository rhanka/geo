/**
 * QC municipality registry — typed accessors + light runtime validation.
 *
 * Reproduces radar-immobilier's `packages/radar-sources/src/geo/municipalities.ts`
 * accessors over the 1106-entry registry, keeping only GEOGRAPHIC identity fields
 * (ADR-0013 / separation.md). The immo-only business fields `priorityRank`,
 * `excluded`, `excludedReason`, `deprioritized` are intentionally absent — immo
 * re-adds them downstream via its own extension.
 *
 * No Zod: a dependency-free runtime validator ({@link isMunicipality} /
 * {@link validateMunicipalities}) guards the embedded data.
 *
 * Anti-PII (Loi 25): public municipal identity only — no personal data.
 */

import { QC_MUNICIPALITIES_DATA } from "./municipalities.data.js";

/**
 * Canonical Québec municipality (geographic identity only).
 *
 * The registry carries no official geographic code (MUS_CO_GEO) natively — that
 * code lives in the SDA / StatCan CSD polygon layers and is attached to a
 * municipality through the registry↔polygon join (by NFD-normalized name; see
 * the `statcan-csd` normalizer). {@link byCode} therefore indexes the optional
 * `code` only when one has been attached.
 */
export interface Municipality {
  /** URL-safe identifier (kebab-case, lowercase, NFC-stripped). Unique across QC. */
  slug: string;
  /** Official municipality name in French (MAMH / GeoNames). */
  name: string;
  /** MRC (Municipalité régionale de comté) name; `null` for agglomeration cities. */
  mrc: string | null;
  /** Latitude WGS-84 (GeoNames centroid). */
  lat: number;
  /** Longitude WGS-84 (GeoNames centroid). */
  lon: number;
  /** Population from MAMH Répertoire (most recent). `null` when not published. */
  population: number | null;
  /** Great-circle distance from Montréal centre (45.5019, -73.5674), in km. */
  distanceToMtlKm: number;
  /**
   * Official geographic code (MUS_CO_GEO / StatCan CSDUID) when joined from a
   * polygon source. Absent on the bare registry — not part of the source data.
   */
  code?: string;
}

/**
 * Normalize a municipality name for join/lookup comparison:
 *   - NFD decompose → strip combining marks (drop accents),
 *   - remove apostrophes (L'Île → lile),
 *   - lowercase,
 *   - collapse non-alphanumeric runs to single hyphens, trim hyphens.
 *
 * Identical to immo's `normalizeName` (fetch-municipal-polygons.ts), so the
 * registry↔polygon join keys match byte-for-byte.
 */
export function normalizeName(name: string): string {
  const nfd = name.normalize("NFD");
  const noAccents = [...nfd].filter((c) => !/\p{M}/u.test(c)).join("");
  const noApostrophe = noAccents.replace(/['’]/g, "");
  const lower = noApostrophe.toLowerCase();
  return lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const NUMBER_FIELDS = ["lat", "lon", "distanceToMtlKm"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Light runtime type guard for a single {@link Municipality} (no Zod). */
export function isMunicipality(value: unknown): value is Municipality {
  if (!isRecord(value)) return false;
  if (typeof value["slug"] !== "string" || value["slug"].length === 0) return false;
  if (typeof value["name"] !== "string" || value["name"].length === 0) return false;
  const mrc = value["mrc"];
  if (mrc !== null && (typeof mrc !== "string" || mrc.length === 0)) return false;
  for (const field of NUMBER_FIELDS) {
    const n = value[field];
    if (typeof n !== "number" || !Number.isFinite(n)) return false;
  }
  const population = value["population"];
  if (
    population !== null &&
    (typeof population !== "number" || !Number.isInteger(population) || population <= 0)
  ) {
    return false;
  }
  const code = value["code"];
  if (code !== undefined && (typeof code !== "string" || code.length === 0)) return false;
  return true;
}

/**
 * Validate an array of raw entries as {@link Municipality}[]. Returns the typed
 * array on success or a list of human-readable errors (does not throw).
 */
export function validateMunicipalities(
  input: unknown,
):
  | { ok: true; value: readonly Municipality[] }
  | { ok: false; errors: string[] } {
  if (!Array.isArray(input)) {
    return { ok: false, errors: ["registry must be an array"] };
  }
  const errors: string[] = [];
  const seenSlugs = new Set<string>();
  input.forEach((entry, index) => {
    if (!isMunicipality(entry)) {
      errors.push(`municipalities[${index}]: invalid Municipality`);
      return;
    }
    if (seenSlugs.has(entry.slug)) {
      errors.push(`municipalities[${index}]: duplicate slug "${entry.slug}"`);
    }
    seenSlugs.add(entry.slug);
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as readonly Municipality[] };
}

/** The 1106-entry QC municipality registry (geographic fields only). */
export const QC_MUNICIPALITIES: readonly Municipality[] = QC_MUNICIPALITIES_DATA;

// ── indices ────────────────────────────────────────────────────────────────

const bySlugIndex = new Map<string, Municipality>();
const byNormNameIndex = new Map<string, Municipality[]>();
const byCodeIndex = new Map<string, Municipality>();

for (const muni of QC_MUNICIPALITIES) {
  bySlugIndex.set(muni.slug, muni);

  const key = normalizeName(muni.name);
  const list = byNormNameIndex.get(key);
  if (list) list.push(muni);
  else byNormNameIndex.set(key, [muni]);

  if (muni.code !== undefined) byCodeIndex.set(muni.code, muni);
}

/** Look up a municipality by its unique slug. */
export function bySlug(slug: string): Municipality | undefined {
  return bySlugIndex.get(slug);
}

/**
 * Look up municipalities by name, NFD-normalized (accent/apostrophe/​case
 * insensitive). Returns every registry entry whose normalized name matches —
 * names are not unique across QC (e.g. several "Saint-Louis"), so an array.
 */
export function byName(name: string): readonly Municipality[] {
  return byNormNameIndex.get(normalizeName(name)) ?? [];
}

/**
 * Look up a municipality by official geographic code (MUS_CO_GEO / CSDUID).
 * Only resolves entries that carry a `code` (attached via the polygon join);
 * the bare registry has none, so this returns `undefined` until a code is set.
 */
export function byCode(code: string): Municipality | undefined {
  return byCodeIndex.get(code);
}
