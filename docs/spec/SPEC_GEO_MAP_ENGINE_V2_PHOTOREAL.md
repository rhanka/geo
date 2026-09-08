# SPEC — geo-map-engine v2 photoréel 3D (tileset-3d · terrain · drape) — TRACK DIFFÉRÉ (roadmap)

> **Statut : AUTHORING d'un track SÉPARÉ — PAS ratifié, PAS gelé.** Décision geo-cond
> 2026-08-31 : le photoréel v2 est **splitté** (le fond satellite **2D** part d'abord et seul,
> `SPEC_GEO_MAP_ENGINE_V2_BASEMAP_2D.md`, v2.0). Le **3D photoréel** ci-dessous est un **track
> distinct**, avec son **propre PR** et son propre **mini-gate wp7** avant gel.
>
> **Passe d'authoring 3D (2026-09-08, geo-cond GO owner-relayé).** Ce document est passé de
> « liste de blockers » à un **DRAFT DE CONTRAT** (types 3D gravés ci-dessous, §« Contrat 3D »)
> pour que **geo-socle (wp7)** buildé le renderer contre des types nommés. **Contraintes en vigueur** :
> **DEV-ONLY · PR held · 0 ratification · 0 gel · 0 préprod · 0 clé/secret · 0 ressource cloud.**
> Le **build renderer + le mini-gate + le GEL du contrat 3D restent SÉQUENCÉS après clôture §5 2D
> + GO owner** (contrainte owner « 3D = track distinct après clôture §5 2D »). Le contrat 3D **gèle
> SUR PREUVE au mini-gate**, jamais avant (doctrine ADR-0026 « gel gagné sur preuve »).
>
> **Fondation (GELÉE, buildable maintenant)** : le track 3D **réutilise** `RasterSource` /
> `AttributionSpec` / `SourcePolicy` / `onError` **du contrat 2D v2.0** (déjà reworkés) + le **seam
> neutre v1** (ADR-0026, prouvé 3D-satisfiable sur le spike deck.gl `b67eb222` — équivalence caméra
> 2D↔3D, zoom normalisé, round-trip). Il n'y a donc **pas** à re-graver l'attribution dynamique, la
> policy fail-closed, ni le canal d'erreur : ils sont **hérités**.

## Décision owner (rappel)

**VOIE A = Google Photorealistic 3D Tiles** (2026-08-31, photoréel sub-mètre, câblage rapide). Le
contrat reste **renderer-neutre** (kind `tileset-3d` abstrait) pour que la voie OPEN
(Sentinel-2/DEM/OSM → PMTiles) reste exprimable **sans changer le contrat**.

## Périmètre du track 3D + blockers fable-5 (INPUT de la passe d'authoring)

- **`tileset-3d`** (→ deck `Tile3DLayer`, le photoréel Google). Blockers :
  - **B1** — **déclarer l'appartenance d'union** : `tileset-3d` = **LAYER** (a `id`, interactivité) ;
    et **graver l'interaction avec `BasemapSpec`** — en v2.0-3D, un `tileset-3d` **full-scene** (Google =
    sol+terrain+bâtiments en une tileset) **impose `basemap: blank`** (fail-closed sinon) ; l'overlay-tileset
    (bâtiments seuls sur un basemap) = différé.
  - **S2** — **pinner le format** : OGC **3D Tiles 1.0/1.1** (nommer un standard ouvert ≠ nommer un provider).
  - **S3** — **retirer `interactivity` (hover/select)** de `tileset-3d` v2.0 : le mesh Google est fusionné,
    **sans featureId** — `GeoFeatureHit` (surface.ts:15) exige `layerId+featureId+properties`, insatisfiable.
    (Variante hit position-seule = différée.)
- **`terrain`** (DEM → deck `TerrainLayer`, voie open / relief non-Google). Blockers :
  - **B2** — la composition open **raster+terrain est inexprimable** : `BasemapSpec` est mono-membre, et
    `TerrainSpec` esquissé n'a **pas de texture à draper** (→ relief gris, pas de Sentinel-2). **Fix** :
    `TerrainSpec.imagery?: RasterSource` (le relief porte son imagerie drapée), de sorte que « terrain =
    relief + satellite drapé » soit un **seul** membre de basemap cohérent.
- **B7** — **caméra avec terrain** : v1 §1.5.1 grave « pas de terrain ; entrée explicite + versionnée ».
  Écrire un **§1.5.1-bis** : ancrage `center/zoom` (au géoïde z=0, stable quel que soit le relief),
  `exaggeration` = état **terrain** (transportable avec le basemap, **pas** un état caméra), `pitchMax`
  photoréel (> 60°), et ce que **préserve exactement** le round-trip 2D(plat)↔3D(terrain). **Non
  différable** : la tileset Google embarque le relief dès le jour 1. Idéalement **re-prouvé par mini-gate**.
- **B8** — **drape / occlusion des couches vecteur sur le mesh 3D** : **le S9 ratifié en dépend**
  (`SPEC_GEO_ENV_CONSTRAINTS_S9 §4` : « 3D = DRAPE SEULEMENT », z-order pinné `[grhq, bdzi, cptaq]`). Une
  couche `choropleth/geojson` v1 plate (z=0) sous un mesh dont le sol est à 30–200 m est **enterrée/occluse**.
  **Fix** : graver la composition couche-vecteur-sur-surface-3D (drape via l'extension terrain deck, encore
  expérimentale) **OU** la différer **explicitement fail-closed** (« couches vecteur + `tileset-3d` simultanés
  = non supporté v2.0-3D, refus ») — **pas le silence**. Comme l'owner veut les contraintes **sur** la carte
  photoréelle, le **mini-gate wp7 tranche** : drape réel prouvé sur tileset Google réelle, sinon repli
  documenté (contraintes rendues en 2D/terrain).
- **S1** — v1 gravait `terrain?`/`sky?` comme **CHAMPS** additifs de `BasemapSpec` (basemap.ts:15) ; le
  track 3D les livre en **KINDS** → **superséder explicitement** le forward-path v1 (une ligne + ADR).
- **S9** — graver l'héritage WebMercator (pas de globe) ; Tile3DLayer sous MapView à l'échelle ville.

## Contrat 3D — types gravés (AUTHORING ; gel au mini-gate sur preuve)

> **Sketch de types, provider-neutre, additif.** Résout chaque blocker ci-dessus. **NON gelé** : les
> valeurs/mécanismes exacts sont **prouvés/tranchés au mini-gate wp7** (doctrine « gel gagné sur preuve »).
> geo-socle (wp7) build contre ces noms ; on co-règle au fil de la preuve.

### C1 — Extension de `BasemapSpec` : `tileset-3d` et `terrain` en KINDS (résout S1)

v1 gravait `terrain?`/`sky?` comme **CHAMPS** de `BasemapSpec` (`basemap.ts:15`). Le track 3D les livre
en **KINDS additifs** du membre basemap — **exactement le pattern `raster-source` du 2D v2.0** (additif
pur, les membres v1 `blank`/`raster`/`vector` **inchangés**). ⟹ **supersede explicite** du forward-path
v1 `terrain?`/`sky?` (une ligne dans `basemap.ts` + noté dans l'ADR au gel). Aucune rupture des membres v1.

### C2 — `Tileset3DSpec` (résout B1, S2, S3, S9)

```
Tileset3DSpec {
  kind: 'tileset-3d'
  id: string                       // B1 — LAYER identifiable dans l'union (pas un simple fond)
  format: '3d-tiles-1.0' | '3d-tiles-1.1'   // S2 — standard OGC ouvert, JAMAIS un nom de provider
  source: RasterSource             // hérité v2.0 — ABSTRAIT (l'adaptateur résout id→URL/clé/session) ; provider-neutre
  attribution: AttributionSpec     // hérité v2.0 — dynamique = copyrights par-asset agrégés des tuiles visibles
  policy: SourcePolicy             // hérité v2.0 — 'live-embed-only' pour Google (garde S3 + test CI)
  // S3 — PAS de `interactivity` (hover/select) en v2.0-3D : mesh fusionné sans featureId ;
  //      GeoFeatureHit (surface.ts:15) exige layerId+featureId+properties = insatisfiable.
  //      (variante hit position-seule = DIFFÉRÉE.)
}
```
- **B1 full-scene → `basemap: blank` imposé** : un `tileset-3d` full-scene (Google sol+terrain+bâtiments
  en une tileset) impose `basemap: blank` ; toute co-déclaration d'un autre membre basemap = **REFUS
  fail-closed** (pas de double-fond incohérent). L'overlay-tileset (bâtiments seuls sur basemap) = **différé**.
- **S9** : héritage **WebMercator** (pas de globe) ; `Tile3DLayer` sous `MapView`, échelle **ville**.

### C3 — `TerrainSpec` (résout B2)

```
TerrainSpec {
  kind: 'terrain'
  source: DemSource                // DEM abstrait (voie open / relief non-Google)
  imagery?: RasterSource           // B2 — le relief PORTE son imagerie drapée → "terrain = relief + satellite drapé" = UN membre basemap cohérent
  exaggeration?: number            // état TERRAIN (voir C4/B7), pas un état caméra
}
```
Distinct du full-scene Google (C2) : `terrain` = voie **open** (DEM + imagerie drapée), un seul membre
cohérent (fix du « relief gris sans texture »).

### C4 — Caméra §1.5.1-bis : terrain (résout B7 ; **non-différable**)

La tileset Google embarque le relief **dès jour 1** ⟹ ce §1.5.1-bis est requis avant tout build caméra 3D :
- **Ancrage** : `center`/`zoom` définis **au géoïde z=0** (stable quel que soit le relief sous le point).
- **`exaggeration`** = état **terrain** (transporté avec le basemap), **PAS** un état caméra.
- **`pitchMax` photoréel** : **> 60°** (v1 §1.5.1 refusait 61° sans terrain ; le 3D relâche cette borne).
- **Round-trip 2D(plat)↔3D(terrain)** — préserve exactement : `center`/`zoom` (géoïde) + `bearing`/`pitch`
  bornés ; `exaggeration` **hors-caméra** (état terrain). **Re-prouvé au mini-gate** (parité doctrine v1 §1.5.1).

### C5 — Drape des couches vecteur (résout B8) : **DÉFAUT fail-closed ; real-drape = UPGRADE gaté mini-gate**

> **Anti-invention** : cross-wire geo-socle (2026-09-08) = B8 **FALLBACK-probable mesuré** (le drape sur
> `Tile3DLayer` **mesh** n'est pas le chemin `_TerrainExtension`/heightmap documenté). On **ne grave donc
> PAS** une capacité de drape non prouvée. Le mini-gate tranche.

- **DÉFAUT gravé (fail-closed)** : couches vecteur (`choropleth`/`geojson`) **+ `tileset-3d` simultanés
  = NON SUPPORTÉ v2.0-3D → REFUS explicite** (via `onError`/refus déclaré). **Jamais** une couche plate
  (z=0) enterrée/occluse sous un mesh dont le sol est à 30–200 m ; **jamais le silence**. **Repli
  documenté** : les contraintes se rendent en **2D/terrain** (mode plat) tant que le drape n'est pas prouvé.
- **UPGRADE optionnel (gaté mini-gate)** : SI le mini-gate wp7 **prouve** le drape réel — couche zonage
  drapée **non-occluse** sur **vraie tileset Google**, z-order S9 `[grhq, bdzi, cptaq]`, **sémantique
  ADR-0033** (satellite/photoréel = transparent/contour, 0 aplat opaque) — ALORS le drape est gravé comme
  supporté. **Le mini-gate TRANCHE ; la capacité ne se grave qu'après la preuve** (ADR-0026).
- **Dépendance** : `SPEC_GEO_ENV_CONSTRAINTS_S9 §4` (S9 ratifié « 3D = DRAPE SEULEMENT ») **dépend de B8** ;
  sous fallback, S9 se rend en **2D/terrain** jusqu'à preuve drape.

## Règles de conformité — **héritées** du contrat 2D v2.0

Attribution (statique **ou dynamique**, rendue, refus fail-closed sur absence de mécanisme),
`policy` REQUISE + garde committée + test CI, `onError` + repli, clé/CSP = adaptateur : **déjà gravés**
en 2D v2.0 (§2–§3 de `SPEC_GEO_MAP_ENGINE_V2_BASEMAP_2D.md`). Le track 3D les **réutilise** — la tileset
Google 3D = `policy: "live-embed-only"` + `attribution: {mode:"dynamic"}` (copyrights par-asset agrégés
depuis les métadonnées des tuiles visibles).

## Mini-gate wp7 — critères d'acceptation (GEL SUR PREUVE)

> Preuve sur **tileset Google Photorealistic 3D Tiles RÉELLE** (pas mock). Consolidé pour geo-socle.
> Réfs héritées : `docs/ops/gcp-3dtiles/GATE.md §B` (intégration/licence), doctrine ADR-0026.

1. **Tileset 3D rend** : `Tile3DLayer` (deck) affiche le photoréel Google, échelle **ville**,
   **WebMercator/MapView** (S9), sous **`basemap: blank`** (B1 full-scene).
2. **B8 DRAPE = LE GATE DÉCISIF** : ≥1 couche zonage vecteur **drapée** sur le mesh 3D, **non-occluse**
   (z-order S9 `[grhq, bdzi, cptaq]`), **sémantique ADR-0033** respectée (satellite/photoréel =
   transparent/contour, **0 aplat opaque**). **SINON repli documenté explicite fail-closed** (C5 :
   « vecteur + `tileset-3d` simultanés = non supporté v2.0-3D, refus » — **jamais le silence**). Le
   mini-gate **tranche drape-réel vs repli** (geo-socle : fallback-probable).
3. **Attribution DYNAMIQUE rendue** : copyrights par-asset agrégés des tuiles visibles, **DOM-visible** ;
   `attributionControl:false` **INTERDIT** (hérité 2D v2.0).
4. **Policy `live-embed-only` prouvée** : garde committée + **test CI** refuse **tout octet d'imagerie 3D
   → S3** (pattern `assertVisionModelAllowed`) ; tuiles **browser→Google DIRECT**, 0 cache/proxy S3.
5. **Caméra+terrain (B7/C4)** : §1.5.1-bis prouvé — ancrage `center/zoom` au géoïde z=0 stable sous relief,
   `pitchMax`>60°, `exaggeration` = état terrain (pas caméra), round-trip 2D(plat)↔3D(terrain) préservé.
6. **`onError` + repli** : refus runtime (session/quota/clé) → repli déclaré, **jamais blanc silencieux**
   (hérité).
7. **DEV-ONLY jusqu'au GO owner** : PR held, flag OFF, **0 préprod, 0 clé/secret committé, 0 ressource
   cloud** ; budget owner-direct + **gate `docs/ops/gcp-3dtiles/` (budget cap prouvé AVANT clé, test-kill
   J = quota billable 0)** avant toute activation.

## Suite & ownership

- **Périmètre wp6 (geo-archi) = LE CONTRAT (neutre)** : ce draft + les règles + les critères mini-gate.
  **Build (`mount-3d` runtime + intégration Google `Tile3DLayer` + render + drape) = wp7 socle/Codex
  (geo-socle).** Chiffrage build 3D-renderer = domaine geo-socle (cross-wire : ~10-16 p-j, mid ~12,
  variance = B8).
- **Séquence de gel** : (i) clôture **§5 2D** (blocker serving varennes) → (ii) **GO owner** activation 3D
  → (iii) **build geo-socle** contre ce draft → (iv) **mini-gate wp7** (7 critères ci-dessus, B8 tranché)
  → (v) **GEL + ADR** (ADR dédié — MAJOR semver, règle ADR-0026 « toute évolution du seam gelé = semver +
  ADR » ; supersede le forward-path v1 `terrain?`/`sky?` de C1). **Cet authoring n'EST PAS cet ADR.**
- Ce track 3D ouvre son **propre PR** (cap ≤2 PR), avec la passe de rework (types C1–C5) + le mini-gate
  wp7 **avant gel** — doctrine v1 « gel gagné sur preuve ».
