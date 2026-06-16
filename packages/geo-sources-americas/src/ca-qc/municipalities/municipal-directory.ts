/**
 * QC municipal website directory — slug → official website (MAMH-sourced).
 *
 * Resolves the long-standing Lot D blocker (`recense-platform.ts` TODO): the
 * `slug → URL officielle de la ville` mapping that the platform recensement
 * needs but did not have. Built by joining the **MAMH Répertoire des
 * municipalités du Québec** (`MUN.csv`, field `mweb`) onto the 1106-entry QC
 * registry ({@link QC_MUNICIPALITIES}).
 *
 * ## Provenance (verified live 2026-06-15)
 *   - Dataset : Répertoire des municipalités du Québec (Données Québec).
 *     `repertoire-des-municipalites-du-quebec`, **CC-BY 4.0**.
 *   - Resource: https://donneesouvertes.affmunqc.net/repertoire/MUN.csv
 *     (served UTF-8; columns `mcode`, `munnom`, `mweb`, `mcourriel`).
 *
 * ## Join key — NFD-normalized name (ADR-0017 §join)
 * The QC registry carries **no** populated geographic `code`, so MAMH's `mcode`
 * cannot key the join directly. The directory therefore joins by
 * {@link normalizeName} (byte-identical to the registry↔polygon join), reaching
 * **1100/1106 (99.5%)** of the registry, **1076 (97.3%)** with a website.
 *
 * ## Homonym disambiguation — population
 * 29 registry entries collide on the normalized name (Ville / Canton / Paroisse
 * homonyms, e.g. Stanstead, Bedford, Valcourt). The registry's `population`
 * field is itself MAMH-sourced, so an **exact population match** deterministically
 * picks the right MAMH row. Verified: all ambiguous groups resolve to an exact
 * population match.
 *
 * ## Anti-PII (Loi 25)
 * Institutional public data only (municipal website + general office email).
 * No personal data.
 *
 * Regenerate with `scripts/build-municipal-directory` (re-pull MAMH MUN.csv).
 */

import directoryData from "./municipal-directory.qc.json" with { type: "json" };

/** A single municipal directory entry (slug → website + provenance). */
export interface MunicipalDirectoryEntry {
  /** Registry slug (join key into {@link QC_MUNICIPALITIES}). */
  readonly slug: string;
  /** Registry municipality name (French). */
  readonly name: string;
  /** MAMH geographic code (`mcode`), e.g. "66032". */
  readonly mamhCode: string;
  /** MAMH municipality name (`munnom`); equals {@link name} except for aliases. */
  readonly mamhName: string;
  /** MAMH designation (Ville, Municipalité, Paroisse, Canton…), or `null`. */
  readonly designation: string | null;
  /** Official website (https-normalized), or `null` when MAMH lists none. */
  readonly website: string | null;
  /** General office email from MAMH (`mcourriel`), or `null`. Institutional, not PII. */
  readonly email: string | null;
  /** Source tag — always `"mamh-repertoire"` in this build. */
  readonly source: string;
  /** ISO date the source was verified live. */
  readonly verifiedAt: string;
}

/** Top-level directory document shape (provenance + stats + entries). */
export interface MunicipalDirectory {
  readonly $schema: string;
  readonly generatedAt: string;
  readonly source: {
    readonly name: string;
    readonly dataset: string;
    readonly datasetUrl: string;
    readonly resourceUrl: string;
    readonly license: string;
    readonly field: string;
    readonly joinKey: string;
  };
  readonly stats: {
    readonly registryTotal: number;
    readonly matched: number;
    readonly withWebsite: number;
    readonly unmatched: number;
  };
  readonly entries: Readonly<Record<string, MunicipalDirectoryEntry>>;
}

/** The embedded MAMH municipal directory document. */
export const QC_MUNICIPAL_DIRECTORY: MunicipalDirectory =
  directoryData as MunicipalDirectory;

/** Stable Données Québec dataset slug for the MAMH répertoire. */
export const MAMH_REPERTOIRE_PACKAGE_ID = "repertoire-des-municipalites-du-quebec";

/** Pinned `MUN.csv` resource URL (the directory's backbone). */
export const MAMH_MUN_CSV_URL =
  "https://donneesouvertes.affmunqc.net/repertoire/MUN.csv";

/**
 * Look up a municipality's official website by registry slug.
 *
 * @returns the https website, or `null` when the slug is unknown or MAMH lists
 *   no website for it.
 */
export function websiteForSlug(slug: string): string | null {
  return QC_MUNICIPAL_DIRECTORY.entries[slug]?.website ?? null;
}

/** Look up the full directory entry by registry slug, or `undefined`. */
export function directoryEntry(slug: string): MunicipalDirectoryEntry | undefined {
  return QC_MUNICIPAL_DIRECTORY.entries[slug];
}

/**
 * All `[slug, website]` pairs that have a non-null website — the ready-to-probe
 * input for `recensePlatform` (Lot D). Sorted by slug for stable iteration.
 */
export function directoryWebsites(): readonly (readonly [string, string])[] {
  return Object.values(QC_MUNICIPAL_DIRECTORY.entries)
    .filter((e): e is MunicipalDirectoryEntry & { website: string } => e.website !== null)
    .map((e) => [e.slug, e.website] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
}
