/**
 * Source manifest for La Poste « Base officielle des codes postaux » — the
 * French postal referential mapping each postal code to its INSEE commune,
 * published on data.gouv.fr by La Poste under Licence Ouverte 2.0.
 *
 * ── CSV acquisition (verified 2026-06-13) ─────────────────────────────────
 * data.gouv.fr dataset `base-officielle-des-codes-postaux` (organization
 * "La Poste", license `lov2` → Licence Ouverte / Open Licence 2.0). The stable
 * CSV resource is served by La Poste's Datanova data-fair instance:
 *
 *   https://datanova.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/raw
 *     content-type: text/csv (download filename "019HexaSmal.csv"), ~1.5 MB,
 *     39 192 data rows, **`;`-delimited**.
 *
 * Header (note the leading `#` on the first column, and that the file is
 * **ISO-8859-1 / Latin-1** encoded despite the HTTP charset claim):
 *
 *   #Code_commune_INSEE;Nom_de_la_commune;Code_postal;Libellé_d_acheminement;Ligne_5
 *
 * Columns:
 *   Code_commune_INSEE     INSEE commune code (5 char) e.g. "01001", "75056"
 *   Nom_de_la_commune      commune name (upper-case)   e.g. "PARIS"
 *   Code_postal            postal code (5 digits)      e.g. "01400", "75001"
 *   Libellé_d_acheminement routing label (CEDEX/locality, upper-case)
 *   Ligne_5                optional 5th address line (hamlet / former commune),
 *                          usually empty
 *
 * A postal code maps to many communes and a commune may carry several postal
 * codes, so a row is a (postal code × commune) pair — the natural grain for the
 * referential. License: **Licence Ouverte / Open Licence 2.0 (Etalab)** — open
 * and redistributable, attribution required (© La Poste).
 *
 * NOTE — the file is Latin-1 encoded, but `@sentropic/geo-acquire`'s `download`
 * decodes bytes as UTF-8 (`result.text()`), which would corrupt accented commune
 * names (e.g. "Libellé"). The manifest still declares `format:"csv"` with the
 * real upstream URL and `query.delimiter:";"` as the single source of truth, and
 * the exported `csvNormalizer` works on any decoded rows; the package's
 * `scripts/produce.ts` mirrors the acquire pipeline but decodes Latin-1 before
 * parsing so the normalized data is correct.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { SourceManifest } from "@sentropic/geo-core";

/**
 * Stable CSV resource (La Poste Datanova data-fair `raw` endpoint), `;`-delimited
 * Latin-1, ~1.5 MB. The single source of truth for provenance.
 */
export const CODES_POSTAUX_CSV_URL =
  "https://datanova.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/raw";

/** data.gouv.fr dataset landing/catalog page (provenance). */
export const CODES_POSTAUX_HOMEPAGE =
  "https://www.data.gouv.fr/datasets/base-officielle-des-codes-postaux";

/** Globally unique source id for the French postal referential. */
export const SOURCE_ID = "fr/laposte-codes-postaux";

/** Dataset id — prefixed with `fr-` so it is a globally unique OGC collection id. */
export const DATASET_CODES_POSTAUX = "fr-codes-postaux";

/**
 * CSV column names as they appear in the parsed header. The first column carries
 * a leading `#` in the upstream file (`#Code_commune_INSEE`); the normalizer
 * reads either spelling so it is robust to the `#` being stripped or kept.
 */
export const CP_COLUMNS = {
  inseeCode: "Code_commune_INSEE",
  inseeCodeHash: "#Code_commune_INSEE",
  communeName: "Nom_de_la_commune",
  postalCode: "Code_postal",
  libelle: "Libellé_d_acheminement",
  ligne5: "Ligne_5",
} as const;

/**
 * The French postal referential source manifest. A single CSV dataset
 * (`fr-codes-postaux`) mapping postal codes to INSEE communes, under Licence
 * Ouverte 2.0. `query.delimiter` is `;` (the file is semicolon-separated).
 */
export const manifest: SourceManifest = {
  id: SOURCE_ID,
  title: "Base officielle des codes postaux (France)",
  description:
    "Référentiel postal français : correspondance entre code postal et commune " +
    "INSEE (libellé d'acheminement, ligne 5), publié par La Poste sur " +
    "data.gouv.fr.",
  kind: "postal",
  jurisdiction: { country: "FR" },
  provider: {
    name: "La Poste",
    url: "https://datanova.laposte.fr",
  },
  license: "licence-ouverte-2.0",
  homepage: CODES_POSTAUX_HOMEPAGE,
  datasets: [
    {
      id: DATASET_CODES_POSTAUX,
      title: "Codes postaux ↔ communes INSEE (France)",
      description:
        "Chaque ligne associe un code postal à une commune INSEE " +
        "(libellé d'acheminement, ligne 5 facultative).",
      format: "csv",
      url: CODES_POSTAUX_CSV_URL,
      query: { delimiter: ";" },
      updateCadence: "P1M",
    },
  ],
};
