/**
 * Minimal local domain types — the ONLY surface this package consumed from the
 * immo monorepo's `@radar/domain` package. Copied here (not re-exported from a
 * shared dependency) so `@geo/qc-sources` is self-contained and free of any
 * immo-domain coupling.
 *
 * Provenance: immo `@radar/domain`
 *   - `SourceKind` / `SOURCE_KINDS` / `isSourceKind`  ← src/source-kind.ts
 *   - `Municipality` / `MunicipalityT`                ← src/schemas/municipality.ts
 *   - `PrioritizedCitiesOptions(T)`                   ← src/schemas/municipality.ts
 *
 * NOTE: this `SourceKind` is the immo INGESTION-source taxonomy. It is distinct
 * from geo-core's `SourceKind` ("administrative" | "statistical" | "postal"),
 * which describes geospatial dataset families — a different concept — so the two
 * MUST NOT be merged. Only the values actually used by this package's adapters
 * are load-bearing; the full list is kept verbatim for fidelity.
 */

import { z } from "zod";

/** Catalogue of data sources the QC ingestion pipeline can collect. */
export const SOURCE_KINDS = [
  "avis-publics",
  "pv",
  "video-youtube",
  "reglement",
  "zonage",
  "plan-zonage",
  "cadastre",
  "cadastre-allege",
  "arcgis-zonage",
  "ckan-zonage",
  "role-evaluation",
  "registre-foncier",
  "cptaq",
  "zones-inondables",
  "hydrographie",
  "adresses-quebec",
  "permis-construction",
  "donnees-quebec",
  "transactions",
  "statcan",
  "transport",
  "schema-mrc",
  "orthophotos",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export function isSourceKind(value: string): value is SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * Canonical municipality reference for Québec.
 *
 * Data sources (coordinate authority):
 *   - GeoNames.org Canada dump (CC BY 4.0): http://download.geonames.org/export/dump/CA.zip
 *     Feature class A, feature code ADM3, admin1=10 (Québec).
 *     Joined to MAMH Répertoire des municipalités by admin3Code ↔ mcode
 *     for population and MRC data.
 *   - MAMH Répertoire (CC BY 4.0): https://donneesouvertes.affmunqc.net/repertoire/MUN.csv
 *     Fields used: munnom, mrc, mpopul.
 *
 * Montréal (45.5019, -73.5674) is the reference point for distance ranking.
 * Montréal and Laval are excluded from active scraping scope (excluded: true).
 * Municipalities with population > 100 000 are deprioritized (deprioritized: true)
 * but remain in the dataset for reference.
 */
export const Municipality = z.object({
  /** URL-safe identifier (kebab-case, lowercase, NFC-stripped). Unique across all QC. */
  slug: z.string().min(1),

  /** Official municipality name in French (MAMH / GeoNames). */
  name: z.string().min(1),

  /** MRC (Municipalité régionale de comté) name, null for agglomeration cities. */
  mrc: z.string().min(1).nullable(),

  /** Latitude WGS-84 (GeoNames centroid). */
  lat: z.number().min(44).max(63),

  /** Longitude WGS-84 (GeoNames centroid). */
  lon: z.number().min(-80).max(-57),

  /** Population from MAMH Répertoire (most recent available). Null when not published. */
  population: z.number().int().positive().nullable(),

  /** Great-circle distance from Montréal centre (45.5019, -73.5674) in km. */
  distanceToMtlKm: z.number().nonnegative(),

  /**
   * Ascending priority rank (1 = closest to Montréal).
   * Null for excluded municipalities (Montréal, Laval).
   * Deprioritized municipalities (pop > 100 000) still receive a rank.
   */
  priorityRank: z.number().int().positive().nullable(),

  /**
   * When true, municipality is excluded from the scraping scope entirely
   * (Montréal, Laval). Still present in the dataset for reference.
   */
  excluded: z.boolean(),

  /** Reason for exclusion. Null when excluded is false. */
  excludedReason: z
    .enum(["pilot-city-montreal", "pilot-city-laval"])
    .nullable(),

  /**
   * When true, municipality is retained in the dataset but deprioritized
   * for active scraping because population > 100 000. The CiblagePlan
   * helper respects this unless overridden by `includeLargePop`.
   */
  deprioritized: z.boolean(),
});

export type MunicipalityT = z.infer<typeof Municipality>;

/** Options for the prioritizedCities() helper. */
export const PrioritizedCitiesOptions = z.object({
  /**
   * Maximum distance from Montréal in km. Omit to include all QC municipalities.
   */
  maxKm: z.number().positive().optional(),

  /**
   * When true, include deprioritized municipalities (pop > 100 000) in results.
   * Default: false (deprioritized cities are excluded from active scraping scope).
   */
  includeLargePop: z.boolean().default(false),
});

export type PrioritizedCitiesOptionsT = z.infer<typeof PrioritizedCitiesOptions>;
