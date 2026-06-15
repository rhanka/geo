/**
 * Example CKAN zonage source declarations for Données Québec open-data datasets.
 *
 * This module demonstrates how to wire a CKAN-hosted municipal zonage dataset
 * into the `@sentropic/geo-sources-americas` manifest/recipe pattern (ADR-0017).
 *
 * ## Principle
 * Each municipality that publishes its zonage on Données Québec has a CKAN
 * *package* (dataset). The acquisition flow is:
 *
 *   1. {@link searchCkanPackages} → discover the package (or pin `packageId` directly).
 *   2. {@link resolveGeoResources} → filter for GeoJSON/SHP/GPKG/KML resources.
 *   3. {@link acquireCkanGeoJson} (for GeoJSON) or `extractLayerToGeoJson` +
 *      GDAL (for SHP/GPKG) → download and parse into a WGS84 FeatureCollection.
 *
 * ## Confirmed municipalities (cadrage §1.3, verified 2026-06-14)
 * The cadrage lists: Longueuil, Gatineau, Saguenay, Lévis, Trois-Rivières,
 * Sherbrooke, Québec, Repentigny, Rimouski, Rouyn-Noranda.
 *
 * **Longueuil** is used here as the worked example because its dataset appeared
 * consistently in cadrage references. The CKAN package id below is a best-effort
 * match — it MUST be confirmed against
 * `https://www.donneesquebec.ca/recherche/api/3/action/package_search?q=zonage+longueuil`
 * before production use (the portal can rename slugs without notice).
 *
 * ## How to declare a new city
 * Copy the {@link LONGUEUIL_ZONAGE_MANIFEST} block, change `id`, `title`,
 * `description`, `provider.name`, `homepage`, and update each dataset's `url`
 * (the direct GeoJSON/SHP resource URL from the CKAN `resources[]` array).
 * If the package publishes only SHP/GPKG, set `format: "shp"` / `"gpkg"` and
 * route the resource through `extractLayerToGeoJson` at acquisition time.
 */

import type { SourceManifest } from "@sentropic/geo-core";

// ── Longueuil — zonage municipal (worked example) ────────────────────────────

/**
 * CKAN package id for the Longueuil municipal zonage dataset on Données Québec.
 *
 * TODO: confirm this id against the live CKAN API before production use:
 *   curl 'https://www.donneesquebec.ca/recherche/api/3/action/package_search?q=zonage+longueuil&rows=5'
 *
 * The slug can drift when the publisher renames the dataset. Pin the *resource*
 * URL (see {@link LONGUEUIL_ZONAGE_GEOJSON_URL}) once confirmed — the resource
 * URL is more stable than the package slug.
 */
export const LONGUEUIL_CKAN_PACKAGE_ID =
  // TODO: confirmer id CKAN — à valider via l'API package_search
  "zonage-ville-de-longueuil";

/**
 * Direct GeoJSON resource URL for the Longueuil zonage.
 *
 * TODO: confirm against `package_show?id=<LONGUEUIL_CKAN_PACKAGE_ID>` →
 * `resources[]` → entry where `format == "GeoJSON"`.
 */
export const LONGUEUIL_ZONAGE_GEOJSON_URL =
  // TODO: confirmer l'URL exacte de la ressource GeoJSON depuis le portail
  "https://www.donneesquebec.ca/recherche/datastore/dump/TODO-resource-id-longueuil";

/** Données Québec CKAN action API base URL (stable, documented). */
export const DONNEESQUEBEC_CKAN_BASE =
  "https://www.donneesquebec.ca/recherche/api/3/action";

/** Dataset id for the Longueuil zonage (OGC collection id, ADR-0005). */
export const DATASET_LONGUEUIL_ZONAGE = "qc-longueuil-zonage";

/**
 * Source manifest for the **Longueuil municipal zonage** via CKAN Données Québec.
 *
 * This is a *GeoJSON* resource acquired directly via {@link acquireCkanGeoJson}.
 * If the publisher switches to SHP/GPKG only, update `format` to `"shp"` or
 * `"gpkg"` and route through `extractLayerToGeoJson`.
 *
 * @remarks
 * - The `url` field points to the **direct GeoJSON download URL** from the CKAN
 *   resource record (not the package landing page). Retrieve it via:
 *   `package_show?id=<LONGUEUIL_CKAN_PACKAGE_ID>` → `resources[].url`.
 * - A downstream normalizer should map raw zone-code fields (e.g. `CODE_ZONE`,
 *   `CATEGORIE`) onto {@link AdminProperties}; that mapping is city-specific and
 *   belongs in a recipe function, not this manifest.
 * - `updateCadence: "P1Y"` is a conservative estimate — some cities re-publish
 *   when their règlement de zonage is amended (can be several times per year).
 */
export const LONGUEUIL_ZONAGE_MANIFEST: SourceManifest = {
  id: "ca-qc/longueuil-zonage",
  title: "Zonage — Ville de Longueuil (CKAN Données Québec)",
  description:
    "Polygones des zones de zonage municipal de la Ville de Longueuil, " +
    "publiés en open data sur le portail Données Québec. Acquisition directe " +
    "via l'API CKAN (acquireCkanGeoJson). Le règlement de zonage et la légende " +
    "des codes sont disponibles sur le site de la ville.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ville de Longueuil / Données Québec",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  // TODO: remplacer par l'URL canonique du package sur le portail une fois confirmée.
  homepage: `https://www.donneesquebec.ca/recherche/dataset/${LONGUEUIL_CKAN_PACKAGE_ID}`,
  datasets: [
    {
      id: DATASET_LONGUEUIL_ZONAGE,
      title: "Zones de zonage — Longueuil (GeoJSON WGS84)",
      description:
        "Polygones de zonage en GeoJSON WGS84 tels que publiés sur Données Québec. " +
        "Acquis via acquireCkanGeoJson (adapter CKAN générique). " +
        "Les SHP/GPKG alternatifs nécessitent extractLayerToGeoJson (GDAL).",
      format: "geojson",
      // TODO: remplacer par l'URL de ressource GeoJSON confirmée (voir LONGUEUIL_ZONAGE_GEOJSON_URL).
      url: LONGUEUIL_ZONAGE_GEOJSON_URL,
      crs: "EPSG:4326",
      // updateCadence conservateur ; à ajuster selon la cadence réelle de publication.
      updateCadence: "P1Y",
    },
  ],
};

// ── Template comment: how to add a new CKAN zonage city ──────────────────────
//
// 1. Look up the package id on Données Québec:
//    curl 'https://www.donneesquebec.ca/recherche/api/3/action/package_search?q=zonage+<city>&rows=5'
//
// 2. Get the resource list:
//    curl 'https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=<package-id>'
//
// 3. Pick the GeoJSON resource URL (format == "GeoJSON") or the SHP/GPKG URL
//    (set needsGdal accordingly).
//
// 4. Add a manifest block here following the LONGUEUIL_ZONAGE_MANIFEST pattern.
//
// 5. Add an entry in the geo-sources-americas registry (index.ts) if the source
//    needs CLI/API acquisition support.
//
// Municipalities confirmed in cadrage §1.3 to publish on Données Québec
// (all TODO — ids to verify via package_search):
//   - Gatineau            → q=zonage+gatineau
//   - Saguenay            → q=zonage+saguenay
//   - Lévis               → q=zonage+levis
//   - Trois-Rivières      → q=zonage+trois-rivieres
//   - Sherbrooke          → q=zonage+sherbrooke
//   - Québec (ville)      → q=zonage+quebec
//   - Repentigny          → q=zonage+repentigny
//   - Rimouski            → q=zonage+rimouski
//   - Rouyn-Noranda       → q=zonage+rouyn-noranda
