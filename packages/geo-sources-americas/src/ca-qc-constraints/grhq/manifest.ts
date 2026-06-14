/**
 * Source manifest for the **GRHQ — Géobase du réseau hydrographique du Québec**
 * (hydrographic network), a provincial geographic *constraint* (riparian-buffer
 * proximity) reproduced from immo's spike `_spikes/grhq-hydrography/` (ADR-0013,
 * P-immo Lot 3).
 *
 * ── Real endpoints (from the immo spike README + the Valleyfield Phase-3 spike) ─
 * Données Québec dataset « GRHQ » :
 *   https://www.donneesquebec.ca/recherche/dataset/grhq
 *
 * ArcGIS REST MapServer (same EnviroWeb public-themes service as BDZI). Two
 * spike-verified hydrographic layers (functional spatial queries, 2026-05-25):
 *   layer 104 — Plans d'eau (waterbody surfaces / polygons)
 *     https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/104/query
 *   layer 101 — Réseau linéaire (Strahler order, line features)
 *     https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer/101/query
 *
 * Also published as a CSV/SHP block index, FGDB directories, and WMS services
 * (servicescarto.mern.gouv.qc.ca), not used here:
 *   https://servicescarto.mern.gouv.qc.ca/pes/services/Territoire/GRHQ_simple_WMS/MapServer/WMSServer
 *   https://diffusion.mern.gouv.qc.ca/Diffusion/RGQ/Documentation/GRHQ/Index_GRHQ.csv
 *
 * Observed REST fields (spike "Field Inventory" + Phase-3 codes): `TYPECE`
 * (hydrographic-element type: 10 = cours d'eau linéaire/surface, 21 = surface
 * hydrographique, 23 = rive, 42 = île/péninsule), `PERENNITE` (P = permanent,
 * I = intermittent). The index carries `Bloc`, `Zone`, `FGDB`.
 *
 * Format: ArcGIS REST. Queried with `f=geojson` and `outSR=4326`, so the emitted
 * geometry is WGS84 GeoJSON (RFC 7946). The waterbody layer is a large polygon
 * layer, so `query.simplify` is set; the linear layer keeps full geometry.
 *
 * License: Données Québec open data — CC-BY 4.0.
 *
 * NB (spike Risks): GRHQ is *not itself* the regulatory buffer — riparian-strip
 * setbacks need local bylaw interpretation. It is captured as environmental
 * proximity enrichment (spike Recommendation: `build-later`).
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { SourceManifest } from "@sentropic/geo-core";

/** Globally unique source id for the GRHQ hydrographic-network constraint. */
export const SOURCE_ID = "ca-qc/grhq-hydrography";

/** ArcGIS REST MapServer base service (same EnviroWeb public-themes as BDZI). */
export const GRHQ_SERVICE_URL =
  "https://www.servicesgeo.enviroweb.gouv.qc.ca/donnees/rest/services/Public/Themes_publics/MapServer";

/** Waterbody-surface (plans d'eau) polygon layer index (spike-verified). */
export const GRHQ_LAYER_WATERBODIES = 104;

/** Linear hydrographic network (Strahler) layer index (spike-verified). */
export const GRHQ_LAYER_NETWORK = 101;

/** WMS service (retained for provenance; not used for acquisition). */
export const GRHQ_WMS_URL =
  "https://servicescarto.mern.gouv.qc.ca/pes/services/Territoire/GRHQ_simple_WMS/MapServer/WMSServer";

/** Block index CSV (retained for provenance; not used for acquisition). */
export const GRHQ_INDEX_CSV_URL =
  "https://diffusion.mern.gouv.qc.ca/Diffusion/RGQ/Documentation/GRHQ/Index_GRHQ.csv";

/** Dataset ids — `qc-` prefixed for globally unique OGC collection ids (ADR-0005). */
export const DATASET_WATERBODIES = "qc-grhq-waterbodies";
export const DATASET_NETWORK = "qc-grhq-network";

/** Douglas–Peucker simplify tolerance (degrees) for the large waterbody polygons. */
export const GRHQ_SIMPLIFY = 0.0005;

/** ArcGIS REST query shared by both GRHQ layers (WGS84 GeoJSON pull). */
function grhqQuery(simplify?: number): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = {
    where: "1=1",
    outFields: "*",
    returnGeometry: true,
    outSR: 4326,
    f: "geojson",
  };
  if (simplify !== undefined) query["simplify"] = simplify;
  return query;
}

/**
 * The GRHQ hydrographic-network source manifest. Two ArcGIS-REST datasets from the
 * EnviroWeb MapServer: waterbody surfaces (layer 104, large polygons — simplified)
 * and the linear network (layer 101, Strahler), both returning WGS84 GeoJSON.
 *
 * `kind` is `"administrative"` to fit the geo-core envelope, but this is a
 * **thematic constraint** (hydrographic proximity), not an administrative unit —
 * the normalizer tags features with `constraint: "grhq-hydrography"`.
 */
export const manifest: SourceManifest = {
  id: SOURCE_ID,
  title: "Géobase du réseau hydrographique du Québec (GRHQ)",
  description:
    "Réseau hydrographique du Québec (plans d'eau et réseau linéaire). " +
    "Contrainte géographique provinciale de proximité riveraine, servie via le " +
    "MapServer ArcGIS REST public (couches 104 et 101) et distribuée via " +
    "Données Québec.",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ministère des Ressources naturelles et des Forêts (MRNF) / Gouvernement du Québec",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage: "https://www.donneesquebec.ca/recherche/dataset/grhq",
  datasets: [
    {
      id: DATASET_WATERBODIES,
      title: "Plans d'eau — surfaces hydrographiques (GRHQ couche 104)",
      description:
        "Surfaces des plans d'eau (couche 104 du MapServer ArcGIS REST), en " +
        "GeoJSON WGS84, simplifiées Douglas–Peucker 0,0005°.",
      format: "arcgis-rest",
      url: GRHQ_SERVICE_URL,
      crs: "EPSG:4326",
      layer: GRHQ_LAYER_WATERBODIES,
      query: grhqQuery(GRHQ_SIMPLIFY),
      updateCadence: "P1Y",
    },
    {
      id: DATASET_NETWORK,
      title: "Réseau hydrographique linéaire — Strahler (GRHQ couche 101)",
      description:
        "Réseau hydrographique linéaire (ordre de Strahler, couche 101 du " +
        "MapServer ArcGIS REST), en GeoJSON WGS84.",
      format: "arcgis-rest",
      url: GRHQ_SERVICE_URL,
      crs: "EPSG:4326",
      layer: GRHQ_LAYER_NETWORK,
      query: grhqQuery(),
      updateCadence: "P1Y",
    },
  ],
};
