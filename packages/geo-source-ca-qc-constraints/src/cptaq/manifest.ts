/**
 * Source manifest for the **CPTAQ zone agricole** (agricultural-zone polygons),
 * a provincial geographic *constraint* reproduced from immo's spike
 * `_spikes/cptaq-zone-agricole/` (ADR-0013, P-immo Lot 3).
 *
 * ── Real endpoints (from the immo spike README) ───────────────────────────
 * Données Québec dataset « Zone agricole transposée » :
 *   https://www.donneesquebec.ca/recherche/dataset/zone-agricole-transposee
 *
 * Bulk SHP ZIP download (the spike's Sample Inventory):
 *   https://carto.cptaq.gouv.qc.ca/data/shapefiles/ZA_transposee.zip
 *
 * Also published as a WMS service (GetCapabilities) and public map/search
 * interfaces (Déméter), not used here:
 *   https://carto.cptaq.gouv.qc.ca/cgi-bin/cptaq?SERVICE=WMS&VERSION=1.0.0&REQUEST=GetCapabilities
 *   https://demeter.cptaq.gouv.qc.ca/
 *
 * Observed layers / fields (spike "Field Inventory"):
 *   zone_agricole_s (polygon)  Mrc, Date_maj, Zonage
 *   zone_agricole_l (line)     Id, Source, Texte, Date_maj
 * We acquire the polygon layer `zone_agricole_s` (the agricultural-zone
 * constraint surface). The line layer is the cartographic boundary and is not
 * used as a constraint surface.
 *
 * Format: SHP ZIP. GDAL (`/vsizip/`) reads the layer SRS from the shapefile's
 * `.prj`, so no `crs` is pinned here (the spike does not state one); `ogr2ogr
 * -t_srs EPSG:4326 -lco RFC7946=YES` reprojects to WGS84 GeoJSON.
 *
 * License: Données Québec open data — CC-BY 4.0 (same family as the SDA source),
 * with CPTAQ's caveat that the *transposed* layer is not the official legal plan.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { SourceManifest } from "@sentropic/geo-core";

/** Globally unique source id for the CPTAQ agricultural-zone constraint. */
export const SOURCE_ID = "ca-qc/cptaq-zone-agricole";

/** Bulk SHP ZIP of the transposed agricultural zone (spike Sample Inventory). */
export const CPTAQ_ZA_SHP_ZIP_URL =
  "https://carto.cptaq.gouv.qc.ca/data/shapefiles/ZA_transposee.zip";

/** WMS GetCapabilities endpoint (retained for provenance; not used for acquisition). */
export const CPTAQ_WMS_URL =
  "https://carto.cptaq.gouv.qc.ca/cgi-bin/cptaq?SERVICE=WMS&VERSION=1.0.0&REQUEST=GetCapabilities";

/** Dataset id — prefixed `qc-` for a globally unique OGC collection id (ADR-0005). */
export const DATASET_ZONE_AGRICOLE = "qc-cptaq-zone-agricole";

/** Shapefile layer name inside `ZA_transposee.zip` (polygon constraint surface). */
export const CPTAQ_LAYER_POLYGON = "zone_agricole_s";

/**
 * The CPTAQ zone-agricole source manifest. One polygon dataset acquired via
 * GDAL from the SHP ZIP and reprojected to WGS84 GeoJSON.
 *
 * `kind` is `"administrative"` to fit the geo-core envelope, but this is a
 * **thematic constraint** (provincial agricultural zone), not an administrative
 * unit — the normalizer tags features with `constraint: "cptaq-zone-agricole"`.
 *
 * `query.simplify` is the Douglas–Peucker tolerance passed to `ogr2ogr
 * -simplify`, in source-SRS units; tuned to keep the emitted GeoJSON manageable
 * for this large provincial polygon layer.
 */
export const manifest: SourceManifest = {
  id: SOURCE_ID,
  title: "Zone agricole transposée (CPTAQ)",
  description:
    "Polygones de la zone agricole protégée du Québec (couche transposée de la " +
    "Commission de protection du territoire agricole du Québec). Contrainte " +
    "géographique provinciale, distribuée via Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Commission de protection du territoire agricole du Québec (CPTAQ)",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: "https://www.donneesquebec.ca/recherche/dataset/zone-agricole-transposee",
  datasets: [
    {
      id: DATASET_ZONE_AGRICOLE,
      title: "Zone agricole transposée — polygones",
      description:
        "Surface de la zone agricole protégée (couche zone_agricole_s). " +
        "La couche transposée n'est pas le plan légal officiel.",
      format: "shp",
      url: CPTAQ_ZA_SHP_ZIP_URL,
      layer: CPTAQ_LAYER_POLYGON,
      query: { simplify: 0.0005 },
      updateCadence: "P1Y",
    },
  ],
};
