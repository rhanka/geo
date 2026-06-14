/**
 * Source manifest for the **BDZI — Base de données des zones inondables**
 * (flood-zone polygons), a provincial geographic *constraint* reproduced from
 * immo's spike `_spikes/bdzi-flood-zones/` (ADR-0013, P-immo Lot 3).
 *
 * ── Real endpoints (from the immo spike README + the Valleyfield Phase-3 spike) ─
 * Données Québec dataset « Base de données des zones inondables » :
 *   https://www.donneesquebec.ca/recherche/dataset/base-de-donnees-des-zones-inondables
 *
 * ArcGIS REST MapServer (CEHQ / EnviroWeb), flood-zone polygons are **layer 22**.
 * Verified functional spatial queries in immo (2026-05-25):
 *   https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/22/query
 * (Related layers: 71 = études/study locations, floodplain limits, map sheets —
 * not acquired here.)
 *
 * Also published as FGDB/GPKG/SQLite ZIP bulk downloads and WMS, not used here.
 * The bulk GPKG is large (~376 MB), so immo used the REST layer as a risk filter
 * (spike Recommendation: `build-later`, REST/WMS first):
 *   https://stqc380donopppdtce01.blob.core.windows.net/donnees-ouvertes/Base_donnees_zones_inondables/BDZI_GPK.zip
 *
 * Observed REST fields (spike "Field Inventory" + Phase-3 polygon table):
 *   OBJECTID, Description (e.g. "Zone de grand/faible courant", "Zone de crue
 *   0-100 ans"), No_rapport (e.g. "PDCC 16-019"), Nm_rapport (study name).
 *
 * Format: ArcGIS REST. Queried with `f=geojson` and `outSR=4326`, mirroring the
 * verified StatCan-CSD recipe, so the emitted geometry is WGS84 GeoJSON (RFC 7946).
 *
 * License: Données Québec open data — CC-BY 4.0.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { SourceManifest } from "@sentropic/geo-core";

/** Globally unique source id for the BDZI flood-zone constraint. */
export const SOURCE_ID = "ca-qc/bdzi-flood-zones";

/**
 * ArcGIS REST MapServer base service (CEHQ public themes). The acquisition
 * `query` URL is `<this>/<layer>/query?...`.
 */
export const BDZI_SERVICE_URL =
  "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer";

/** Flood-zone polygon layer index inside the EnviroWeb MapServer (spike-verified). */
export const BDZI_LAYER_POLYGONS = 22;

/** Bulk GPKG ZIP (retained for provenance; not used — ~376 MB). */
export const BDZI_GPKG_ZIP_URL =
  "https://stqc380donopppdtce01.blob.core.windows.net/donnees-ouvertes/Base_donnees_zones_inondables/BDZI_GPK.zip";

/** Dataset id — `qc-` prefixed for a globally unique OGC collection id (ADR-0005). */
export const DATASET_FLOOD_ZONES = "qc-bdzi-flood-zones";

/** Douglas–Peucker simplify tolerance (degrees) for the post-fetch ogr2ogr step. */
export const BDZI_SIMPLIFY = 0.0005;

/**
 * The BDZI flood-zones source manifest. One ArcGIS-REST dataset acquired from the
 * EnviroWeb MapServer layer 22, filtered to all features (`where=1=1`), returning
 * WGS84 GeoJSON, simplified Douglas–Peucker 0.0005°.
 *
 * `kind` is `"administrative"` to fit the geo-core envelope, but this is a
 * **thematic constraint** (provincial flood zones), not an administrative unit —
 * the normalizer tags features with `constraint: "bdzi-flood-zones"`.
 *
 * `query` mirrors the verified StatCan-CSD ArcGIS recipe: `where`/`outFields`/
 * `returnGeometry`/`outSR=4326`/`f=geojson`, plus `simplify` (the Douglas–Peucker
 * tolerance for the post-fetch ogr2ogr simplification of this large polygon layer).
 */
export const manifest: SourceManifest = {
  id: SOURCE_ID,
  title: "Base de données des zones inondables (BDZI)",
  description:
    "Polygones des zones inondables du Québec (Centre d'expertise hydrique du " +
    "Québec). Contrainte géographique provinciale, servie via le MapServer " +
    "ArcGIS REST public (couche 22) et distribuée via Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Centre d'expertise hydrique du Québec (CEHQ) / Gouvernement du Québec",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage:
    "https://www.donneesquebec.ca/recherche/dataset/base-de-donnees-des-zones-inondables",
  datasets: [
    {
      id: DATASET_FLOOD_ZONES,
      title: "Zones inondables — polygones (BDZI couche 22)",
      description:
        "Polygones des zones inondables (zones de grand/faible courant, crue " +
        "0-100 ans), couche 22 du MapServer ArcGIS REST, en GeoJSON WGS84, " +
        "simplifiées Douglas–Peucker 0,0005°.",
      format: "arcgis-rest",
      url: BDZI_SERVICE_URL,
      crs: "EPSG:4326",
      layer: BDZI_LAYER_POLYGONS,
      query: {
        where: "1=1",
        outFields: "*",
        returnGeometry: true,
        outSR: 4326,
        f: "geojson",
        simplify: BDZI_SIMPLIFY,
      },
      updateCadence: "P1Y",
    },
  ],
};
