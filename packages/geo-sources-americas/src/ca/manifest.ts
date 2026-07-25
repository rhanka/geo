/**
 * Source manifest for Statistics Canada cartographic boundary files (Canada
 * federal administrative geographies), acquired from the bulk zipped shapefiles
 * via GDAL (ADR-0008).
 *
 * ── Bulk shapefile acquisition (verified 2026-06-13) ──────────────────────────
 * Statistics Canada distributes its 2021 Census boundary files as zipped ESRI
 * shapefiles under the **Open Government Licence – Canada** (`ogl-ca`). The
 * cartographic ("…b…") variant clips to the major land mass + coastal islands,
 * giving compact, recognizable boundaries (the digital "…a…" variant follows the
 * full territorial limits far offshore). We use the cartographic files:
 *
 *   Provinces/Territories (PR), cartographic, English attributes:
 *     https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lpr_000b21a_e.zip
 *     → 13 features, ~134 MB zipped; layer `lpr_000b21a_e` (Polygon).
 *
 * Each zip holds a sibling-file shapefile (`.shp/.shx/.dbf/.prj/.xml`) at the
 * archive root; GDAL's `/vsizip/` driver opens it directly and the sole layer
 * matches the basename (= the manifest `layer`).
 *
 * IMPORTANT — source CRS is **EPSG:3347** (NAD83 / Statistics Canada Lambert,
 * metres), confirmed from the `.prj` (Lambert Conic Conformal 2SP, std parallels
 * 49°/77°, false easting 6 200 000 m). `ogr2ogr` reads the SRS from the `.prj`,
 * so `-simplify <query.simplify>` is interpreted in **metres**, and `crs` below
 * reflects the real source CRS. `ogr2ogr -t_srs EPSG:4326 -lco RFC7946=YES`
 * yields 2D WGS84 GeoJSON (right-hand winding).
 *
 * Provinces/Territories (PR) field names (DBF, all String unless noted):
 *
 *   PRUID    province/territory unique id  e.g. "24" (QC), "35" (ON) — the PRUID
 *   DGUID    dissemination geography uid   e.g. "2021A000224"
 *   PRNAME   bilingual name               e.g. "Quebec / Québec"
 *   PRENAME  English name                 e.g. "Quebec"
 *   PRFNAME  French name                  e.g. "Québec"
 *   PREABBR  English abbreviation         e.g. "Que."
 *   PRFABBR  French abbreviation          e.g. "Qc"
 *   LANDAREA land area in km² (Real)      e.g. 1298599.7477
 *
 * ── Census Divisions (CD) — declared, not yet acquired ────────────────────────
 * The CD cartographic file (`lcd_000b21a_e.zip`, ~290 features) is the natural
 * next dataset (same provider/licence/CRS/shapefile path). It is declared below
 * so the source is complete-by-shape, but acquisition + a CD normalizer are left
 * as a follow-up (see {@link CD_SHP_ZIP_URL} and the note in normalizers.ts).
 * ──────────────────────────────────────────────────────────────────────────────
 */

import type { SourceManifest } from "@sentropic/geo-core";

/**
 * Provinces/Territories cartographic boundary file (English attributes),
 * zipped shapefile, ~134 MB, OGL-Canada. GDAL opens the sole shapefile inside.
 */
export const PR_SHP_ZIP_URL =
  "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lpr_000b21a_e.zip";

/**
 * Census Divisions cartographic boundary file (English attributes), zipped
 * shapefile, OGL-Canada. Declared for the {@link DATASET_CENSUS_DIVISIONS}
 * dataset; acquisition is a follow-up.
 */
export const CD_SHP_ZIP_URL =
  "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lcd_000b21a_e.zip";

/** Globally unique source id for the Statistics Canada boundary source. */
export const SOURCE_ID = "ca/statcan-boundaries";

/** Dataset ids — prefixed with `ca-` so they are globally unique OGC collection ids (ADR-0005). */
export const DATASET_PROVINCES = "ca-provinces";
export const DATASET_CENSUS_DIVISIONS = "ca-census-divisions";

/** Shapefile layer names inside each zip, pinned from `ogrinfo` (= the basename). */
export const STATCAN_LAYERS = {
  provinces: "lpr_000b21a_e",
  censusDivisions: "lcd_000b21a_e",
} as const;

/**
 * The Statistics Canada boundary source manifest. The priority dataset is
 * `ca-provinces` (the 13 provinces & territories); `ca-census-divisions` is
 * declared for follow-up. Each is the polygon layer of a bulk zipped shapefile,
 * acquired via GDAL and reprojected to WGS84 GeoJSON, under OGL-Canada.
 *
 * `query.simplify` is the Douglas–Peucker tolerance passed to `ogr2ogr
 * -simplify`, in source-SRS units (here **metres**, as the shapefile is
 * EPSG:3347). 2 000 m (2 km) is appropriate at the national/provincial scale of
 * this layer and keeps the emitted GeoJSON small (~2 MB) while preserving
 * recognizable provincial coastlines (incl. the Arctic archipelago).
 */
export const manifest: SourceManifest = {
  id: SOURCE_ID,
  title: "Statistics Canada — Boundary Files (provinces, territories, census divisions)",
  description:
    "Canada's federal administrative and statistical geographies from the " +
    "Statistics Canada 2021 Census cartographic boundary files: provinces and " +
    "territories (13), and census divisions.",
  kind: "administrative",
  jurisdiction: { country: "CA" },
  provider: {
    name: "Statistics Canada",
    url: "https://www.statcan.gc.ca",
  },
  license: "ogl-ca",
  homepage:
    "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm?year=21",
  datasets: [
    {
      id: DATASET_PROVINCES,
      title: "Provinces and territories of Canada",
      description:
        "The 13 provinces and territories of Canada (Statistics Canada 2021 " +
        "Census cartographic boundary file, PR).",
      format: "shp",
      url: PR_SHP_ZIP_URL,
      crs: "EPSG:3347",
      adminLevel: "province",
      layer: STATCAN_LAYERS.provinces,
      query: { simplify: 2000 },
      updateCadence: "P5Y",
    },
    {
      id: DATASET_CENSUS_DIVISIONS,
      title: "Census divisions of Canada",
      description:
        "The census divisions (CD) of Canada (Statistics Canada 2021 Census " +
        "cartographic boundary file). Declared for follow-up — not yet acquired.",
      format: "shp",
      url: CD_SHP_ZIP_URL,
      crs: "EPSG:3347",
      adminLevel: "county",
      layer: STATCAN_LAYERS.censusDivisions,
      query: { simplify: 1000 },
      updateCadence: "P5Y",
    },
  ],
};
