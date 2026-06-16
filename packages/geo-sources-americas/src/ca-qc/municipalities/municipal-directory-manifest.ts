/**
 * Source manifest for the **MAMH Répertoire des municipalités du Québec** —
 * the open dataset backing the QC municipal website directory (slug → site web).
 *
 * Acquisition is a plain CSV pull of `MUN.csv` (UTF-8), confirmed live
 * 2026-06-15 via `package_show` on Données Québec (`license_id: cc-by`). The
 * directory build joins `mweb` onto {@link QC_MUNICIPALITIES} by NFD-normalized
 * name — see `municipal-directory.ts`.
 *
 * No bespoke recipe: the CSV is consumed by the directory builder, not by the
 * generic geometry acquisition path, so this manifest carries *no* `recipe`
 * (declarative, ADR-0017). It exists to register provenance + license + refresh
 * cadence for the directory's source.
 */

import type { SourceManifest } from "@sentropic/geo-core";

import {
  MAMH_MUN_CSV_URL,
  MAMH_REPERTOIRE_PACKAGE_ID,
} from "./municipal-directory.js";

/** Globally unique source id for the MAMH municipal directory. */
export const MUNICIPAL_DIRECTORY_SOURCE_ID = "ca-qc/municipal-directory";

/** Dataset id (OGC-style, globally unique, ADR-0005). */
export const DATASET_MUNICIPAL_DIRECTORY = "qc-municipal-directory";

/**
 * MAMH municipal directory source manifest. One CSV dataset (`MUN.csv`) under
 * CC-BY 4.0; the directory build extracts `mweb` (official website) and
 * `mcourriel` keyed by `mcode`/`munnom`.
 */
export const municipalDirectoryManifest: SourceManifest = {
  id: MUNICIPAL_DIRECTORY_SOURCE_ID,
  title: "Répertoire des municipalités du Québec (MAMH) — annuaire des sites web",
  description:
    "Liste officielle des municipalités du Québec avec leur site web (mweb) et " +
    "courriel général (mcourriel), publiée par le ministère des Affaires " +
    "municipales et de l'Habitation sur Données Québec. Sert d'annuaire " +
    "slug → site officiel pour le recensement de plateforme (Lot D).",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC", level: "municipality" },
  provider: {
    name: "Gouvernement du Québec — Ministère des Affaires municipales et de l'Habitation (MAMH)",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${MAMH_REPERTOIRE_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_MUNICIPAL_DIRECTORY,
      title: "Liste des municipalités du Québec (MUN.csv)",
      description:
        "CSV plat (UTF-8) : mcode, munnom, mweb (site officiel), mcourriel, " +
        "adresse, MRC, région. Re-pull pour rafraîchir l'annuaire.",
      format: "csv",
      url: MAMH_MUN_CSV_URL,
      adminLevel: "municipality",
      updateCadence: "P1M",
    },
  ],
};
