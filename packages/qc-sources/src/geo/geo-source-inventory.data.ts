/**
 * Inventaire réel des sources géographiques (zonage + lots) pour les villes
 * prioritaires du pipeline radar-immobilier. Prérequis WP B (vertical géo).
 *
 * ## Protocole anti-invention
 *
 * - `geojson` n'est déclaré que lorsqu'une source ouverte avec géométrie vectorielle
 *   est confirmée (référence documentée ci-dessous).
 * - `pdf` = plan de zonage en PDF (scanné ou vectoriel) : source présente, non vectorisée.
 * - `none` = source absente après investigation (ex. dataset Valleyfield introuvable sur
 *   Données Québec CKAN pour le zonage municipal).
 * - `unknown` = ville non encore investigée.
 *
 * ## Sources ouvertes confirmées
 *
 * ### Lots (cadastre allégé)
 *   Source : `geo.environnement.gouv.qc.ca/arcgis/rest/services/Mern/Cadastre_allege/MapServer/0`
 *   Couverture : toutes les municipalités du Québec (REST ESRI, query retourne GeoJSON).
 *   Vérifié : 15/15 lots présents HTTP 200 sur Salaberry-de-Valleyfield (2026-05-25).
 *   Cadence de mise à jour : bimestrielle (MRNF/BDGQ).
 *   Ref. interne : SPEC_PLAN_SCRAPING.md source A6 `cadastre-allege`.
 *
 * ### Zonage municipal
 *   Salaberry-de-Valleyfield : plans de zonage = feuillets 1-3 scannés en PDF.
 *   CKAN Données Québec (2026-05-25) : aucun dataset de zonage vectoriel trouvé.
 *   Ref. interne : SPEC_PLAN_SCRAPING.md source B8 + SPEC_EVOL_DATA_MODEL.md §2.
 *
 * ### Zonage Beauharnois, Sainte-Catherine, Saint-Constant, Delson, Saint-Damase
 *   Non investigué à la date de compilation (2026-06-10).
 *   Classé `unknown` conformément au protocole anti-invention.
 */

import type { GeoSourceInventoryT } from "./geo-source-inventory.js";

/**
 * URL de la couche cadastre allégé (REST ESRI, province-entière).
 * La query se fait par bbox (EPSG:4326) → retourne des polygones GeoJSON.
 *
 * Chemin corrigé : /donnees/rest/services/Reference/... (pas /arcgis/rest/services/Mern/...)
 * Vérifié HTTP 200 le 2026-06-10 sur Salaberry-de-Valleyfield avec inSR=4326.
 * Ref. interne : role-cadastre-valleyfield.md §Source 2.
 */
const CADASTRE_ALLEGE_URL =
  "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0/query";

/**
 * Inventaire initial pour les 6 villes pilotes de la phase 1 du radar.
 *
 * Ordre : Salaberry-de-Valleyfield et Beauharnois (investigués) en premier ;
 * puis Sainte-Catherine, Delson, Saint-Constant, Saint-Damase (non investigués).
 */
export const GEO_SOURCE_INVENTORIES: readonly GeoSourceInventoryT[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // Salaberry-de-Valleyfield (70052)
  // Investigué : 2026-05-25 (SPEC_EVOL_DATA_MODEL.md + SPEC_PLAN_SCRAPING.md)
  // ──────────────────────────────────────────────────────────────────────────
  {
    citySlug: "salaberry-de-valleyfield",
    zonage: {
      availability: "pdf",
      quality: "pdf",
      url: "https://ville.valleyfield.qc.ca/services/urbanisme/reglementation/",
      // URL du portail réglementation ; les feuillets de zonage (PDF scanné)
      // sont téléchargeables depuis ce répertoire (Feuillets 1, 2, 3).
    },
    lots: {
      availability: "donnees-quebec",
      quality: "geojson",
      url: CADASTRE_ALLEGE_URL,
    },
    notes:
      "Zonage : feuillets 1-3 scannés, aucun vecteur open-data trouvé sur CKAN Données Québec (2026-05-25). " +
      "Lots : cadastre allégé MRNF (REST ESRI), 15/15 lots Valleyfield confirmés HTTP 200 (2026-05-25). " +
      "Source CKAN ref : SPEC_PLAN_SCRAPING.md A6 + SPEC_EVOL_DATA_MODEL.md §2.",
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Beauharnois (70022)
  // Avis publics investigués (2026-05-25). Zonage non investigué.
  // ──────────────────────────────────────────────────────────────────────────
  {
    citySlug: "beauharnois",
    zonage: {
      availability: "unknown",
      quality: "none",
      // Portail municipal : https://ville.beauharnois.qc.ca/
      // Zonage non investigué à la date de compilation.
    },
    lots: {
      availability: "donnees-quebec",
      quality: "geojson",
      url: CADASTRE_ALLEGE_URL,
    },
    notes:
      "Lots : cadastre allégé MRNF province-entier (couverture confirmée Valleyfield ; Beauharnois = même couche). " +
      "Zonage : non investigué (2026-06-10). " +
      "Avis publics Beauharnois investigués via WordPress (SPEC_SOURCE_INVESTIGATION_RESULTS.md §1.2).",
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Sainte-Catherine — non investigué
  // ──────────────────────────────────────────────────────────────────────────
  {
    citySlug: "sainte-catherine",
    zonage: {
      availability: "unknown",
      quality: "none",
    },
    lots: {
      availability: "donnees-quebec",
      quality: "geojson",
      url: CADASTRE_ALLEGE_URL,
    },
    notes:
      "Lots : cadastre allégé MRNF (couverture province-entière, non vérifié spécifiquement). " +
      "Zonage : non investigué (2026-06-10).",
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Delson — non investigué
  // ──────────────────────────────────────────────────────────────────────────
  {
    citySlug: "delson",
    zonage: {
      availability: "unknown",
      quality: "none",
    },
    lots: {
      availability: "donnees-quebec",
      quality: "geojson",
      url: CADASTRE_ALLEGE_URL,
    },
    notes:
      "Lots : cadastre allégé MRNF (couverture province-entière, non vérifié spécifiquement). " +
      "Zonage : non investigué (2026-06-10).",
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Saint-Constant — non investigué
  // ──────────────────────────────────────────────────────────────────────────
  {
    citySlug: "saint-constant",
    zonage: {
      availability: "unknown",
      quality: "none",
    },
    lots: {
      availability: "donnees-quebec",
      quality: "geojson",
      url: CADASTRE_ALLEGE_URL,
    },
    notes:
      "Lots : cadastre allégé MRNF (couverture province-entière, non vérifié spécifiquement). " +
      "Zonage : non investigué (2026-06-10).",
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Saint-Damase — non investigué
  // Procès-verbaux investigués (feat/wp4-pv-saint-damase).
  // ──────────────────────────────────────────────────────────────────────────
  {
    citySlug: "saint-damase",
    zonage: {
      availability: "unknown",
      quality: "none",
    },
    lots: {
      availability: "donnees-quebec",
      quality: "geojson",
      url: CADASTRE_ALLEGE_URL,
    },
    notes:
      "Lots : cadastre allégé MRNF (couverture province-entière, non vérifié spécifiquement). " +
      "Zonage : non investigué (2026-06-10). " +
      "PV investigués (proces-verbaux-saint-damase, build-now).",
  },
];

/**
 * Retourne l'inventaire geo pour une ville donnée (par slug).
 * Retourne undefined si la ville n'est pas dans l'inventaire.
 */
export function getGeoSourceInventory(
  citySlug: string,
): GeoSourceInventoryT | undefined {
  return GEO_SOURCE_INVENTORIES.find((inv) => inv.citySlug === citySlug);
}
