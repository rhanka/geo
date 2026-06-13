/**
 * Source manifest for Données Québec « Découpages administratifs » (SDA),
 * provider MRNF, acquired from the bulk GeoPackage via GDAL (ADR-0008).
 *
 * ── Bulk GPKG acquisition (verified 2026-06-13) ───────────────────────────
 * The ArcGIS REST `query` endpoint is impractical for these large provincial
 * layers (paging, server limits, timeouts), so the manifest now points at the
 * SDA bulk GeoPackage (all layers, ~105 MB zipped, CC-BY 4.0):
 *
 *   https://diffusion.mern.gouv.qc.ca/diffusion/RGQ/Vectoriel/Theme/Local/SDA_20k/GPKG/SDA.gpkg.zip
 *
 * The zip contains a single `SDA.gpkg`; GDAL opens it directly from the archive
 * root via `/vsizip/`. `ogrinfo -ro -so` lists these layers (polygon `_s`,
 * line `_l`):
 *
 *   regio_s  Région administrative (3D Multi Polygon)     ← qc-regions       (18 features)
 *   mrc_s    Municipalité régionale de comté (3D MPoly)   ← qc-mrc           (106 features)
 *   munic_s  Municipalité (3D Multi Polygon)              ← qc-municipalites (1343 features)
 *   (arron_s/comet_s polygons and *_l line layers are not used here)
 *
 * IMPORTANT — the GPKG layers are stored in **EPSG:4269** (NAD83 geographic,
 * degrees), NOT EPSG:32198 (Québec Lambert, metres). ogr2ogr reads the SRS from
 * the file, so `-simplify <tol>` is interpreted in **degrees**, and `crs` below
 * reflects the real source CRS. `ogr2ogr -t_srs EPSG:4326 -lco RFC7946=YES`
 * yields 2D WGS84 GeoJSON (Z dropped, right-hand winding).
 *
 * Field names (identical to the former REST service — the existing normalizers
 * key on these unchanged; esriFieldType→GPKG String unless noted):
 *
 *   regio_s — Région administrative
 *     RES_CO_REG  région code        e.g. "11", "03"  (2-digit, zero-padded)
 *     RES_NM_REG  région name        e.g. "Gaspésie–Îles-de-la-Madeleine"
 *     RES_ID_IND, RES_NO_IND, RES_DE_IND, RES_CO_REF, RES_CO_VER
 *
 *   mrc_s — MRC
 *     MRS_CO_MRC  MRC code           e.g. "371", "50"
 *     MRS_NM_MRC  MRC name           e.g. "Trois-Rivières"
 *     MRS_CO_REG  parent région code e.g. "04"
 *     MRS_NM_REG  parent région name
 *     MRS_ID_IND, MRS_NO_IND, MRS_DE_IND, MRS_CO_REF, MRS_CO_VER
 *
 *   munic_s — Municipalité
 *     MUS_CO_GEO  municipality code (code géographique) e.g. "97035", "54115"
 *     MUS_NM_MUN  municipality name e.g. "Fermont"
 *     MUS_CO_MRC  parent MRC code   e.g. "972", "54"
 *     MUS_NM_MRC  parent MRC name
 *     MUS_CO_REG  région code       e.g. "09"
 *     MUS_NM_REG  région name
 *     MUS_VA_SUP (Real), MUS_CO_DES, MUS_NM_NMC, MUS_NM_AGG, MUS_NM_COM,
 *     MUS_CO_COM, MUS_DA_CON (DateTime), MUS_CO_SOU, MUS_CO_REF, MUS_CO_VER
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { SourceManifest } from "@sentropic/geo-core";

/**
 * Bulk GeoPackage archive (all SDA layers, ~105 MB zipped) under CC-BY 4.0.
 * The zip holds a single `SDA.gpkg`; GDAL opens it from the archive root.
 */
export const SDA_GPKG_ZIP_URL =
  "https://diffusion.mern.gouv.qc.ca/diffusion/RGQ/Vectoriel/Theme/Local/SDA_20k/GPKG/SDA.gpkg.zip";

/**
 * Former ArcGIS REST MapServer endpoint (retained for reference/provenance;
 * no longer used for acquisition — see {@link SDA_GPKG_ZIP_URL}).
 */
export const SDA_SERVICE_URL =
  "https://servicescarto.mern.gouv.qc.ca/pes/rest/services/Territoire/SDA_WMS/MapServer";

/** Globally unique source id for the Québec SDA source. */
export const SOURCE_ID = "ca-qc/sda";

/** Dataset ids — prefixed with `qc-` so they are globally unique OGC collection ids (ADR-0005). */
export const DATASET_REGIONS = "qc-regions";
export const DATASET_MRC = "qc-mrc";
export const DATASET_MUNICIPALITES = "qc-municipalites";

/** GeoPackage polygon layer names inside `SDA.gpkg`, pinned from `ogrinfo`. */
export const SDA_LAYERS = {
  regions: "regio_s",
  mrc: "mrc_s",
  municipalites: "munic_s",
} as const;

/**
 * The Québec SDA source manifest. Three datasets (régions, MRC, municipalités),
 * each a polygon layer of the bulk SDA GeoPackage, acquired via GDAL and
 * reprojected to WGS84 GeoJSON, under CC-BY 4.0.
 *
 * `query.simplify` is the Douglas–Peucker tolerance passed to `ogr2ogr
 * -simplify`, in source-SRS units (here **degrees**, as the GPKG is EPSG:4269).
 * Tolerances are tuned per level to keep each emitted GeoJSON under ~6 MB while
 * preserving recognizable boundaries.
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
      description: "Les 18 régions administratives du Québec (SDA).",
      format: "gpkg",
      url: SDA_GPKG_ZIP_URL,
      crs: "EPSG:4269",
      adminLevel: "region",
      layer: SDA_LAYERS.regions,
      query: { simplify: 0.0008 },
      updateCadence: "P1Y",
    },
    {
      id: DATASET_MRC,
      title: "Municipalités régionales de comté (MRC) du Québec",
      description: "Les MRC et territoires équivalents du Québec (SDA).",
      format: "gpkg",
      url: SDA_GPKG_ZIP_URL,
      crs: "EPSG:4269",
      adminLevel: "mrc",
      layer: SDA_LAYERS.mrc,
      query: { simplify: 0.0008 },
      updateCadence: "P1Y",
    },
    {
      id: DATASET_MUNICIPALITES,
      title: "Municipalités du Québec",
      description: "Les municipalités du Québec (SDA).",
      format: "gpkg",
      url: SDA_GPKG_ZIP_URL,
      crs: "EPSG:4269",
      adminLevel: "municipality",
      layer: SDA_LAYERS.municipalites,
      query: { simplify: 0.0012 },
      updateCadence: "P1Y",
    },
  ],
};
