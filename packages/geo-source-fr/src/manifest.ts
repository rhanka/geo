/**
 * Source manifest for IGN « ADMIN EXPRESS COG CARTO », the authoritative French
 * administrative boundaries, acquired from the bulk GeoPackage via GDAL.
 *
 * ── Bulk GPKG acquisition (verified 2026-06-13) ───────────────────────────
 * IGN publishes ADMIN EXPRESS through the Géoplateforme download API. The
 * `ADMIN-EXPRESS-COG-CARTO` product is the cartographic-generalized variant,
 * aligned with the INSEE Code Officiel Géographique (COG) at 1 January of the
 * edition year. The whole-France delivery (`FRA`) ships **all themes in a
 * single GeoPackage** and, unlike the metropolitan `FXX`/Lambert-93 delivery,
 * is stored in **EPSG:4326 (WGS84)** — so it already covers the 5 overseas
 * régions and is geographic out of the box.
 *
 *   https://data.geopf.fr/telechargement/download/ADMIN-EXPRESS-COG-CARTO/
 *     ADMIN-EXPRESS-COG-CARTO_4-0__GPKG_WGS84G_FRA_2026-01-01/
 *     ADMIN-EXPRESS-COG-CARTO_4-0__GPKG_WGS84G_FRA_2026-01-01.7z   (~120 MB)
 *
 * The archive is a **`.7z`** (not a `.zip`); inside, after the IGN delivery
 * folder tree, sits one GeoPackage:
 *
 *   …/1_DONNEES_LIVRAISON_<id>/ADE-COG-CARTO_4-0_GPKG_WGS84G_FRA-ED2026-01-01/
 *     ADE-COG-CARTO_4-0_GPKG_WGS84G_FRA-ED2026-01-01.gpkg   (~300 MB)
 *
 * `ogrinfo -ro -so` lists 20 layers; the three polygon layers we use (names are
 * lowercase tables in edition 4-0 — they were uppercase Shapefiles in ≤ 3-2):
 *
 *   region       Région (Multi Polygon)        ← fr-regions       (18 features)
 *   departement  Département (Multi Polygon)    ← fr-departements  (101 features)
 *   commune      Commune (Multi Polygon)        ← fr-communes      (34877 features)
 *
 * Field names (esriFieldType→GPKG String unless noted) keyed by the normalizers:
 *
 *   region — Région
 *     code_insee    INSEE région code  e.g. "11" (Île-de-France), "84"
 *     nom_officiel  région name        e.g. "Île-de-France"
 *     cleabs, nom_officiel_en_majuscules, code_siren
 *
 *   departement — Département
 *     code_insee                INSEE département code e.g. "75", "2A", "971"
 *     nom_officiel              département name        e.g. "Paris"
 *     code_insee_de_la_region   parent région code      e.g. "11"
 *     cleabs, code_siren
 *
 *   commune — Commune
 *     code_insee                  INSEE commune code (5 char) e.g. "75056"
 *     nom_officiel                commune name                e.g. "Paris"
 *     code_insee_du_departement   parent département code      e.g. "75"
 *     code_insee_de_la_region     région code                  e.g. "11"
 *     statut, population (Integer), code_postal, codes_siren_des_epci, …
 *
 * Source CRS: **EPSG:4326** (the FRA delivery is WGS84). `ogr2ogr -simplify`
 * therefore takes a tolerance in **degrees**, and `crs` below reflects that.
 * `ogr2ogr -t_srs EPSG:4326 -lco RFC7946=YES` yields 2D WGS84 GeoJSON.
 *
 * License: **Licence Ouverte / Open Licence 2.0 (Etalab)** — open and
 * redistributable, attribution required (© IGN).
 *
 * NOTE — the bulk archive is a `.7z`. `@sentropic/geo-acquire`'s built-in GDAL
 * path opens archives through GDAL's `/vsizip/` (ZIP only) and so cannot consume
 * a `.7z` directly. The manifest still declares `format:"gpkg"` with the real
 * upstream `.7z` URL as the single source of truth for provenance; the
 * package's `scripts/produce.ts` mirrors the acquire pipeline (7z-extract →
 * `ogr2ogr` → normalizer → `writeNormalized`) to produce the normalized data.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { SourceManifest } from "@sentropic/geo-core";

/**
 * Bulk ADMIN EXPRESS COG CARTO whole-France (FRA) delivery, edition 4-0,
 * 2026-01-01, in WGS84 (~120 MB `.7z`). The archive holds one GeoPackage with
 * all themes; GDAL opens that `.gpkg` once extracted. Licence Ouverte 2.0.
 */
export const ADMIN_EXPRESS_7Z_URL =
  "https://data.geopf.fr/telechargement/download/ADMIN-EXPRESS-COG-CARTO/" +
  "ADMIN-EXPRESS-COG-CARTO_4-0__GPKG_WGS84G_FRA_2026-01-01/" +
  "ADMIN-EXPRESS-COG-CARTO_4-0__GPKG_WGS84G_FRA_2026-01-01.7z";

/**
 * Path of the GeoPackage inside the extracted `.7z` (the IGN delivery tree).
 * Recorded so `scripts/produce.ts` can locate the `.gpkg` after extraction.
 */
export const ADMIN_EXPRESS_INNER_GPKG =
  "ADMIN-EXPRESS-COG-CARTO_4-0__GPKG_WGS84G_FRA_2026-01-01/ADMIN-EXPRESS-COG-CARTO/" +
  "1_DONNEES_LIVRAISON_2026-03-00184/ADE-COG-CARTO_4-0_GPKG_WGS84G_FRA-ED2026-01-01/" +
  "ADE-COG-CARTO_4-0_GPKG_WGS84G_FRA-ED2026-01-01.gpkg";

/** Géoservices landing page for the product (catalog/provenance). */
export const ADMIN_EXPRESS_HOMEPAGE =
  "https://geoservices.ign.fr/telechargement-api/ADMIN-EXPRESS-COG-CARTO";

/** Globally unique source id for the French ADMIN EXPRESS source. */
export const SOURCE_ID = "fr/admin-express";

/** Dataset ids — prefixed with `fr-` so they are globally unique OGC collection ids. */
export const DATASET_REGIONS = "fr-regions";
export const DATASET_DEPARTEMENTS = "fr-departements";
export const DATASET_COMMUNES = "fr-communes";

/** GeoPackage polygon layer names inside the ADMIN EXPRESS GPKG, pinned from `ogrinfo`. */
export const ADE_LAYERS = {
  regions: "region",
  departements: "departement",
  communes: "commune",
} as const;

/**
 * The French ADMIN EXPRESS source manifest. Three datasets (régions,
 * départements, communes), each a polygon layer of the bulk ADMIN EXPRESS COG
 * CARTO GeoPackage, reprojected to / emitted as WGS84 GeoJSON, under Licence
 * Ouverte 2.0.
 *
 * `query.simplify` is the Douglas–Peucker tolerance passed to `ogr2ogr
 * -simplify`, in source-SRS units (here **degrees**, as the FRA GPKG is
 * EPSG:4326). Tolerances are tuned per level to keep régions/départements small
 * while preserving recognizable boundaries.
 *
 * `fr-communes` (34 877 features) is declared for completeness but its
 * normalized data is **not produced here**: even at an aggressive 0.004°
 * simplification the GeoJSON is ~30 MB before normalization (the communes carry
 * many string attributes), above the ~25 MB target. See the package README /
 * report — it is left for a follow-up that drops non-essential attributes or
 * splits per-département.
 */
export const manifest: SourceManifest = {
  id: SOURCE_ID,
  title: "ADMIN EXPRESS COG CARTO (France)",
  description:
    "Régions, départements et communes de France (métropole et départements/" +
    "régions d'outre-mer), issus du produit ADMIN EXPRESS COG CARTO de l'IGN, " +
    "aligné sur le Code Officiel Géographique (COG) de l'INSEE.",
  kind: "administrative",
  jurisdiction: { country: "FR" },
  provider: {
    name: "Institut national de l'information géographique et forestière (IGN)",
    url: "https://www.ign.fr",
    email: "contact.geoservices@ign.fr",
  },
  license: "licence-ouverte-2.0",
  homepage: ADMIN_EXPRESS_HOMEPAGE,
  datasets: [
    {
      id: DATASET_REGIONS,
      title: "Régions de France",
      description: "Les 18 régions françaises (métropole + 5 régions d'outre-mer).",
      format: "gpkg",
      url: ADMIN_EXPRESS_7Z_URL,
      crs: "EPSG:4326",
      adminLevel: "region",
      layer: ADE_LAYERS.regions,
      query: { simplify: 0.001 },
      updateCadence: "P1Y",
    },
    {
      id: DATASET_DEPARTEMENTS,
      title: "Départements de France",
      description: "Les 101 départements français (métropole + outre-mer).",
      format: "gpkg",
      url: ADMIN_EXPRESS_7Z_URL,
      crs: "EPSG:4326",
      adminLevel: "department",
      layer: ADE_LAYERS.departements,
      query: { simplify: 0.001 },
      updateCadence: "P1Y",
    },
    {
      id: DATASET_COMMUNES,
      title: "Communes de France",
      description:
        "Les communes françaises (~34 877). Déclaré pour complétude ; données " +
        "normalisées non produites ici (fichier trop volumineux) — voir le rapport.",
      format: "gpkg",
      url: ADMIN_EXPRESS_7Z_URL,
      crs: "EPSG:4326",
      adminLevel: "municipality",
      layer: ADE_LAYERS.communes,
      query: { simplify: 0.004 },
      updateCadence: "P1Y",
    },
  ],
};
