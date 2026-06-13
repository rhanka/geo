/**
 * Administrative hierarchy model — designed to describe resources at every level
 * of the world. Identity follows ISO 3166-1 alpha-2 for countries and ISO 3166-2
 * for subdivisions; below that, official local codes are carried as `code`.
 */

/** ISO 3166-1 alpha-2 country code, uppercase (e.g. "CA"). */
export type CountryCode = string;
/** ISO 3166-2 subdivision code (e.g. "CA-QC"). */
export type SubdivisionCode = string;

/**
 * Semantic administrative level. Ordered from coarsest to finest. `rank` on an
 * {@link AdminUnit} gives the numeric depth when comparing across schemes whose
 * named levels differ (a Québec "mrc" and a French "département" share rank 2).
 */
export const ADMIN_LEVELS = [
  "world",
  "country",
  "region",
  "province",
  "state",
  "territory",
  "department",
  "county",
  "district",
  "mrc",
  "municipality",
  "borough",
  "locality",
] as const;

export type AdminLevel = (typeof ADMIN_LEVELS)[number];

export interface AdminUnit {
  /** Canonical, stable id — see {@link makeGeoId} (e.g. "ca/qc/region/06"). */
  geoId: string;
  /** Primary display name. */
  name: string;
  /** Localized names keyed by BCP-47 language tag (e.g. { fr: "...", en: "..." }). */
  names?: Record<string, string>;
  /** Semantic level. */
  level: AdminLevel;
  /** Numeric depth (0 = country), for cross-scheme ordering. */
  rank?: number;
  /** Official local/administrative code (e.g. région code "06"). */
  code?: string;
  /** ISO 3166-2 code when the unit is an ISO subdivision. */
  iso?: SubdivisionCode;
  /** Country the unit belongs to (ISO 3166-1 alpha-2). */
  country: CountryCode;
  /** geoId of the parent unit, if any. */
  parentGeoId?: string;
  /** id of the SourceManifest the unit originated from. */
  sourceId?: string;
}

const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
const SUBDIVISION_CODE_RE = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;

export function isCountryCode(value: string): boolean {
  return COUNTRY_CODE_RE.test(value);
}

export function isSubdivisionCode(value: string): boolean {
  return SUBDIVISION_CODE_RE.test(value);
}

export function isAdminLevel(value: string): value is AdminLevel {
  return (ADMIN_LEVELS as readonly string[]).includes(value);
}

/** Lowercase, ASCII-slugify a single geoId segment. */
function slugSegment(segment: string): string {
  return segment
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build a canonical geoId from path segments, e.g.
 * `makeGeoId("CA", "QC", "region", "06")` → `"ca/qc/region/06"`.
 */
export function makeGeoId(...parts: Array<string | number>): string {
  return parts
    .map((part) => slugSegment(String(part)))
    .filter((part) => part.length > 0)
    .join("/");
}

/** Split a geoId back into its segments. */
export function parseGeoId(geoId: string): string[] {
  return geoId.split("/").filter((segment) => segment.length > 0);
}
