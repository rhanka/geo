/**
 * Source manifest for the **Cadastre allégé du Québec** (lightweight cadastral
 * lots — polygon parcels keyed by `NO_LOT`), reproduced from radar-immobilier
 * (ADR-0013, P-immo Lot 4).
 *
 * ── Real endpoint (cited from immo) ───────────────────────────────────────────
 * `CADASTRE_ALLEGE_URL` in
 *   radar-immobilier/packages/radar-sources/src/geo/geo-source-inventory.data.ts
 * and the verified query shape in
 *   radar-immobilier/api/src/services/geo/lots.ts
 * and the spike
 *   radar-immobilier/packages/radar-sources/src/sources/_spikes/role-cadastre-valleyfield.md
 *   (« Source 2 : Cadastre allégé du Québec (polygones NO_LOT) »).
 *
 * ArcGIS REST MapServer, province-wide layer **0** (MRNF/BDGQ, served by the
 * MELCCFP geo portal):
 *   https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer/0/query
 *
 * The path corrected by immo (WP-B-lotsfix, 2026-06-10) is
 * `/donnees/rest/services/Reference/...` — the older
 * `/arcgis/rest/services/Mern/...` path returned HTTP 404.
 *
 * Observed query (immo `lots.ts` + spike): the province-wide layer is queried
 * **spatially** (`geometry`=esriGeometryEnvelope + `geometryType` + `spatialRel`
 * + `inSR`), not with `where=1=1`; the MapServer rejects an unbounded
 * `where=1=1` with HTTP 404. The per-request bounding-box (and the per-city
 * bbox table + lot scoring) is immo business logic and stays in immo — this
 * recipe captures the generic, bbox-agnostic fields/format/CRS.
 *
 * Observed fields (spike "Source 2" + immo `outFields`): only **`NO_LOT`** is
 * verified — a string carrying spaces, e.g. `"4 516 943"` (preserved verbatim).
 * The richer per-lot attributes immo uses (zone, superficie, scoring) come from
 * the rôle d'évaluation / "carte-steve" enrichment, NOT this cadastre layer.
 *
 * CRS: the layer's native geometry is EPSG:3857 (Web Mercator) per the spike;
 * immo requests `outSR=4326` so the server returns WGS84 GeoJSON (RFC 7946),
 * matching the BDZI/StatCan ArcGIS recipe. MaxRecordCount = 2000 (spike).
 *
 * License: the SDA/MRNF open data is **CC-BY 4.0, © Gouvernement du Québec**
 * (separation.md §licences: "SDA MERN (polygones municipaux, cadastre allégé) :
 * CC-BY 4.0").
 * ──────────────────────────────────────────────────────────────────────────────
 */

import type { SourceManifest } from "@sentropic/geo-core";

/** Globally unique source id for the Québec cadastre allégé. */
export const SOURCE_ID = "ca-qc/cadastre";

/**
 * ArcGIS REST MapServer base service for the cadastre allégé. The acquisition
 * `query` URL built by `arcgisQueryUrl` is `<this>/<layer>/query?...`, i.e.
 * `.../Cadastre_allege/MapServer/0/query` — the exact endpoint verified by immo.
 */
export const CADASTRE_SERVICE_URL =
  "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer";

/** The cadastral-lot polygon layer index inside the MapServer (spike-verified). */
export const CADASTRE_LAYER_LOTS = 0;

/** Public cadastral identifier field on the layer (the sole verified attribute). */
export const CADASTRE_FIELD_NO_LOT = "NO_LOT";

/** Dataset id — `qc-` prefixed for a globally unique OGC collection id (ADR-0005). */
export const DATASET_LOTS = "qc-cadastre-lots";

/**
 * Douglas–Peucker simplify tolerance (degrees) for the post-fetch ogr2ogr step.
 * The cadastre is a very large, fine polygon layer; a small tolerance keeps the
 * emitted GeoJSON manageable without collapsing parcel shapes.
 */
export const CADASTRE_SIMPLIFY = 0.00005;

/**
 * The cadastre-allégé source manifest. One ArcGIS-REST dataset acquired from the
 * MELCCFP geo-portal MapServer layer 0, returning WGS84 GeoJSON (`outSR=4326`,
 * `f=geojson`), restricted to the `NO_LOT` field, simplified Douglas–Peucker.
 *
 * `kind` is `"administrative"` to fit the geo-core envelope; cadastral lots are
 * the finest public parcel referential (level `"locality"` in the normalizer).
 *
 * `query` mirrors the verified immo recipe — `outFields=NO_LOT`,
 * `returnGeometry=true`, `outSR=4326`, `f=geojson` — plus `simplify` (the
 * post-fetch ogr2ogr tolerance). `where=1=1` is the geo-acquire default; the
 * province-wide layer is queried by the host with a per-request bbox (immo),
 * which is layered on top of this manifest at acquisition time.
 */
export const manifest: SourceManifest = {
  id: SOURCE_ID,
  title: "Cadastre allégé du Québec",
  description:
    "Polygones des lots cadastraux du Québec (cadastre allégé MRNF/BDGQ), " +
    "identifiés par leur numéro de lot public NO_LOT. Couverture province-" +
    "entière, servie via le MapServer ArcGIS REST du portail géographique " +
    "gouvernemental. La logique lots+score (API) reste côté immo (ADR-0013).",
  kind: "administrative",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: {
    name: "Ministère des Ressources naturelles et des Forêts (MRNF) / Gouvernement du Québec",
    url: "https://www.donneesquebec.ca",
  },
  license: "cc-by-4.0",
  homepage:
    "https://www.quebec.ca/habitation-territoire/information-fonciere/cadastre/consulter-cadastre",
  datasets: [
    {
      id: DATASET_LOTS,
      title: "Lots cadastraux — cadastre allégé (couche 0)",
      description:
        "Polygones des lots (NO_LOT) du cadastre allégé, couche 0 du MapServer " +
        "ArcGIS REST, en GeoJSON WGS84 (reprojeté depuis EPSG:3857), simplifiés " +
        "Douglas–Peucker. NO_LOT est une chaîne avec espaces (ex. « 4 516 943 »).",
      format: "arcgis-rest",
      url: CADASTRE_SERVICE_URL,
      crs: "EPSG:4326",
      layer: CADASTRE_LAYER_LOTS,
      query: {
        outFields: CADASTRE_FIELD_NO_LOT,
        returnGeometry: true,
        outSR: 4326,
        f: "geojson",
        simplify: CADASTRE_SIMPLIFY,
      },
      // BDGQ refresh is bimonthly (separation.md: « Cadence … bimestrielle »).
      updateCadence: "P2M",
    },
  ],
};
