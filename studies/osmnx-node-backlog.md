# `@sentropic/geo` — Étude stratégique & backlog : devenir LA référence Node/TS pour l'analyse géospatiale (portage osmnx)

> Auteur : architecture géospatiale senior · Date : 2026-06-22 · Cible : `@sentropic/geo` (monorepo `~/src/geo`)
> Contrainte absolue : **0 Python**. Tout est porté en Node/TypeScript.
> Ancrage repo : primitives extraites des scripts Python de `~/src/geo-quebec/work/*` (rosemère, saint-raymond, saint-mathieu, sainte-cécile-de-milton, stcath, petite-rivière-saint-françois) — voir §3.7.

---

## 1. Vision (5 lignes)

`@sentropic/geo` devient l'**osmnx du monde Node/TS** : télécharger, modéliser, analyser, router et visualiser des réseaux de rues et des features OSM **sans Python ni GDAL natif obligatoire**, avec une API typée RFC 7946 de bout en bout. Là où osmnx s'arrête (PDF cadastraux, géoréférencement par GCP, boundary-matching, fusion zonage↔lots), on **dépasse** osmnx en first-class — capacités nées du pipeline Québec et inexistantes ailleurs. Cible : un ingénieur ouvre un `MultiDiGraph` typé, calcule centralité/circuité/isochrones, consolide les intersections et exporte GeoPackage/FlatGeobuf en quelques lignes. Différenciateur : **pur-JS, serverless-friendly, déterministe, géoréférencement documentaire** que personne n'offre en Node.

---

## 2. Cartographie osmnx → Node

Difficulté : **F**=facile (wrapper de lib) · **M**=moyen (assemblage/glue) · **D**=difficile (algo à porter) · **GAP**=rien en Node, à construire.

| Capacité osmnx | Module osmnx (v2) | Équivalent Node (lib ou GAP) | Diff. | Note |
|---|---|---|---|---|
| Télécharger graphe depuis lieu/point/bbox/polygone/adresse | `graph.graph_from_*` | **GAP** : Overpass (`@andreasnicolaou/overpass-client` ou `overpass-frontend`) → `osmtogeojson` → builder maison → `graphology` | D | Cœur à construire ; aucune lib ne fait OSM→graphe routable analysable. `@osmix/router` = WIP pré-alpha |
| `network_type` drive/walk/bike/all | filtre Overpass `highway` | filtre QL maison (presets équivalents osmnx) | F | Reprendre les filtres Overpass d'osmnx tels quels |
| Graphe depuis XML/PBF offline | `graph_from_xml` | `osm-pbf-parser-node` (streaming, typé) / `@osmix/pbf` | M | Pour gros extraits Québec en local, évite Overpass |
| Télécharger features (bâtiments, POI, amenities) | `features.features_from_*` | **`osmtogeojson`** + filtre tags ; requête via Overpass | F | `tags={building:true}` → QL ; mapping direct |
| Géocodage Nominatim (point) | `geocoder.geocode` | `node-geocoder` (provider nominatim) ou `fetch` REST | F | Pas de client Nominatim typé maintenu (soft-GAP) |
| Géocodage → polygone (geocode_to_gdf) | `geocoder.geocode_to_gdf` | `fetch` Nominatim `polygon_geojson=1` | F | Renvoyer `Feature<Polygon>` directement |
| Conversion graphe ⇄ GeoDataFrames | `convert.graph_to_gdfs` / `graph_from_gdfs` | maison (notre graphe ⇄ `FeatureCollection`) | F | Pas de GeoDataFrame en JS → `FeatureCollection` typée |
| Projection / choix auto zone UTM | `projection.project_*` + `estimate_utm_crs` | **`proj4`** (déjà dans le repo) + calcul zone `floor((lon+180)/6)+1` | M | `epsg-index` pour defs ; `utm` lib stale → calcul maison |
| Distance géodésique (great_circle/haversine) | `distance.great_circle` | **`geographiclib-geodesic`** (Karney, typé) ou haversine maison | F | Vectoriser sur `Position[]` |
| Plus proche nœud / arête | `distance.nearest_nodes/edges` | **`geokdbush`** (kNN géo) pour nœuds ; **`flatbush`**/`rbush` (bbox) + projection point→segment maison pour arêtes | M | nearest_edges = index bbox des segments + distance point-segment |
| Plus court chemin (Dijkstra) | `routing.shortest_path` | **`graphology-shortest-path`** (Dijkstra/A*) ou **`ngraph.path`** (A*, NBA*) | F | ngraph = perf (NBA* ~44 ms sur 733k arêtes) |
| k plus courts chemins (Yen) | `routing.k_shortest_paths` | **GAP** (Yen à porter sur graphology) | D | Boucle Yen + Dijkstra ; pas de lib JS dédiée |
| Vitesses & temps de parcours | `routing.add_edge_speeds/travel_times` | maison (defaults par `highway`, parse `maxspeed`) | F | Logique pure, table de vitesses portée d'osmnx |
| Isochrones | recette `nx.ego_graph` + hull | maison : Dijkstra borné en temps + **`@turf/convex`** / **`concaveman`** (+ buffer) | M | Recette osmnx portable ; concaveman = hull serré |
| Stats basiques (n, m, k_avg, longueurs) | `stats.basic_stats` | maison (parcours graphe) | F | Calcul direct sur notre modèle |
| Circuité moyenne | `stats.circuity_avg` | maison : Σ longueur réseau / Σ great-circle | F | great-circle via geographiclib |
| Comptage/densité d'intersections | `stats.intersection_count`, `*_density_km` | maison (degré nœuds) + aire via `@turf/area` | F | streets_per_node sur graphe non-orienté |
| Densités (node/edge/street km²) | `stats.basic_stats(area=)` | maison + `@turf/area` | F | aire muni depuis polygone OSM |
| Simplification topologique (geometry-preserving) | `simplification.simplify_graph` | **GAP** (algo à porter) | D | Suppression nœuds interstitiels, fusion arêtes, LineString préservée |
| Consolidation d'intersections | `simplification.consolidate_intersections` | **GAP** : `@turf/buffer` + union (`martinez`/`jsts`) + clustering + reconstruction | D | Buffer nœuds (projeté) → union → centroïde cluster → rebuild |
| Élévation depuis raster DEM | `elevation.add_node_elevations_raster` | **`geotiff`** (sampler lon/lat maison, bilinéaire) | M | Pas de sampler intégré → math affine |
| Élévation depuis API | `elevation.add_node_elevations_google` | `fetch` (Open-Elevation / Google) | F | Batch + pause |
| Pentes d'arêtes (grades) | `elevation.add_edge_grades` | maison (rise/run) | F | Trivial une fois élévations posées |
| Orientation des rues (bearings) | `bearing.add_edge_bearings`, `calculate_bearing` | maison (azimut) | F | Formule de cap, vectorisable |
| Entropie d'orientation | `bearing.orientation_entropy` | maison (histogramme + Shannon) | F | Indicateur grille vs organique |
| Rose polaire d'orientation | `plot.plot_orientation` | **`d3-shape`/`d3-scale`** → SVG → `sharp`/`resvg` | M | Partie viz, voir GAP §5 |
| Plot graphe (matplotlib) | `plot.plot_graph` | **`d3-geo`** + `canvas`/`@napi-rs/canvas` → PNG | M | **GAP partiel** : pas de matplotlib JS |
| Plot route(s) | `plot.plot_graph_route(s)` | idem (overlay LineString) | M | Même pipeline canvas |
| Figure-ground morphologique | `plot.plot_figure_ground` | maison (buffer rues + remplissage N/B) sur canvas | M | Différenciateur viz urbaine |
| Plot footprints (bâtiments) | `plot.plot_footprints` | `d3-geo` + canvas | F | Polygones remplis |
| Sauvegarde/chargement GraphML | `io.save_graphml/load_graphml` | maison (sérialiseur GraphML) ou `graphology-graphml` | M | Round-trip ; format de référence osmnx |
| Export GeoPackage | `io.save_graph_geopackage` | **`@ngageoint/geopackage`** (pur JS/WASM) | F | Sans GDAL natif |
| Export OSM XML | `io.save_graph_xml` | maison (sérialiseur) | M | Pour moteurs de routing |
| Troncature (dist/polygone/bbox) | `truncate.truncate_graph_*` | maison + `@turf/boolean-point-in-polygon` | F | Sous-graphe ; largest_component aussi |
| Plus grande composante connexe | `truncate.largest_component` | **`graphology-components`** | F | connectedComponents |
| Centralité betweenness/closeness/eigenvector | (NetworkX, hors osmnx mais central) | **`graphology-metrics`** | F | osmnx s'appuie sur NetworkX → on l'offre natif |
| Détection de communautés (Louvain) | (NetworkX) | **`graphology-communities-louvain`** | F | Bonus analyse |
| Requête Overpass brute | `settings.overpass_*` | `@andreasnicolaou/overpass-client` / `overpass-frontend` | F | Endpoint configurable, rate-limit |

**Couverture** : ~70 % des capacités osmnx = F/M (wrappers/glue) ; **les 5 cœurs durs** (builder OSM→graphe, simplify_graph, consolidate_intersections, viz figure-ground, k-shortest-paths) sont des **GAP/D** = notre travail de différenciation (§5).

---

## 3. Proposition d'API `@sentropic/geo`

### 3.0 Conventions (ancrées sur l'existant)

Réutilise le modèle **dépendance-zéro `@sentropic/geo-core`** déjà présent (`packages/geo-core`) :

```ts
import type {
  Position, BBox, Geometry, Feature, FeatureCollection,
  Point, LineString, Polygon, MultiPolygon
} from "@sentropic/geo-core";          // RFC 7946, lon/lat
import { type CrsCode, WGS84, QUEBEC_LAMBERT, normalizeCrsCode } from "@sentropic/geo-core";
```

Nouveaux sous-chemins (cohérents avec `@sentropic/geo/acquire`, `/storage`, `/api` existants) :
`@sentropic/geo/graph`, `/features`, `/project`, `/route`, `/stats`, `/consolidate`, `/elevation`, `/bearing`, `/georef`, `/overpass`, `/io`, `/viz`.

Modèle de graphe canonique (cœur du paquet) :

```ts
// @sentropic/geo/graph
export type NodeId = number;                         // osmid OSM
export interface GraphNode { id: NodeId; x: number; y: number; /* lon,lat ou E,N si projeté */ elevation?: number; streetCount?: number; }
export interface GraphEdge {
  u: NodeId; v: NodeId; key: number;                 // multigraphe : (u,v,key)
  length: number;                                    // mètres
  geometry?: LineString;                             // géométrie réelle (post-simplify)
  osmid?: number | number[]; name?: string; highway?: string; oneway?: boolean;
  maxspeed?: string; speedKph?: number; travelTime?: number; bearing?: number; grade?: number;
  [tag: string]: unknown;                            // tags OSM préservés (cf. useful_tags_way)
}
export interface StreetGraph {                       // ≈ networkx.MultiDiGraph
  readonly directed: boolean;
  readonly crs: CrsCode;                             // WGS84 ou UTM si projeté
  readonly simplified: boolean;
  nodes(): IterableIterator<GraphNode>;
  edges(): IterableIterator<GraphEdge>;
  node(id: NodeId): GraphNode | undefined;
  outEdges(id: NodeId): GraphEdge[]; inEdges(id: NodeId): GraphEdge[];
  order: number; size: number;                       // |V|, |E|
}
export interface GraphOptions {
  networkType?: "drive" | "walk" | "bike" | "drive_service" | "all" | "all_public";
  simplify?: boolean; retainAll?: boolean; truncateByEdge?: boolean;
  customFilter?: string;                             // QL brut
  overpassUrl?: string; useCache?: boolean;
}
```

### 3.1 `graph` — construction du réseau (cœur)

```ts
export function graphFromPlace(query: string | string[], opts?: GraphOptions): Promise<StreetGraph>;
export function graphFromPoint(center: Position /* lon,lat */, distM: number, opts?: GraphOptions & { distType?: "bbox" | "network" }): Promise<StreetGraph>;
export function graphFromBbox(bbox: BBox, opts?: GraphOptions): Promise<StreetGraph>;
export function graphFromPolygon(polygon: Polygon | MultiPolygon, opts?: GraphOptions): Promise<StreetGraph>;
export function graphFromAddress(address: string, distM: number, opts?: GraphOptions): Promise<StreetGraph>;
export function graphFromXml(filePath: string, opts?: { bidirectional?: boolean; simplify?: boolean }): Promise<StreetGraph>; // PBF/XML offline

// conversions (≈ convert.graph_to_gdfs)
export function graphToFeatures(g: StreetGraph, opts?: { nodes?: boolean; edges?: boolean }):
  { nodes: FeatureCollection<Point>; edges: FeatureCollection<LineString> };
export function graphFromFeatures(nodes: FeatureCollection<Point>, edges: FeatureCollection<LineString>): StreetGraph;
export function toUndirected(g: StreetGraph): StreetGraph;
export function largestComponent(g: StreetGraph, opts?: { strongly?: boolean }): StreetGraph;

// troncature (≈ truncate.*)
export function truncateByDist(g: StreetGraph, source: NodeId, distM: number, weight?: keyof GraphEdge): StreetGraph;
export function truncateByPolygon(g: StreetGraph, poly: Polygon | MultiPolygon, opts?: { byEdge?: boolean }): StreetGraph;
export function truncateByBbox(g: StreetGraph, bbox: BBox): StreetGraph;
```

### 3.2 `features` — features OSM (POI, bâtiments)

```ts
export type OsmTags = Record<string, true | string | string[]>;
export function featuresFromPlace(query: string, tags: OsmTags, opts?: GraphOptions): Promise<FeatureCollection>;
export function featuresFromPolygon(poly: Polygon | MultiPolygon, tags: OsmTags, opts?: GraphOptions): Promise<FeatureCollection>;
export function featuresFromBbox(bbox: BBox, tags: OsmTags, opts?: GraphOptions): Promise<FeatureCollection>;
export function featuresFromPoint(center: Position, tags: OsmTags, distM: number, opts?: GraphOptions): Promise<FeatureCollection>;
```

### 3.3 `project` — CRS / UTM

```ts
export function estimateUtmCrs(geom: Geometry | BBox): CrsCode;          // floor((lon+180)/6)+1, hémisphère par lat
export function projectGraph(g: StreetGraph, toCrs?: CrsCode): StreetGraph;     // défaut = UTM auto
export function projectFeatures<P>(fc: FeatureCollection<Geometry, P>, toCrs: CrsCode, fromCrs?: CrsCode): FeatureCollection<Geometry, P>;
export function projectGeometry(geom: Geometry, toCrs: CrsCode, fromCrs?: CrsCode): Geometry;
export function isProjected(crs: CrsCode): boolean;
```

### 3.4 `route` — routing & temps

```ts
export function nearestNode(g: StreetGraph, p: Position): NodeId;
export function nearestNodes(g: StreetGraph, pts: Position[], opts?: { returnDist?: boolean }): NodeId[] | { id: NodeId; distM: number }[];
export function nearestEdge(g: StreetGraph, p: Position): { u: NodeId; v: NodeId; key: number; distM: number };
export function shortestPath(g: StreetGraph, orig: NodeId, dest: NodeId, weight?: keyof GraphEdge): NodeId[] | null;
export function kShortestPaths(g: StreetGraph, orig: NodeId, dest: NodeId, k: number, weight?: keyof GraphEdge): NodeId[][]; // Yen
export function routeToFeature(g: StreetGraph, route: NodeId[]): Feature<LineString, { lengthM: number; travelTimeS?: number }>;
export function addEdgeSpeeds(g: StreetGraph, opts?: { hwySpeeds?: Record<string, number>; fallback?: number }): StreetGraph;
export function addEdgeTravelTimes(g: StreetGraph): StreetGraph;
export function isochrone(g: StreetGraph, center: NodeId, tripMinutes: number[], opts?: { hull?: "convex" | "concave"; bufferM?: number }): FeatureCollection<Polygon, { minutes: number }>;
```

### 3.5 `stats` — morphologie urbaine

```ts
export interface BasicStats {
  n: number; m: number; kAvg: number;
  edgeLengthTotal: number; edgeLengthAvg: number;
  streetsPerNodeAvg: number; streetsPerNodeCounts: Record<number, number>; streetsPerNodeProportions: Record<number, number>;
  intersectionCount: number; streetLengthTotal: number; streetSegmentCount: number; streetLengthAvg: number;
  circuityAvg: number; selfLoopProportion: number;
  // si area fournie (m²) :
  nodeDensityKm?: number; intersectionDensityKm?: number; edgeDensityKm?: number; streetDensityKm?: number;
  cleanIntersectionCount?: number;                  // si cleanIntTolM fourni
}
export function basicStats(g: StreetGraph, opts?: { areaM2?: number; cleanIntTolM?: number }): BasicStats;
export function circuityAvg(g: StreetGraph): number;
export function intersectionCount(g: StreetGraph, minStreets?: number): number;
export function countStreetsPerNode(g: StreetGraph): Map<NodeId, number>;
```

### 3.6 `consolidate` / `simplify` / `bearing` / `elevation`

```ts
// @sentropic/geo/consolidate  (GAP osmnx — différenciateur)
export function simplifyGraph(g: StreetGraph, opts?: { removeRings?: boolean; edgeAttrsDiffer?: (keyof GraphEdge)[] }): StreetGraph;
export function consolidateIntersections(g: StreetGraph /* DOIT être projeté */, toleranceM?: number,
  opts?: { rebuildGraph?: boolean; deadEnds?: boolean; reconnectEdges?: boolean }): StreetGraph;

// @sentropic/geo/bearing
export function addEdgeBearings(g: StreetGraph): StreetGraph;
export function calculateBearing(a: Position, b: Position): number;       // 0..360
export function orientationEntropy(g: StreetGraph, opts?: { numBins?: number; minLengthM?: number }): number;

// @sentropic/geo/elevation
export function addNodeElevationsRaster(g: StreetGraph, demPath: string, opts?: { band?: number }): Promise<StreetGraph>;
export function addNodeElevationsApi(g: StreetGraph, opts: { urlTemplate: string; batchSize?: number }): Promise<StreetGraph>;
export function addEdgeGrades(g: StreetGraph, opts?: { addAbsolute?: boolean }): StreetGraph;
export function sampleDem(demPath: string, points: Position[], opts?: { bilinear?: boolean }): Promise<number[]>; // primitive réutilisable
```

### 3.7 `georef` — PRIMITIVES TIRÉES DU REPO QUÉBEC (différenciateur majeur, inexistant en Node)

> Sources : `work/rosemere/georef.py`, `work/saint-mathieu/ransac.py` (GCP→affine RANSAC) · `work/rosemere/osm_intersections.py` (intersections de rues) · `work/saint-raymond/extract_contour.py` (extraction de contours vectoriels PDF) · `work/petite-riviere-saint-francois/boundary_match.py` (PCA + IoU + ICP/Umeyama) · `work/saint-mathieu/build_zones.py`, `work/stcath/lot_zone.py`, `work/petite-riviere-saint-francois/fusion/p3_cascade_join.py` (association lot↔zone par plus-proche-étiquette + ST_Union).

```ts
// @sentropic/geo/georef

// --- Géoréférencement par GCP + transformée affine + RANSAC (georef.py / ransac.py) ---
export interface Gcp { px: number; py: number; lon: number; lat: number; label?: string }
export interface AffineModel {
  coefLon: [number, number, number];                // lon = a*px + b*py + c
  coefLat: [number, number, number];
  lat0: number; mPerDegLon: number; mPerDegLat: number;
  nGcp: number; nInliers: number; residualMedianM: number; residualMaxInlierM: number;
  scaleXMPerPt: number; scaleYMPerPt: number;
}
export function fitAffineRansac(gcps: Gcp[], opts?: { thresholdM?: number; iters?: number; seed?: number }): AffineModel & { inliers: boolean[] };
export function pageToWorld(m: AffineModel, px: number, py: number): Position;     // -> [lon,lat]

// --- Intersections de rues OSM (osm_intersections.py) ---
export interface StreetIntersection { a: string; b: string; aRaw: string; bRaw: string; point: Position; pairNpts: number }
export function streetIntersections(streets: FeatureCollection<LineString, { name?: string }>,
  opts?: { normalizeName?: (s: string) => string }): StreetIntersection[];        // union par nom -> intersection par paire
export function normalizeStreetName(name: string): string;                         // NFKD, strip génériques (RUE/BOUL/AV…)

// --- Extraction de contours vectoriels depuis PDF (extract_contour.py) ---
export interface VectorPath { subpaths: Position[][] }                             // coords page (pt)
export function extractVectorPaths(pdfPath: string, opts?: { layer?: string; pages?: number[] }): Promise<VectorPath>; // via pdfjs OPS.constructPath
export function extractTextBoxes(pdfPath: string, opts?: { regex?: RegExp }): Promise<{ text: string; cx: number; cy: number }[]>;

// --- Boundary matching : PCA-frame + 8 orientations (IoU) + ICP/Umeyama (boundary_match.py) ---
export interface SimilarityTransform { M: [number, number, number, number]; t: [number, number]; origin: Position }
export interface BoundaryMatchResult { transform: SimilarityTransform; iou: number; iouGap: number; hausdorffM: number; residualM: { median: number; mean: number; max: number } }
export function matchBoundary(planRing: Position[], osmPolygon: Polygon, opts?: { icpIters?: number; resampleN?: number }): BoundaryMatchResult;
export function umeyama(src: Position[], dst: Position[], opts?: { withScale?: boolean }): SimilarityTransform; // SVD via ml-matrix
export function polygonIoU(a: Polygon, b: Polygon): number;

// --- Association lot↔zone (build_zones.py / lot_zone.py / p3_cascade_join.py) ---
export interface LotZoneOptions { cutoffM?: number; ambiguityBandM?: number }
export interface LotZoneAssignment { lotId: string; zoneCode: string; distM: number; ambiguous: boolean }
export function assignLotsToZones(lots: FeatureCollection<Polygon | MultiPolygon>,
  zoneLabels: { code: string; point: Position }[], opts?: LotZoneOptions): LotZoneAssignment[]; // plus-proche-étiquette en mètres
export function buildZonesFromLots(lots: FeatureCollection<Polygon | MultiPolygon>,
  assignments: LotZoneAssignment[]): FeatureCollection<MultiPolygon, { zoneCode: string; nLots: number; nParts: number }>; // ST_Union par code
export function pointInZone(point: Position, zones: FeatureCollection<Polygon | MultiPolygon, { zone: string }>): string | null; // truth containment
```

### 3.8 `overpass` / `io` / `viz`

```ts
// @sentropic/geo/overpass
export function overpassQuery(ql: string, opts?: { url?: string; timeoutS?: number; rateLimit?: boolean }): Promise<OverpassJson>;
export function overpassToGeoJson(json: OverpassJson): FeatureCollection;
export function buildAreaQuery(name: string, filters: string[], opts?: { adminLevel?: number }): string; // ≈ area["name"=…]->.a; way[…](area.a)

// @sentropic/geo/io
export function saveGraphML(g: StreetGraph, path: string): Promise<void>;
export function loadGraphML(path: string): Promise<StreetGraph>;
export function saveGeoPackage(g: StreetGraph, path: string, opts?: { directed?: boolean }): Promise<void>;  // @ngageoint/geopackage
export function saveGraphXml(g: StreetGraph, path: string): Promise<void>;
export function writeFlatGeobuf(fc: FeatureCollection, path: string): Promise<void>;                          // flatgeobuf

// @sentropic/geo/viz (canvas, headless)
export function plotGraph(g: StreetGraph, opts?: PlotOptions): Promise<Buffer>;                 // PNG
export function plotGraphRoute(g: StreetGraph, route: NodeId[], opts?: PlotOptions): Promise<Buffer>;
export function plotFigureGround(g: StreetGraph, opts?: { distM?: number; streetWidths?: Record<string, number> }): Promise<Buffer>;
export function plotOrientation(g: StreetGraph, opts?: { numBins?: number }): Promise<Buffer>;  // rose polaire
export function plotFootprints(fc: FeatureCollection<Polygon | MultiPolygon>, opts?: PlotOptions): Promise<Buffer>;
```

---

## 4. Backlog priorisé

Effort : **S** ≤ 2 j · **M** ≤ 1 sem · **L** ≥ 2 sem. Valeur : ⭐..⭐⭐⭐.

### Tier P0 — Fondations (sans ça, rien ne marche)

| # | Titre | Description | Libs | Effort | Valeur |
|---|---|---|---|---|---|
| P0-1 | Modèle de graphe `StreetGraph` | Multigraphe dirigé typé (§3.0), backé par `graphology` (multi-arêtes + attributs), invariants CRS/simplified | `graphology` | M | ⭐⭐⭐ |
| P0-2 | Client Overpass + cache | `overpassQuery`, rate-limit, retry, subdivision si aire > seuil, `buildAreaQuery` | `@andreasnicolaou/overpass-client` | S | ⭐⭐⭐ |
| P0-3 | OSM → GeoJSON | wrapper `osmtogeojson` + types | `osmtogeojson` | S | ⭐⭐ |
| P0-4 | Builder OSM → `StreetGraph` | parse ways `highway`, dédup nœuds, filtres networkType (drive/walk/bike), `retainAll`, `truncateByEdge` | maison | L | ⭐⭐⭐ |
| P0-5 | `graphFromPlace/Point/Bbox/Polygon/Address` | orchestration géocodage→bbox/polygone→Overpass→builder | maison + Nominatim | M | ⭐⭐⭐ |
| P0-6 | Projection + UTM auto | `estimateUtmCrs`, `projectGraph/Features/Geometry`, registre EPSG | `proj4` (présent), `epsg-index` | M | ⭐⭐⭐ |
| P0-7 | `graphToFeatures` / `graphFromFeatures` | pont graphe ⇄ `FeatureCollection` (équiv. graph_to_gdfs) | `@sentropic/geo-core` | S | ⭐⭐⭐ |
| P0-8 | Index spatial + nearestNode(s) | `geokdbush` kNN géo pour nœuds ; API `nearestNodes` vectorisée | `geokdbush`, `kdbush` | S | ⭐⭐⭐ |
| P0-9 | `shortestPath` + `routeToFeature` | Dijkstra/A* sur le graphe ; poids `length`/`travelTime` | `graphology-shortest-path` (+ `ngraph.path` option perf) | S | ⭐⭐⭐ |
| P0-10 | `fitAffineRansac` + `pageToWorld` | géoréférencement GCP→affine RANSAC (port `georef.py`/`ransac.py`) — **primitive repo** | `ml-matrix` (lstsq) | M | ⭐⭐⭐ |

### Tier P1 — Capacités osmnx complètes + primitives repo

| # | Titre | Description | Libs | Effort | Valeur |
|---|---|---|---|---|---|
| P1-1 | `basicStats` + circuité + densités | toutes les clés de `basic_stats` (§3.5), aire via turf | `@turf/area`, `geographiclib-geodesic` | M | ⭐⭐⭐ |
| P1-2 | `addEdgeBearings` + `orientationEntropy` | caps + histogramme + entropie de Shannon | maison | S | ⭐⭐ |
| P1-3 | `addEdgeSpeeds/TravelTimes` | table vitesses par highway, parse maxspeed | maison | S | ⭐⭐ |
| P1-4 | `isochrone` | Dijkstra borné temps + hull (convex/concave + buffer) | `concaveman`, `@turf/buffer`, `@turf/union` | M | ⭐⭐⭐ |
| P1-5 | `nearestEdge(s)` | index bbox segments + distance point-segment | `flatbush`/`rbush` | M | ⭐⭐ |
| P1-6 | `streetIntersections` + `normalizeStreetName` | union par nom + intersection par paire (port `osm_intersections.py`) — **primitive repo** | `jsts` (overlay robuste, STRtree) | M | ⭐⭐⭐ |
| P1-7 | `matchBoundary` (PCA+IoU+ICP/Umeyama) | port `boundary_match.py` (déterministe, IoU 0.996) — **primitive repo** | `ml-matrix` (SVD), `jsts` (IoU) | L | ⭐⭐⭐ |
| P1-8 | `assignLotsToZones` + `buildZonesFromLots` | plus-proche-étiquette en mètres + ST_Union par code (port `build_zones.py`/`p3_cascade_join.py`) — **primitive repo** | `jsts` (union), `geokdbush` | M | ⭐⭐⭐ |
| P1-9 | I/O GeoPackage + FlatGeobuf | export sans GDAL natif | `@ngageoint/geopackage`, `flatgeobuf` | M | ⭐⭐ |
| P1-10 | GraphML round-trip | save/load (format de référence osmnx, interop) | maison / `graphology-graphml` | M | ⭐⭐ |
| P1-11 | `truncate*` + `largestComponent` | sous-graphes + composantes connexes | `graphology-components`, `@turf/boolean-point-in-polygon` | S | ⭐⭐ |
| P1-12 | `featuresFrom*` (POI/bâtiments) | requêtes tags → GeoJSON | `osmtogeojson` | S | ⭐⭐ |
| P1-13 | Élévation raster + grades | `sampleDem` (geotiff, bilinéaire) + `addEdgeGrades` | `geotiff` | M | ⭐⭐ |

### Tier P2 — Ambitieux / différenciation

| # | Titre | Description | Libs | Effort | Valeur |
|---|---|---|---|---|---|
| P2-1 | `simplifyGraph` (geometry-preserving) | **GAP osmnx** : suppression nœuds interstitiels, fusion arêtes, LineString réelle préservée | maison | L | ⭐⭐⭐ |
| P2-2 | `consolidateIntersections` | **GAP osmnx** : buffer projeté + union + clustering + rebuild | `@turf/buffer`, `martinez`/`jsts` | L | ⭐⭐⭐ |
| P2-3 | `extractVectorPaths` PDF | **GAP Node** : interpréteur OPS.constructPath + CTM + layer stack (port `extract_contour.py`) — **primitive repo** | `pdfjs-dist` | L | ⭐⭐⭐ |
| P2-4 | Viz canvas (plotGraph/Route/FigureGround/Orientation/Footprints) | **GAP partiel** : pipeline d3-geo→canvas→PNG | `d3-geo`, `@napi-rs/canvas`, `d3-shape` | L | ⭐⭐ |
| P2-5 | `kShortestPaths` (Yen) | **GAP** : Yen sur Dijkstra | maison | M | ⭐⭐ |
| P2-6 | Centralité & communautés | betweenness/closeness/eigenvector + Louvain (osmnx s'appuie sur NetworkX) | `graphology-metrics`, `graphology-communities-louvain` | S | ⭐⭐ |
| P2-7 | Builder offline PBF | gros extraits Québec sans Overpass | `osm-pbf-parser-node`/`@osmix/pbf` | M | ⭐⭐ |
| P2-8 | Streaming graphes massifs | partition par tuiles, indices sérialisables (flatbush) | `flatbush` | L | ⭐⭐ |
| P2-9 | H3/agrégation hexagonale | binning de stats par hexagone | `h3-js` | S | ⭐ |

---

## 5. GAPS critiques Node (opportunités de différenciation)

1. **Builder OSM → graphe routable analysable** — *rien de mature* en Node (`@osmix/router` = WIP pré-alpha, `node-osmium` mort, OSRM = moteur opaque). **C'est LE socle** : celui qui le fait bien devient la référence. (P0-4)
2. **`simplify_graph` + `consolidate_intersections`** — *aucune* lib Node ne consolide les intersections ni ne simplifie un graphe en préservant la géométrie. Cœur de la valeur morphologique d'osmnx → différenciation pure. (P2-1, P2-2)
3. **Géoréférencement documentaire (GCP→affine RANSAC, boundary-match PCA+ICP/Umeyama, extraction de contours PDF, lot↔zone)** — *totalement absent* de l'écosystème Node ; **nous le possédons déjà** (scripts repo). C'est notre moat unique vs osmnx lui-même. (P0-10, P1-6/7/8, P2-3)
4. **Viz « matplotlib-like » + figure-ground** — pas de lib unique ; il faut composer `d3-geo` + `canvas`/`sharp`/`resvg`. Figure-ground morphologique = différenciateur urbain. (P2-4)
5. **Robustesse overlay « OverlayNG »** — `jsts` n'a que l'overlay legacy ; pas d'OverlayNG en JS. Mitigation : `jsts` snap-rounding + `IsValidOp` + `martinez` pour la vitesse. Reste un GAP de robustesse à surveiller sur gros polygones cadastraux.

GAPS secondaires : k-shortest-paths (Yen), client Nominatim typé maintenu, écriture PMTiles pure-JS, extraction PDF haut-niveau de chemins vectoriels (à construire sur `pdfjs-dist`), SVD (réglé par `ml-matrix`).

---

## 6. Risques & décisions d'architecture (à trancher)

### Décisions structurantes (3 majeures)

1. **Backend du modèle de graphe : `graphology` vs `ngraph` vs maison.**
   - `graphology` : multigraphe + attributs riches + écosystème metrics/communities/components/shortest-path → couvre presque tout osmnx « gratuitement ». Plus lourd en mémoire.
   - `ngraph` : routing le plus rapide (NBA*), mais pas de métriques, objet de graphe pauvre.
   - **Recommandation** : `StreetGraph` = façade typée **sur `graphology`** (P0-1), avec un **adaptateur `ngraph`** optionnel pour le routing perf (P0-9). On évite de réimplémenter un multigraphe, on garde une API stable indépendante du backend.

2. **Stack géométrie : `@turf/*` vs `jsts` vs `martinez`.**
   - `@turf/*` (déjà dans le repo) : ergonomie GeoJSON, mesures, hulls, voronoï — mais overlay non robuste (wrappe `polygon-clipping`).
   - `jsts` : seul vrai analogue Shapely/GEOS (buffer réel, validité, STRtree, prepared geometries, polygonize) — mais lent, types `@types/jsts` en retard.
   - **Recommandation** : **`jsts` pour le cœur robuste** (union/intersection cadastrale, IoU boundary-match, buffer consolidation, validation, STRtree) ; **`@turf/*` pour helpers/mesures/hulls** ; **`martinez`** quand l'overlay doit être rapide. Encapsuler derrière une couche `geom/` interne pour pouvoir swapper.

3. **Mémoire & échelle sur gros graphes (province de Québec) : tout-en-RAM vs streaming/tuiles.**
   - osmnx est mono-machine RAM ; un graphe « drive » d'une grande ville tient, mais une province non.
   - **Recommandation** : **API métier en RAM** (parité osmnx) + **chemin d'acquisition par tuiles/bbox** et **builder PBF offline** (P2-7) pour les gros extraits ; indices **sérialisables** (`flatbush`) pour requêtes spatiales sans tout recharger (P2-8). Trancher tôt le format de persistance graphe (GraphML interop vs FlatGeobuf nœuds/arêtes perf).

### Risques

- **Robustesse numérique overlay** (slivers, auto-intersections cadastrales) : `jsts` legacy ≠ OverlayNG → prévoir `buffer(0)`/`makeValid`/snap-rounding systématiques (le code Python du repo le fait déjà : `buffer(0)`, `make_valid`).
- **Projection & UTM** : `lstsq`/`ml-matrix` pur-JS lent sur grandes matrices — OK pour affine 3×3 et Umeyama (SVD 2×2/3×3), à surveiller si on vectorise massivement.
- **Dépendances natives** : viser **pur-JS/WASM** (serverless, Alpine) — `@ngageoint/geopackage` (WASM) OK ; **éviter `gdal-async` en dépendance dure** (le réserver à un adaptateur optionnel `acquire/gdal` déjà présent).
- **Déterminisme** : les primitives repo (RANSAC seedé, ICP, nearest-label) sont déterministes ; **préserver le seed** et documenter la tolérance (résidus en mètres) pour reproductibilité.
- **Types tiers en retard** (`@types/jsts`, `utm`) : prévoir des shims internes `.d.ts`.
- **Endpoint Overpass / rate-limit** : risque de blocage en CI/prod → cache disque obligatoire (P0-2) + endpoint configurable + fallback PBF.

---

### Annexe — correspondance scripts repo → tickets

| Script repo | Primitive | Ticket |
|---|---|---|
| `rosemere/georef.py`, `saint-mathieu/ransac.py` | GCP→affine RANSAC | P0-10 |
| `rosemere/osm_intersections.py` | intersections de rues par nom | P1-6 |
| `petite-riviere-saint-francois/boundary_match.py` | PCA+IoU+ICP/Umeyama | P1-7 |
| `saint-mathieu/build_zones.py`, `stcath/lot_zone.py`, `…/fusion/p3_cascade_join.py` | lot↔zone (nearest-label + ST_Union) | P1-8 |
| `saint-raymond/extract_contour.py` | extraction chemins vectoriels PDF | P2-3 |
| `rosemere/build_geojson.py`, `stcath/label_in_zone.py` | normalisation codes + point-in-zone (truth) | P1-8 |
| `*/muni_geom.ql`, `*/overpass.ql` | requêtes Overpass (area/bbox) | P0-2 |
