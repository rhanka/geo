# SPEC — geo-map-engine v2 photoréel 3D (tileset-3d · terrain · drape) — TRACK DIFFÉRÉ (roadmap)

> **Statut : ROADMAP d'un track SÉPARÉ — PAS pour ratification dans ce PR.** Décision geo-cond
> 2026-08-31 : le photoréel v2 est **splitté**. Le **fond satellite 2D** part d'abord et seul
> (`SPEC_GEO_MAP_ENGINE_V2_BASEMAP_2D.md`, v2.0, ratifiable en jours). Le **3D photoréel** ci-dessous
> est un **track distinct**, avec son **propre PR** (ouvert après merge du §9-runner Codex, cap ≤2 PR)
> et son propre **mini-gate wp7** avant gel. Ce document capture le **périmètre + les blockers fable-5**
> à traiter dans la passe 3D — il **n'est pas** un contrat gelable en l'état.
>
> **Fondation** : le track 3D **réutilise** `RasterSource` / `AttributionSpec` / `SourcePolicy` /
> `onError` **du contrat 2D v2.0** (déjà reworkés). Il n'y a donc **pas** à re-graver l'attribution
> dynamique, la policy fail-closed, ni le canal d'erreur : ils sont hérités.

## Décision owner (rappel)

**VOIE A = Google Photorealistic 3D Tiles** (2026-08-31, photoréel sub-mètre, câblage rapide). Le
contrat reste **renderer-neutre** (kind `tileset-3d` abstrait) pour que la voie OPEN
(Sentinel-2/DEM/OSM → PMTiles) reste exprimable **sans changer le contrat**.

## Périmètre du track 3D + blockers fable-5 à résoudre (passe de rework à venir)

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

## Règles de conformité — **héritées** du contrat 2D v2.0

Attribution (statique **ou dynamique**, rendue, refus fail-closed sur absence de mécanisme),
`policy` REQUISE + garde committée + test CI, `onError` + repli, clé/CSP = adaptateur : **déjà gravés**
en 2D v2.0 (§2–§3 de `SPEC_GEO_MAP_ENGINE_V2_BASEMAP_2D.md`). Le track 3D les **réutilise** — la tileset
Google 3D = `policy: "live-embed-only"` + `attribution: {mode:"dynamic"}` (copyrights par-asset agrégés
depuis les métadonnées des tuiles visibles).

## Suite

- Ce track 3D ouvre son **propre PR** après merge du §9-runner Codex (cap ≤2 PR), avec la **passe de
  rework** (types exacts B1/B2/S2/S3, §1.5.1-bis caméra B7, drape B8) + un **mini-gate wp7** (tileset
  Google réelle + 1 couche zonage drapée + attribution dynamique rendue) **avant gel** — doctrine v1
  « gel gagné sur preuve ».
- Périmètre wp6 = LE CONTRAT (neutre). Build (`mount-3d` runtime + intégration Google `Tile3DLayer` +
  render + drape) = wp7 socle/Codex (geo-socle).
