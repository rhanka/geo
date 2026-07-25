/**
 * Source manifest for the **StatCan Census Subdivision (CSD) 2025** municipal
 * polygons — immo's working *fallback* for the SDA MERN geometry timeout
 * (ADR-0013). Reproduced faithfully from radar-immobilier
 * `radar/data-prep/fetch-municipal-polygons.ts` (Plan B).
 *
 * ── Real endpoint (verified in immo, 2026-06-13) ──────────────────────────────
 *   ArcGIS REST MapServer, layer 0, no authentication, WGS84 (EPSG:4326):
 *     https://geo.statcan.gc.ca/geo_wa/rest/services/2025/lcsd000a25s_e/MapServer/0
 *   The `query` endpoint returns GeoJSON (`f=geojson`). immo pages it with
 *   `where=PRUID='24'` (Québec), `outFields=CSDUID,CSDNAME,CDUID,CDNAME,CSDTYPE`,
 *   `returnGeometry=true`, `resultRecordCount=2000`, `resultOffset=<n>`, following
 *   `exceededTransferLimit`. SDA MERN was the *primary* source but its geometry
 *   endpoint timed out (>2min/page) at authoring time, so Plan B (StatCan CSD)
 *   was used and proven to work (~3s for all of QC).
 *
 *   Simplification: ogr2ogr Douglas–Peucker tolerance 0.0005° (~55 m at QC
 *   latitude). Captured here as `query.simplify`.
 *
 * ── CSD fields ────────────────────────────────────────────────────────────────
 *   CSDUID   7-digit StatCan CSD identifier (e.g. "2466023")  → `code` / MUS_CO_GEO surrogate
 *   CSDNAME  municipality name (e.g. "Montréal")              → join key (NFD-normalized)
 *   CDUID    Census Division id
 *   CDNAME   Census Division name (≈ MRC)                     → secondary join key
 *   CSDTYPE  subdivision type (V, VL, MÉ, CT, PE …)           → tiebreak priority
 *
 * License: StatCan boundary files are published under the **Open Government
 * Licence – Canada** (`ogl-ca`), which permits redistribution with attribution.
 */

import type { SourceManifest } from "@sentropic/geo-core";

/** Globally unique source id for the StatCan CSD polygons (fallback) source. */
export const CSD_SOURCE_ID = "ca-qc/statcan-csd";

/** Dataset id — `qc-` prefixed for a globally unique OGC collection id (ADR-0005). */
export const DATASET_MUNICIPALITIES_POLYGONS = "qc-municipalities-polygons";

/**
 * StatCan CSD 2025 ArcGIS REST MapServer base service (layer 0 is the polygon
 * layer). The acquisition `query` URL is `<this>/0/query?...` (see `query`
 * params on the dataset).
 */
export const STATCAN_CSD_SERVICE_URL =
  "https://geo.statcan.gc.ca/geo_wa/rest/services/2025/lcsd000a25s_e/MapServer";

/** Polygon layer index inside the StatCan CSD MapServer. */
export const STATCAN_CSD_LAYER = 0;

/** Province/Territory unique id filter — `'24'` is Québec. */
export const STATCAN_QC_PRUID = "24";

/** Output fields requested from the CSD layer (immo's `STATCAN_FIELDS`). */
export const STATCAN_CSD_FIELDS = "CSDUID,CSDNAME,CDUID,CDNAME,CSDTYPE" as const;

/** Page size immo uses for the ArcGIS `query` paging (`resultRecordCount`). */
export const STATCAN_CSD_PAGE_SIZE = 2000;

/** Douglas–Peucker simplify tolerance (degrees) — immo's ogr2ogr `-simplify 0.0005`. */
export const STATCAN_CSD_SIMPLIFY = 0.0005;

/**
 * CSDTYPE priority (V > VL > VN > … > NO), immo's tiebreak when the same
 * normalized name appears under several StatCan subdivision types (e.g. a *ville*
 * and a *canton* sharing a name). Reproduced verbatim from immo's
 * `CSDTYPE_PRIORITY` (fetch-municipal-polygons.ts); lower number wins. Exposed as
 * provenance for callers that page the raw StatCan layer themselves.
 */
export const CSDTYPE_PRIORITY: Readonly<Record<string, number>> = {
  V: 1,
  VL: 2,
  VN: 3,
  VC: 4,
  CU: 5,
  MÉ: 6,
  CT: 7,
  PE: 8,
  TC: 9,
  TI: 10,
  TK: 11,
  "S-É": 12,
  IRI: 13,
  GR: 14,
  VK: 15,
  NO: 100,
};

/**
 * The StatCan CSD municipal-polygons source manifest. A single ArcGIS-REST
 * dataset capturing immo's real Plan-B recipe: the StatCan CSD 2025 MapServer
 * layer 0, filtered to Québec (`PRUID='24'`), returning WGS84 GeoJSON, simplified
 * Douglas–Peucker 0.0005°, under the Open Government Licence – Canada.
 *
 * `query` mirrors immo's `URLSearchParams`: ArcGIS `where`/`outFields`/
 * `returnGeometry`/`f`/`resultRecordCount`, plus `outSR=4326` (so the geometry is
 * WGS84) and `simplify` (the Douglas–Peucker tolerance for the post-fetch
 * ogr2ogr simplification).
 */
export const manifest: SourceManifest = {
  id: CSD_SOURCE_ID,
  title: "Polygones municipaux du Québec (StatCan CSD 2025 — repli)",
  description:
    "Polygones des subdivisions de recensement (CSD) 2025 de Statistique " +
    "Canada, filtrés sur le Québec (PRUID='24'), joints au registre des 1106 " +
    "municipalités du Québec. Repli opérationnel d'immo lorsque l'endpoint " +
    "géométrie SDA MERN expire (ADR-0013).",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC", level: "municipality" },
  provider: {
    name: "Statistics Canada / Statistique Canada",
    url: "https://www.statcan.gc.ca",
  },
  license: "ogl-ca",
  homepage:
    "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm",
  datasets: [
    {
      id: DATASET_MUNICIPALITIES_POLYGONS,
      title: "Polygones municipaux du Québec (CSD 2025)",
      description:
        "Subdivisions de recensement du Québec (StatCan CSD 2025), couche 0 du " +
        "MapServer ArcGIS REST, en GeoJSON WGS84, simplifiées Douglas–Peucker " +
        "0,0005°, jointes au registre municipal QC par nom (NFD) + CDNAME (≈ MRC).",
      format: "arcgis-rest",
      url: STATCAN_CSD_SERVICE_URL,
      crs: "EPSG:4326",
      adminLevel: "municipality",
      layer: STATCAN_CSD_LAYER,
      query: {
        where: `PRUID='${STATCAN_QC_PRUID}'`,
        outFields: STATCAN_CSD_FIELDS,
        returnGeometry: true,
        outSR: 4326,
        f: "geojson",
        resultRecordCount: STATCAN_CSD_PAGE_SIZE,
        simplify: STATCAN_CSD_SIMPLIFY,
      },
      updateCadence: "P5Y",
    },
  ],
};
