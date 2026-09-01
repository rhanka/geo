# SPEC — geo-map-engine v2 : couches photoréelles renderer-neutres (basemap satellite · terrain DEM · 3D-tiles)

> **Statut : DRAFT — design pass geo-archi (wp6), en attente (a) 2e avis indépendant
> (fable-5, double-instruction) + (b) ratification geo-cond→owner.** Additif au contrat
> FIGÉ v1 (`SPEC_GEO_MAP_ENGINE §1`, ADR-0026) → **nouvelle version MAJEURE (v2)** : ajoute
> des kinds gelés, ne casse aucun kind v1. Auteur : geo-archi. Périmètre **wp6 = le CONTRAT
> (le *quoi*, renderer-neutre), PAS le build** (mount-3d runtime + intégration provider = wp7
> socle/Codex, `SPEC_WORKPACKAGES §1`).
>
> **Décision owner 2026-08-31 : VOIE A = Google Photorealistic 3D Tiles** (photoréel sub-mètre,
> câblage rapide). Le contrat reste **renderer-neutre** (kind `tileset-3d` abstrait) pour que la
> voie OPEN (Sentinel-2/DEM/OSM → PMTiles) reste exprimable **sans changer le contrat** (réversibilité) ;
> seul le **provider/source (config)** diffère.

## 1. Objet

Le contrat v1 exprime des couches **vecteur** (`choropleth | points | geojson`) sur un basemap
`blank | raster | vector` — **pas de terrain, pas de 3D-tiles** (v1 §1.5.1 : « pas de terrain » ;
`elevation` cote-pilotée DIFFÉRÉE). v2 ajoute le **photoréel** — un fond satellite/relief +
bâtiments 3D réels type Google-Earth — **sans quitter la neutralité renderer** (v1 §1.1 :
tokens, zéro paint/provider brut dans le contrat public). Le moteur compile ces kinds neutres
vers le renderer (deck.gl 3D) ET le provider (Google **OU** open) résolu par la **config**, jamais
gravé dans le contrat.

## 2. Nouveaux kinds (gelés v2)

### 2.1 `tileset-3d` — le photoréel 3D (le cœur de la Voie A)

```
Tileset3DSpec:
  kind: "tileset-3d"
  id:   string
  source: TilesetSource          # ABSTRAIT — résolu par la config/adaptateur (§4). JAMAIS une URL provider en dur.
  opacity?: NumberEncoding        # constant only (v2.0)
  interactivity?: { hover?, select? }
```

- **Compile** → deck `Tile3DLayer`.
- **Voie A (Google)** : `source` résout la tileset **Google Photorealistic 3D Tiles** (satellite +
  terrain + bâtiments mesh **en une seule tileset**). ⟹ pour la Voie A, `tileset-3d` **suffit** au
  photoréel (pas besoin de `raster`+`terrain` séparés).
- **Voie OPEN (réversible, non-câblée)** : `source` résout une tileset 3D ouverte, OU l'app compose
  `raster`(sat) + `terrain`(DEM) + `extrusion`(OSM, kind v1 `geojson`+`extrusion`) — même contrat.

### 2.2 `terrain` — relief DEM (voie open / relief non-Google)

```
TerrainSpec (BasemapSpec additif):
  kind: "terrain"
  dem:  RasterSource              # tuiles d'élévation (ABSTRAIT — config)
  elevationDecoder?: { rScaler, gScaler, bScaler, offset }   # décodage RGB→mètres (Terrarium/Mapbox), défaut Terrarium
  exaggeration?: number           # défaut 1.0
```

- **Compile** → deck `TerrainLayer`.
- ⚠ **Voie A (Google)** : la tileset Google INCLUT le terrain → `terrain` est pour la voie OPEN
  (Sentinel-2 drapé sur DEM), **différé** avec elle.

### 2.3 `raster` basemap — satellite 2D / fallback (raffinement v1)

- v1 `BasemapSpec.raster {tiles, attribution, saturation?}` inchangé (satellite XYZ).
- **Additif** : `source: RasterSource` abstrait qui admet aussi une **tileset PMTiles auto-hébergée**
  (voie open, self-host, `pmtiles` = wp7). ⟹ satellite 2D exprimable sur les 2 voies.
- **⚡ QUICK-WIN 2D (Voie A, near-term)** : `source` résout la **Google Map Tiles API 2D**
  (satellite raster) → **le fond satellite VITE (jours)** pendant que le `tileset-3d` (3D, ~2-3 sem)
  se construit. ⚠ Flow **session-token** (créer une session → tuiles `?session=…&key=…`), **PAS un
  XYZ nu** → l'adaptateur (geo-socle/wp7) gère session + clé + CSP. **Même `policy: live-embed-only`**
  que le 3D (cache/rediffusion interdits par la ToS Google — §3.2) ; **attribution RENDUE** (§3.1) ;
  coût usage (préprod = free-tier/faible). ⟹ l'owner a son satellite 2D tout de suite, le 3D derrière,
  **même contrat `raster` neutre** (aucun fork ; un switch open-PMTiles ne changerait que le `source`).

`TilesetSource` / `RasterSource` = **descripteurs abstraits** (id logique + type), pas des URLs.
L'adaptateur (config déploiement) les résout en URL/clé provider — comme la `TokenMap` résout les
`--st-*` (v1 §1.3.3). **Le contrat public ne nomme jamais Google/ESRI/Sentinel-2.**

## 3. Règles de CONFORMITÉ (load-bearing — pas déclaratif)

### 3.1 Attribution REQUISE **et RENDUE** (piège fermé)

Toute `source` (tuile/tileset/DEM) porte une **`attribution`** ; le moteur/adaptateur **DOIT la
RENDRE à l'écran**. **Interdit** : porter l'attribution dans la source mais désactiver son rendu
(`attributionControl:false` maplibre) — l'attribution devient invisible = **violation licencielle
qui a l'air conforme** (catch `app`, `GeoMap.svelte`). L'attribution est une **condition de licence**
(Google, Copernicus/EOX, OSM/ODbL, ESRI), jamais une courtoisie. Garde : un `tileset-3d`/`raster`/
`terrain` **sans `attribution` non-vide = refus** (fail-closed au contrat).

### 3.2 `sourcePolicy` — live-embed / no-cache / no-redistribution

```
TilesetSource.policy?: "live-embed-only" | "cacheable"
```

- **Voie A Google = `live-embed-only`** : Google **interdit le cache et la rediffusion** des
  Photorealistic 3D Tiles (précédent `SPEC_WORKPACKAGES §2` : « Google interdit le cache/rediffusion »
  — même posture que Street View). ⟹ les tuiles restent **Google-hébergées** ; geo/immo **n'en
  captent ni ne rediffusent aucun octet** ; l'adaptateur **embarque la tileset vive** (clé + CSP).
- **Voie OPEN = `cacheable`** : imagerie/DEM open (CC-BY/ODbL, attribution) peuvent être
  auto-hébergés en **PMTiles → S3** (wp7).
- ⚠ **Distinction du principe fondateur** : « rien uniquement sur une machine / toute donnée captée
  sur S3 » vaut pour la donnée **capturée**. Une tileset `live-embed-only` (Google) **n'est PAS
  capturée** — c'est un embed vif sous licence, PAS une capture. Le contrat le grave (`policy`) pour
  qu'aucun runner ne tente de la capturer sur S3 (ce serait une violation de licence).

### 3.3 Clé / CSP = adaptateur, pas contrat

La clé API Google + les entrées CSP sont des concerns **adaptateur/déploiement** (wp7), hors du
contrat gelé (le `source` reste abstrait). Le contrat ne porte **jamais** de secret/clé.

## 4. Compile + neutralité (invariant v1 préservé)

- Le moteur compile `tileset-3d`→`Tile3DLayer`, `terrain`→`TerrainLayer`, `raster`→ raster maplibre/deck.
- La **résolution provider** (Google vs open) = la config d'adaptateur qui lie `TilesetSource`/
  `RasterSource` → URL/clé — **jamais dans le contrat**. Les 2 voies partagent le MÊME contrat neutre.
- `switch 2D/3D` (v1 §1.5) : le `tileset-3d`/`terrain` ne s'affichent qu'en 3D ; le round-trip
  caméra v1 est préservé (host stable, §1.1.5).

## 5. Réversibilité, frontière, pré-mortem

- **Réversibilité** : les kinds neutres supportent Google ET open → un switch owner ultérieur
  (coût/licence) **ne change PAS le contrat** (seul le `source` config bouge). Additif : v1 intact,
  rollback = retirer les kinds v2.
- **Frontière** : wp6 = ces kinds + les règles (attribution, policy). **wp7 socle/Codex** = le
  `mount-3d` runtime (deck `Deck`+`Tile3DLayer`) + l'adaptateur (clé/CSP/résolution source) + le render.
- **Pré-mortem** : (i) attribution portée mais non rendue → **§3.1 la refuse** ; (ii) un runner tente
  de cacher les tuiles Google sur S3 → **§3.2 `live-embed-only` l'interdit** ; (iii) le contrat grave
  Google en dur → **§2/§4 le proscrit (source abstrait)**, donc voie open reste exprimable ; (iv) une
  clé fuit dans le contrat → **§3.3 (clé = adaptateur, contrat sans secret)**.

## 6. Attendus / suite

- **Design pass** : 2e avis fable-5 (double-instruction) sur ce draft AVANT gel.
- **Ratification** geo-cond→owner (comme v1 ADR-0026 + §9).
- Post-ratif : wp7/Codex build le `mount-3d` shell + l'intégration Google `Tile3DLayer` (clé/CSP/
  live-embed) sur la **render-lane** (geo-socle, en cours d'assignation) ; geo-archi ratifie la
  conformance (attribution rendue + `live-embed-only` respecté).
- **Voie OPEN** (`terrain`+`raster`-PMTiles+`extrusion`) reste dans le contrat, **non-câblée**
  (réversibilité), jusqu'à un éventuel switch owner.
