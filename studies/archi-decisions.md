# Décisions d'architecture `@sentropic/geo` — double revue 4.8max ⊕ 5.5xhigh

> Statut : **arbitré**. Chaque décision a été produite côté Opus 4.8 (à partir des deux études) puis
> confrontée à une critique indépendante GPT‑5.5 (xhigh) ancrée dans le vrai repo `~/src/geo`.
> Format : *Contexte · Position 4.8 · Critique 5.5xhigh · **Décision retenue** · À creuser*.
> Baseline geo : branche `feat/cadre-acquisition` @ `6904d36`.

Contraintes produit (non négociables, données par le PO) :
- 100% TypeScript ; **Rust uniquement** pour hot paths (napi‑rs/WASM) ; **jamais de Python** (le `work/` Python de `geo-quebec` est du legacy à porter, pas une solution sanctionnée).
- Viz **WebGL** en réutilisant/poussant `@sentropic/graph` (graphify).
- IA **multi‑modèles** : OCR/lecture = **Mistral** ; raisonnement/arbitrage = **panel GPT‑5.5(xhigh) + Opus 4.8(max)**.
- Éco **compute‑only** + cache mutualisé content‑addressed.
- Tracking = outil maison **`track`** ; WP segmentés pour ne **pas** perturber l'immo en cours.

Faits repo découverts pendant la revue (corrigent les études écrites depuis `geo-quebec`) :
- `@sentropic/geo` = couche **données** (`acquire / api / catalog / normalize / storage / cli`) — pas encore d'analyse.
- `acquisition/src/lib/geo.ts` a déjà des **ports TS fidèles** (équivalent GEOS `representative_point` recodé pour parité Shapely). `parquet.ts`, `s3.ts`, `zonage-norms.ts` existent. **`mistral-ocr` déjà en dépendance.**
- `INVENTAIRE-scraping-qc.md` : l'archi data est **déjà shards / Parquet / PMTiles / PostGIS** (après OOM constatés).
- `packages/geo/.../storage/store.d.ts` = `Store` **key→bytes** (pas un CAS). `geo-core/.../source-manifest.d.ts` porte **licences/redistribuabilité**. `api/providers/postgis-provider.d.ts` = skeleton OGC read.
- `BENCH-OCR.md` : routage **Mistral OCR** vs vision selon type de grille ; 0 Anthropic/OpenAI dans ce chemin.

---

## A1 — Backend du graphe routier OSM
**Contexte.** osmnx = `MultiDiGraph` en RAM. Faut‑il mutualiser le stockage graphe avec graphify ?
**Position 4.8.** Façade `StreetGraph` typée sur `graphology` (metrics/components gratuits) + adaptateur `ngraph` pour le routing perf.
**Critique 5.5xhigh.** `GraphStore` de graphify est un **miroir poussé** (`.graphify/graph.json` reste la source de vérité), **sans spatial** ; `@sentropic/graph` ne consomme que des **buffers de rendu**. Un graphe routier a CRS, multi‑arêtes, géométries, poids, index spatial, staleness data → **autre contrat**. `graphology` peut exploser en RAM à l'échelle province.
**Décision retenue.** `StreetGraph` **indépendant**, API TS stable ; backend `graphology` **uniquement en mode parité ville/bbox**, pas comme store durable province. **Pas** de mutualisation du store avec graphify ; graphify n'est qu'une **cible d'export viz** (`@sentropic/graph`). Le store province est un contrat séparé `StreetGraphStore` (columnar/PostGIS, cf. A8).
**À creuser.** Bench RAM `graphology` vs colonnes typed‑array sur PBF Québec ; contrat minimal `StreetGraphStore`.

## A2 — Stack géométrie
**Position 4.8.** `jsts` comme « cœur robuste » + `@turf` helpers + `martinez` overlay rapide.
**Critique 5.5xhigh.** `jsts` n'a que l'overlay **legacy** (≠ OverlayNG) — l'étude l'admet elle‑même → ce n'est pas le cœur robuste, c'est un **fallback**. Le repo a déjà dû recoder un GEOS `representative_point` pour parité.
**Décision retenue.** **`GeometryKernel` interchangeable** derrière une couche `geom/` : `@turf`/`proj4` pour helpers/mesures simples ; **GEOS‑WASM (ou GEOS via napi‑rs)** pour overlay/buffer/validité/polygonize robustes ; `martinez` **seulement** derrière golden tests ciblés. `jsts` = option de compat, pas le défaut.
**À creuser.** Corpus de polygones pathologiques QC → matrice précision/temps `jsts` vs GEOS‑WASM vs napi‑GEOS vs `martinez`.

## A3 — Mémoire & échelle
**Position 4.8.** API métier en RAM (parité osmnx) + acquisition par tuiles + builder PBF offline.
**Critique 5.5xhigh.** Le repo est **déjà** passé à shards/lazy/PMTiles/PostGIS **après OOM**. La RAM ne doit pas devenir le chemin province.
**Décision retenue.** **Deux niveaux explicites.** (1) **RAM** = mode ville/bbox, parité osmnx. (2) **Province** = shards/tuiles + **colonnes** (typed arrays / Rust) + index spatiaux **sérialisés** (`flatbush`). La parité osmnx est un **mode**, pas l'architecture d'échelle.
**À creuser.** Seuils chiffrés (ville/MRC/province), temps build PBF, mémoire/edge JS vs Rust, routage inter‑tuile + dédup aux frontières.

## A4 — Visualisation
**Position 4.8.** Réutiliser le renderer `@sentropic/graph` (Canvas2D→WebGL) + pont Mercator.
**Critique 5.5xhigh.** D'accord, mais **garder MapLibre/PMTiles** pour basemap + tuiles polygonales (déjà servies par geo) ; **éviter deck.gl** comme renderer graphe principal puisque le PO impose de pousser `@sentropic/graph`. Le WebGL graphify manque encore thick/dashed/curved edges, picking, labels.
**Décision retenue.** Nouveau package **`@sentropic/graph-geo`** = pont projection Mercator/y‑down + clipping viewport + hit‑testing spatial au‑dessus de `@sentropic/graph` ; **on pousse le WebGL MVP de graphify upstream** (pas de fork). **MapLibre + PMTiles** pour le fond de carte et les couches polygonales. Pas de deck.gl.
**À creuser.** Sync caméra carte↔graphe ; bench 100k nœuds / 200k arêtes WebGL.

## A5 — Frontière Rust
**Position études.** « Tout en TS pur » (Turf/geos‑wasm/jsts + proj4).
**Critique 5.5xhigh.** L'**API** doit être TS, mais **PBF/routing province sont de vrais hot paths Rust**. FFI par appel tue les gains → Rust pour le **bulk**, pas pour des petites matrices 2D.
**Décision retenue.** **Règle de promotion** : impl TS d'abord + golden + perf ; on promeut en Rust **seulement** si gain attendu **>2–3×** sur du bulk (typed arrays) **ou** si JS ne tient pas en RAM. Candidats Rust prioritaires : **build PBF→colonnes**, **routing adjacency bulk**, puis **simplify/consolidate** après profiling. Overlay = GEOS natif/WASM. RANSAC/ICP restent TS tant qu'ils sont rapides. `napi‑rs` pour le serveur, WASM pour portabilité serverless/navigateur.
**À creuser.** Build matrix napi‑rs ; uniformité WASM threads/SIMD.

## A6 — Couche IA multi‑modèles
**Position études.** Workers TS appelant « l'API Claude ».
**Critique 5.5xhigh.** Viole l'exigence multi‑modèles et sous‑utilise **Mistral** (déjà en dépendance, déjà benchée pour l'OCR). Le raisonnement multi‑modèles doit intervenir en **validation/ambiguïté**, pas remplacer l'OCR.
**Décision retenue.** **`ModelRouter` par capacité** : `ocr|read` → **Mistral** ; `reason|adjudicate` → **panel GPT‑5.5(xhigh) + Opus 4.8(max)** avec quorum + tie‑break + **citation obligatoire** ; sorties **toujours schématisées (zod)** et **validées par moteurs déterministes** (la géométrie tranche, pas le LLM). La **clé de cache IA inclut provider/model/prompt/schema** (cf. A7).
**À creuser.** Contrat d'arbitrage exact (quorum, départage, anti‑hallucination) ; budget coût/latence du panel.

## A7 — Cache compute‑only mutualisé
**Position études.** « Ne jamais refacturer un calcul déjà fait. »
**Critique 5.5xhigh.** Vrai **uniquement** pour un artefact **public, exact, immuable et licencié** ; faux pour un refresh data, un appel IA non déterministe, une licence privée, ou un recalcul à version différente. Le `Store` actuel est key→bytes, **pas** un CAS.
**Décision retenue.** **CAS à deux clés.** Clé **logique** déterministe = `op + algoVersion + dataRefs(versionnés) + params canoniques + runtime + modelRefs` → puis **`contentHash`** de l'artefact. Store **content‑addressed, immuable, dédupliqué**. **Composition à la Nix/Bazel** : un calcul de haut niveau référence les clés de ses sous‑résultats → recalcul minimal. **Frontière public/privé** : artefact public **ssi** tous inputs + dataRefs + algo + modèle sont publics et la **licence** (cf. `source-manifest`) l'autorise → servi à ~0 via CDN ; sinon privé/chiffré, **réutilise gratuitement les briques publiques**, seul le **delta privé** est facturé. `track` **référence** ces hashes (provenance), il ne les **remplace** pas. La promesse n'est pas « prix=0 absolu » mais **« règle de cache prouvable »**.
**À creuser.** Quantization géométrique (change le hash) ; registre de provenance anti‑poisoning ; couverture des coûts fixes.

## A8 — Persistance & IO
**Position études.** GraphML comme « format de référence osmnx ».
**Critique 5.5xhigh.** L'interop n'est pas le pivot de prod ; le repo produit **déjà** Parquet + PMTiles, et a un provider PostGIS.
**Décision retenue.** **Pivot perf** = **GeoParquet/FlatGeobuf** pour `street_nodes`/`street_edges` + **PMTiles** pour la diffusion carto + **PostGIS** pour les requêtes spatiales. **GraphML** = **import/export de parité osmnx uniquement**. Schéma canonique `street_nodes`/`street_edges` à définir (multigraphe + géométrie + attributs).
**À creuser.** Convention adjacency en GeoParquet ; round‑trip GraphML/FlatGeobuf/GeoParquet sur fixtures osmnx.

## A9 — Parité du port Python→TS(+Rust)
**Position études.** « Golden tests ».
**Critique 5.5xhigh.** Insuffisant : il manque **budgets perf versionnés**, **fixtures de non‑régression numérique**, et le contrat **« aucun Python runtime »** (sinon on réintroduit Python en CI). Risque : figer un bug Python dans la golden ; tolérances flottantes trop larges ; perf machine‑dépendante ; peering LLM qui rationalise sans oracle.
**Décision retenue.** **Harnais golden sans runtime Python** : fixtures héritées **figées** (générées une fois, committées), sorties TS/Rust comparées en **tolérances strictes** documentées, **budgets perf versionnés par op + mémoire**, **rétroportage en peering complet** (chaque primitive a son oracle figé), revue d'écart **pairée GPT‑5.5/Opus 4.8**. Corpus minimal : **5 graphes osmnx, 20 géométries pathologiques, 3 communes QC, 1 extrait PBF de MRC**.
**À creuser.** Génération one‑shot des oracles ; seuils perf par machine de référence.

---

## Synthèse — 3 bascules structurantes vs les études
1. **graphify fournit le renderer (WebGL) et reçoit des exports — pas le store routier.** Son `GraphStore` est un miroir sans spatial ; le store routier est un contrat séparé (A1, A8).
2. **Pas de « cœur robuste jsts ».** `GeometryKernel` mesuré, GEOS‑WASM/napi + Rust là où parité+perf l'exigent (A2, A5).
3. **Compute‑only = règle de cache prouvable, pas promesse économique absolue.** Gratuit ⇔ artefact public, exact, immuable, licencié (A7).
