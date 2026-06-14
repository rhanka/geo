/**
 * Source manifest for the Canadian postal referential — **Statistics Canada
 * 2021 Census cartographic boundary file, Forward Sortation Areas (FSA)**,
 * acquired from the bulk zipped shapefile via GDAL (ADR-0008).
 *
 * ── Bulk shapefile acquisition (verified 2026-06-14) ──────────────────────────
 * A Forward Sortation Area (FSA) is the first three characters of a Canadian
 * postal code (letter–digit–letter, e.g. `H2X`) — the standard postal-geography
 * grain. Statistics Canada distributes FSA boundaries as part of its 2021 Census
 * boundary files under the **Open Government Licence – Canada** (`ogl-ca`). We use
 * the cartographic ("…b…") variant, which clips to the major land mass + coastal
 * islands for compact, recognizable boundaries (the digital "…a…" variant follows
 * the full territorial limits far offshore):
 *
 *   Forward Sortation Areas (FSA), cartographic, English attributes:
 *     https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lfsa000b21a_e.zip
 *     → 1 643 features, ~162 MB zipped; layer `lfsa000b21a_e` (Polygon).
 *     HEAD verified 2026-06-14: HTTP 200, Content-Length 162 038 215,
 *     content-type application/x-zip-compressed, Last-Modified 2022-08-31.
 *
 * Unlike the sibling provinces file (`lpr_000b21a_e.zip`), whose shapefile sits at
 * the archive root, the FSA zip nests its sibling-file shapefile under a directory
 * named like the layer: `lfsa000b21a_e/lfsa000b21a_e.{shp,shx,dbf,prj,xml}`.
 * GDAL's `/vsizip/` driver therefore needs the **inner path** to the `.shp`; the
 * manifest passes it via `query.inner` (consumed by geo-acquire's GDAL path).
 *
 * IMPORTANT — source CRS is **EPSG:3347** (NAD83 / Statistics Canada Lambert,
 * metres), confirmed from the layer SRS WKT (Lambert Conic Conformal 2SP, std
 * parallels 49°/77°, false easting 6 200 000 m, EPSG datum 4269 / NAD83).
 * `ogr2ogr` reads the SRS from the `.prj`, so `-simplify <query.simplify>` is
 * interpreted in **metres**, and `crs` below reflects the real source CRS.
 * `ogr2ogr -t_srs EPSG:4326 -lco RFC7946=YES` yields 2D WGS84 GeoJSON.
 *
 * FSA field names (DBF, `ogrinfo` 2026-06-14; all String unless noted):
 *
 *   CFSAUID  Forward Sortation Area code   e.g. "A0A", "H2X" (3 chars)
 *   DGUID    dissemination geography uid   e.g. "2021A0011A0A"
 *   PRUID    province/territory unique id  e.g. "10" (NL), "24" (QC) — the PRUID
 *   PRNAME   bilingual province name       e.g. "Newfoundland and Labrador /
 *                                               Terre-Neuve-et-Labrador"
 *   LANDAREA land area in km² (Real)       e.g. 4136.6221
 *
 * License: **Open Government Licence – Canada** (`ogl-ca`) — open and
 * redistributable, attribution required (© Statistics Canada).
 * ──────────────────────────────────────────────────────────────────────────────
 */

import type { SourceManifest } from "@sentropic/geo-core";

/**
 * Forward Sortation Areas (FSA) cartographic boundary file (English attributes),
 * zipped shapefile, ~162 MB, OGL-Canada. The shapefile is nested under a
 * `lfsa000b21a_e/` directory inside the zip (see {@link FSA_INNER}).
 */
export const FSA_SHP_ZIP_URL =
  "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lfsa000b21a_e.zip";

/**
 * Inner path to the `.shp` within the FSA zip (GDAL `/vsizip/` needs it because
 * the shapefile is nested in a subdirectory rather than at the archive root).
 */
export const FSA_INNER = "lfsa000b21a_e/lfsa000b21a_e.shp";

/** Globally unique source id for the Statistics Canada FSA postal referential. */
export const SOURCE_ID = "ca/statcan-fsa";

/** Dataset id — prefixed with `ca-` so it is a globally unique OGC collection id (ADR-0005). */
export const DATASET_FSA = "ca-fsa";

/** Shapefile layer name inside the zip, pinned from `ogrinfo` (= the basename). */
export const FSA_LAYER = "lfsa000b21a_e";

/**
 * The Statistics Canada FSA postal-referential source manifest. A single dataset
 * (`ca-fsa`), the polygon layer of the bulk zipped shapefile, acquired via GDAL
 * and reprojected to WGS84 GeoJSON, under OGL-Canada.
 *
 * `kind` is `"postal"`: FSAs are a postal geography (the first three characters of
 * a postal code), not an administrative unit — so geo-acquire emits a
 * {@link ReferentialFeatureCollection} (geometry kept) via the package's
 * `referentialNormalizer`, rather than admin features.
 *
 * `query.simplify` is the Douglas–Peucker tolerance passed to `ogr2ogr
 * -simplify`, in source-SRS units (here **metres**, as the shapefile is
 * EPSG:3347). 100 m keeps the ~1 643 FSA polygons compact while preserving their
 * shape at municipal/metropolitan scale. `query.inner` names the nested `.shp`.
 */
export const manifest: SourceManifest = {
  id: SOURCE_ID,
  title: "Statistics Canada — Forward Sortation Areas (FSA)",
  description:
    "Canada's postal referential: the Forward Sortation Areas (FSA) — the first " +
    "three characters of a postal code — from the Statistics Canada 2021 Census " +
    "cartographic boundary file (1 643 FSA polygons), with each FSA's parent " +
    "province/territory (PRUID).",
  kind: "postal",
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
      id: DATASET_FSA,
      title: "Forward Sortation Areas of Canada",
      description:
        "The Forward Sortation Areas (FSA) of Canada (Statistics Canada 2021 " +
        "Census cartographic boundary file, FSA). Each polygon is one FSA, " +
        "tagged with its province/territory (PRUID).",
      format: "shp",
      url: FSA_SHP_ZIP_URL,
      crs: "EPSG:3347",
      layer: FSA_LAYER,
      query: { simplify: 100, inner: FSA_INNER },
      updateCadence: "P5Y",
    },
  ],
};
