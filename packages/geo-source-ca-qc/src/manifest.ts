/**
 * Source manifest for Données Québec « Découpages administratifs » (SDA),
 * provider MRNF, served as an ArcGIS REST MapServer.
 *
 * ── Live service introspection (2026-06-13) ───────────────────────────────
 * Service:
 *   https://servicescarto.mern.gouv.qc.ca/pes/rest/services/Territoire/SDA_WMS/MapServer
 *   (`?f=json` → layers; `<n>?f=json` → fields; `<n>/query?...&f=geojson` → samples)
 *
 * Layers (id | name):
 *   0  Région administrative              ← qc-regions       (adminLevel "region")
 *   1  Municipalité régionale de comté    ← qc-mrc           (adminLevel "mrc")
 *   2  Municipalité                       ← qc-municipalites (adminLevel "municipality")
 *   3  Arrondissement
 *   4  Communauté métropolitaine
 *   5  Agglomération
 *
 * Field names pinned from the live service (esriFieldTypeString unless noted):
 *
 *   Layer 0 — Région administrative
 *     RES_CO_REG  région code        e.g. "11", "03"  (2-digit, zero-padded)
 *     RES_NM_REG  région name        e.g. "Gaspésie–Îles-de-la-Madeleine"
 *     RES_DE_IND, RES_CO_VER, RES_VA_SUP (double), RES_VA_PER (int), OBJECTID
 *
 *   Layer 1 — MRC
 *     MRS_CO_MRC  MRC code           e.g. "371", "50"
 *     MRS_NM_MRC  MRC name           e.g. "Trois-Rivières"
 *     MRS_CO_REG  parent région code e.g. "04"
 *     MRS_NM_REG  parent région name
 *     MRS_NO_IND, MRS_DE_IND, MRS_CO_VER, MRS_VA_SUP (double), MRS_VA_PER (int), OBJECTID
 *
 *   Layer 2 — Municipalité
 *     MUS_CO_GEO  municipality code (code géographique) e.g. "97035", "54115"
 *     MUS_NM_MUN  municipality name e.g. "Fermont"
 *     MUS_CO_MRC  parent MRC code   e.g. "972", "54"
 *     MUS_NM_MRC  parent MRC name
 *     MUS_CO_REG  région code       e.g. "09"
 *     MUS_NM_REG  région name
 *     MUS_CO_DES, MUS_NM_NMC, MUS_NM_AGG, MUS_NM_COM, MUS_CO_COM, MUS_VA_SUP,
 *     SITE_WEB, COURRIEL, TELEPHONE, MUS_CO_VER, MUS_VA_PER (int), OBJECTID
 *
 * All layers are esriGeometryPolygon. `outSR=4326&f=geojson` yields WGS84 GeoJSON,
 * so no client-side reprojection is needed (the native CRS is EPSG:32198).
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { SourceManifest } from "@sentropic/geo-core";

/** ArcGIS REST MapServer endpoint for the SDA découpages administratifs. */
export const SDA_SERVICE_URL =
  "https://servicescarto.mern.gouv.qc.ca/pes/rest/services/Territoire/SDA_WMS/MapServer";

/** Globally unique source id for the Québec SDA source. */
export const SOURCE_ID = "ca-qc/sda";

/** Dataset ids — prefixed with `qc-` so they are globally unique OGC collection ids (ADR-0005). */
export const DATASET_REGIONS = "qc-regions";
export const DATASET_MRC = "qc-mrc";
export const DATASET_MUNICIPALITES = "qc-municipalites";

/** SDA layer ids, pinned from live introspection. */
export const SDA_LAYERS = {
  regions: 0,
  mrc: 1,
  municipalites: 2,
} as const;

/**
 * The Québec SDA source manifest. Three datasets (régions, MRC, municipalités),
 * each an ArcGIS REST layer served as WGS84 GeoJSON, under CC-BY 4.0.
 */
export const manifest: SourceManifest = {
  id: SOURCE_ID,
  title: "Découpages administratifs du Québec (SDA)",
  description:
    "Régions administratives, municipalités régionales de comté (MRC) et " +
    "municipalités du Québec, issues du Système sur le découpage administratif " +
    "(SDA) de Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Gouvernement du Québec — Ministère des Ressources naturelles et des Forêts (MRNF)",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: "https://www.donneesquebec.ca/recherche/dataset/decoupages-administratifs",
  datasets: [
    {
      id: DATASET_REGIONS,
      title: "Régions administratives du Québec",
      description: "Les 17 régions administratives du Québec (SDA).",
      format: "arcgis-rest",
      url: SDA_SERVICE_URL,
      crs: "EPSG:32198",
      adminLevel: "region",
      layer: SDA_LAYERS.regions,
      updateCadence: "P1Y",
    },
    {
      id: DATASET_MRC,
      title: "Municipalités régionales de comté (MRC) du Québec",
      description: "Les MRC et territoires équivalents du Québec (SDA).",
      format: "arcgis-rest",
      url: SDA_SERVICE_URL,
      crs: "EPSG:32198",
      adminLevel: "mrc",
      layer: SDA_LAYERS.mrc,
      updateCadence: "P1Y",
    },
    {
      id: DATASET_MUNICIPALITES,
      title: "Municipalités du Québec",
      description: "Les municipalités du Québec (SDA).",
      format: "arcgis-rest",
      url: SDA_SERVICE_URL,
      crs: "EPSG:32198",
      adminLevel: "municipality",
      layer: SDA_LAYERS.municipalites,
      updateCadence: "P1Y",
    },
  ],
};
