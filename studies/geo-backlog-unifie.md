# Backlog unifié `@sentropic/geo` — osmnx‑en‑Node ⊕ Cityweft OSS

> Fusion des deux études (`osmnx-node-backlog.md` + `cityweft-opensource-rebuild.md`), réconciliée par la
> double revue **4.8max ⊕ 5.5xhigh** (cf. `archi-decisions.md`). Objectif : faire de `@sentropic/geo`
> **la référence Node/TS du géospatial**, et rebâtir Cityweft en **full open source** sur ce socle, avec
> un moteur **compute‑only mutualisé**. Cible : **projets immobiliers**.

## 0. Principe de segmentation (ne pas perturber l'immo)
L'immo vit dans `~/src/geo` : workspace `track` plat (**2094 TO‑DO + 126 DONE** : `zones/agol-account · muni`,
`normes/pdf-native · muni`) et `work/immo-audit`, `work/zonage-norms`, `work/coverage`. **Ces zones sont gelées
pour ce backlog.** Le travail lib va dans un **workspace track séparé** (`geo-lib`) et **uniquement** sous
`packages/**` (nouveaux packages). **Scope interdit** : `work/**`, le pipeline d'acquisition immo, les items
`zones/*` et `normes/*`. Aucun reparentage d'items existants.

## 1. Carte des packages (extension, pas réécriture)
Existant : `@sentropic/geo` (`acquire/api/catalog/normalize/storage/cli`) · `@sentropic/geo-core` (modèle GeoJSON typé, proj4, turf, manifests+licences) · `geo-sources-*` · `geo-ui-svelte`.

Nouveaux modules/packages :
| Package / module | Rôle | Réutilise |
|---|---|---|
| `geo-core/geom` (`GeometryKernel`) | overlay/buffer/validité/polygonize robustes, swappable | turf, proj4, **GEOS‑WASM**, martinez |
| `@sentropic/geo-graph` | `StreetGraph` (modèle + algos osmnx) | graphology (parité), ngraph (route), flatbush |
| `@sentropic/geo-graph-native` (opt.) | hot paths Rust (PBF→colonnes, routing bulk) | napi‑rs / wasm |
| `@sentropic/geo-georef` | géoréf documentaire (le **moat**) | GeometryKernel, ml-matrix, pdfjs‑dist |
| `@sentropic/geo-immo` | analyses immo (constructibilité, isochrones, due diligence, context3D) | geo-graph, geom, terrain |
| `@sentropic/graph-geo` | pont WebGL (Mercator/y‑down, clip, picking) | **`@sentropic/graph`** (graphify) |
| `@sentropic/geo-ai` | `ModelRouter` (Mistral OCR · panel 5.5+4.8) | mistral-ocr (déjà présent) |
| `@sentropic/geo-cache` | CAS compute‑only mutualisé | source-manifest (licences), track (provenance) |

## 2. Backlog par lots (= arbre WP track proposé)
Priorité **P0** (fondations) · **P1** (référence osmnx + immo) · **P2** (ambition). Effort **S/M/L**.
`[GAP]` = rien de mature en Node. `[Rust?]` = candidat promotion Rust (règle A5). `[moat]` = différenciation unique.

### LOT 0 — Fondations & contrats *(P0, transverse)*
- **WP0.1** `GeometryKernel` : interface + adapters turf/proj4 + GEOS‑WASM ; corpus golden géométrie. — L
- **WP0.2** `StreetGraph` : modèle (multigraphe dirigé, CRS, géométries, poids) + contrats sérialisation. — M
- **WP0.3** **Harnais de parité** (golden fixtures figées, **zéro runtime Python**, **budgets perf**, peering). — L · *gate de tous les ports*
- **WP0.4** `ModelRouter` skeleton (routage capacité : ocr→Mistral, reason→panel 5.5+4.8 ; sorties zod). — M
- **WP0.5** `geo-cache` CAS skeleton (clé logique 2 niveaux + contentHash ; frontière public/privé). — M

### LOT 1 — OSM ingestion & graphe (cœur osmnx) *(P0→P1)*
- **WP1.1** Client Overpass + cache ; `osmtogeojson`. — S
- **WP1.2** **Builder OSM→`StreetGraph`** (highway parsing, networkType drive/walk/bike, retainAll, truncateByEdge). — L `[GAP]` `[Rust?]`
- **WP1.3** `graphFromPlace/Point/Bbox/Polygon/Address` (geocoding Nominatim). — M
- **WP1.4** Projection + **UTM auto** ; `graph⇄features` (≈ graph_to_gdfs). — M
- **WP1.5** Index spatial + `nearestNode(s)` (kNN géo, flatbush/geokdbush). — S
- **WP1.6** Routing `shortestPath` + `routeToFeature` (graphology + adapter ngraph NBA*). — M
- **WP1.7** **`simplify_graph` + `consolidate_intersections`** (buffer projeté + union + clustering + rebuild). — L `[GAP]` `[Rust?]`
- **WP1.8** Stats morpho : street density, circuity, intersection count, centralité/betweenness. — M
- **WP1.9** **Builder PBF offline** (échelle province, colonnes). — L `[Rust?]`

### LOT 2 — Géoréf documentaire *(P1, [moat] — port du `work/` Python)*
> Ce que ni osmnx ni Cityweft ne font. Source = scripts `geo-quebec/work/*` (georef.py, boundary_match.py, extract_contour.py, build_zones.py, lot_zone.py) **à porter en TS(+Rust), jamais exécuter en Python**.
- **WP2.1** `fitAffineRansac` + `pageToWorld` (GCP→affine RANSAC, IRLS Tukey ; port `georef.py`/`ransac.py`). — M `[moat]`
- **WP2.2** Boundary‑match PCA + ICP/Umeyama + garde‑fous IoU/résidu/Hausdorff (port `boundary_match.py`). — M `[moat]`
- **WP2.3** Extraction contours & **glyphes/texte positionnés** PDF (pdfjs OPS.constructPath ; noms de rues, codes de zone). — L `[moat]`
- **WP2.4** Reconstruction de **polygones de zones** depuis maillage de bordures (triangles→murs→polygonize→faces→PIP). — L `[moat]`
- **WP2.5** Association **lot↔zone** (nearest‑label + ST_Union). — M `[moat]`

### LOT 3 — Analyse immo (rebuild Cityweft+) *(P1→P2)*
- **WP3.1** Terrain/DEM : COG, mesh, pente, déblai/remblai, drapage. — L
- **WP3.2** **Enveloppe constructible** : setbacks/offset, hauteur max, COS/CES/FAR, plancher, nb logements. — L (cœur immo)
- **WP3.3** **Isochrones/accessibilité** sur le `StreetGraph` (speed/travel‑time). — M
- **WP3.4** Subdivision foncière + **overlay de contraintes** (due diligence). — L
- **WP3.5** Générateur **context3D** + exports multi‑format (GeoJSON/glTF/IFC/3DM) — parité Cityweft. — L
- **WP3.6** **Scoring de site** (synthèse pondérée). — M

### LOT 4 — Viz WebGL (réutilisation graphify) *(P1)*
- **WP4.1** `@sentropic/graph-geo` : pont projection Mercator/y‑down, clipping viewport, hit‑testing spatial. — M
- **WP4.2** **Pousser le WebGL upstream** dans `@sentropic/graph` (thick/dashed/curved edges, labels, picking). — L (contrib graphify)
- **WP4.3** Intégration **MapLibre + PMTiles** (basemap + couches polygonales). — M

### LOT 5 — Persistance/IO & économie compute *(P1→P2)*
- **WP5.1** Schéma columnar `street_nodes`/`street_edges` (**GeoParquet/FlatGeobuf**) + **PMTiles** diffusion + **PostGIS** requêtes. — L
- **WP5.2** Import/export **GraphML** (parité osmnx uniquement). — S
- **WP5.3** `geo-cache` complet : CAS immuable, **frontière public/privé** (via `source-manifest` licences), provenance anti‑poisoning, **référencement des hashes dans `track`**. — L
- **WP5.4** Cache du `ModelRouter` (clé incluant **provider/model/prompt/schema**). — M

### LOT 6 — IA documentaire *(P1)*
- **WP6.1** Pipeline **Mistral OCR** plans/PDF de zonage (étend `mistral-ocr` + `BENCH-OCR`). — M
- **WP6.2** Extraction **règlement de zonage** (NL→structuré) avec **panel 5.5+4.8** d'arbitrage + citations. — L
- **WP6.3** Synthèse de **rapports** de site. — M

## 3. Le plus court chemin vers la valeur immo
Cityweft génère un **contexte 3D** mais **pas** de zonage/faisabilité — c'est là qu'on gagne. Chemin critique
immo : **WP0.1 → WP1.1‑1.6 → WP2.1‑2.5 → WP3.2/3.3 → WP6.1‑6.2 → WP3.5/3.6**. Les LOT 4/5.3/5.4 industrialisent
(viz + cache mutualisé) une fois la valeur prouvée.

## 4. Stratégie de parité (rétroportage en peering complet)
Gate = **WP0.3**. Pour chaque primitive portée : (1) oracle figé généré une fois et committé ; (2) test à
parité TS/Rust en tolérances strictes documentées ; (3) **budget perf versionné** (temps/op + mémoire) ;
(4) revue d'écart **pairée 5.5/4.8** ; (5) **aucun runtime Python** en CI. Corpus minimal : 5 graphes osmnx,
20 géométries pathologiques, 3 communes QC, 1 extrait PBF de MRC.

## 5. Proposition de mapping `track`
- **Workspace** : `geo-lib` (distinct de l'immo).
- **Lots** = WP racines (LOT 0…6) ; **WP x.y** = work packages feuilles.
- **Scope déclaré** : `allowed = packages/**` (+ nouveaux packages) ; `forbidden = work/**`, acquisition immo, items `zones/*`/`normes/*`.
- Import via `track branch import plan/01-BRANCH_geo-lib.md` **après validation du format BRANCH** et **GO** du PO.
