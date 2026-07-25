/**
 * Source manifest for the INSEE **Code Officiel Géographique (COG)** — the
 * French *statistical* referential of communes (and their codes), as opposed to
 * IGN ADMIN EXPRESS (the *administrative* boundary geometry).
 *
 * ── Source (verified 2026-06-13) ──────────────────────────────────────────
 * INSEE publishes the COG yearly. The current vintage is « Code officiel
 * géographique au 1er janvier 2025 » (page id 8377162). The commune-level file
 * is a flat, comma-separated, UTF-8 CSV with quoted fields:
 *
 *   https://www.insee.fr/fr/statistiques/fichier/8377162/v_commune_2025.csv
 *   (HTTP 200, ~3.5 MB, 37 548 rows, RFC-4180 quoted, delimiter ",")
 *
 * Header (pinned, in order):
 *
 *   TYPECOM    type de commune: COM | ARM | COMA | COMD
 *   COM        code commune (5 chars, e.g. "01001", "97101")
 *   REG        code région (2 chars; empty for non-COM rows)
 *   DEP        code département (2–3 chars, e.g. "01", "971"; empty for non-COM)
 *   CTCD       code de la collectivité territoriale (4 chars)
 *   ARR        code arrondissement (4 chars)
 *   TNCC       type de nom en clair (1 char)
 *   NCC        nom en clair (majuscules)
 *   NCCENR     nom en clair (typographie riche)
 *   LIBELLE    nom en clair (typographie riche + article) ← display name
 *   CAN        code canton (5 chars)
 *   COMPARENT  code de la commune parente (arrondissements municipaux,
 *              communes associées/déléguées)
 *
 * TYPECOM distribution in v_commune_2025: COM 34875, COMD 2152, COMA 476,
 * ARM 45. We keep only `TYPECOM === "COM"` (the 34 875 actual communes); for
 * those rows REG/DEP are always populated.
 *
 * License: Licence Ouverte / Open Licence 2.0 (Etalab). INSEE diffuses its data
 * under the Licence Ouverte; the COG dataset on data.gouv.fr is tagged
 * "Licence Ouverte / Open Licence" as well.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { SourceManifest } from "@sentropic/geo-core";

/** Globally unique source id for the INSEE COG statistical referential. */
export const SOURCE_ID = "fr/insee-cog";

/**
 * Commune-level COG CSV for the 1 January 2025 vintage, published by INSEE under
 * the Licence Ouverte. Comma-separated, UTF-8, RFC-4180 quoted fields.
 */
export const COG_COMMUNES_URL =
  "https://www.insee.fr/fr/statistiques/fichier/8377162/v_commune_2025.csv";

/** Dataset id — prefixed `fr-cog-` for a globally unique OGC collection id (ADR-0005). */
export const DATASET_COMMUNES = "fr-cog-communes";

/**
 * The INSEE COG source manifest. One CSV dataset (`fr-cog-communes`), parsed by
 * `@sentropic/geo-acquire` into a null-geometry referential FeatureCollection
 * via the package's {@link communesNormalizer}.
 */
export const manifest: SourceManifest = {
  id: SOURCE_ID,
  title: "Code Officiel Géographique (COG) — communes",
  description:
    "Référentiel statistique des communes françaises (codes INSEE) issu du " +
    "Code Officiel Géographique de l'INSEE, millésime au 1er janvier 2025.",
  kind: "statistical",
  jurisdiction: { country: "FR" },
  provider: {
    name: "Institut national de la statistique et des études économiques (INSEE)",
    url: "https://www.insee.fr",
  },
  license: "licence-ouverte-2.0",
  homepage: "https://www.insee.fr/fr/information/8377162",
  datasets: [
    {
      id: DATASET_COMMUNES,
      title: "Communes (Code Officiel Géographique)",
      description:
        "Liste des communes françaises au 1er janvier 2025 avec leurs codes " +
        "INSEE, codes département et région. Géométrie nulle (référentiel " +
        "attributaire).",
      format: "csv",
      url: COG_COMMUNES_URL,
      query: { delimiter: "," },
      updateCadence: "P1Y",
    },
  ],
};
