# SPEC — Moteur carto geo (geo-owned) + contrat de consommation DS/immo

> **Statut : §1 (MOTEUR, renderer-neutre) = CONTRAT v1 GELÉ (stable) — RATIFIÉ OWNER 2026-08-16** sur
> **gate §9 VERT** (re-run canonique `b67eb222` : §1.5.1 validé 7/7 dans les octets, fixtures DS réelles,
> F7b, round-trip vp3d-préservé). **Implémentation AUTORISÉE** : Phase 0 (W1–W10) dans le cap **74–118 p-j
> (ajustable, cf. `CHIFFRAGE_MOTEUR_CARTO_2026-08-15.md §6.1`)** ; tout dépassement → re-check owner. Le gel
> couvre le **§1** (seam moteur geo-owned) ; **§2–6 restent le ressort DS** (leur cadence de ratification).
> Date : 2026-08-15 · **gel 2026-08-16**. Auteur §1 + assemblage autoritaire : geo-archi (`claude:archi`).
> Sections §2–6 : **DS-authoritative** (conducteur design-system), intégrées ici sans altération. Contraintes
> §8 : **immo** (i-cond, spec 3D committé). Conduite PR→ratification : geo-cond.
>
> **Maison autoritaire (geo-owned)** : ce fichier + `ADR-0025` (décision) + `ADR-0026` (gel v1) dans
> `docs/decisions.md` (repo geo).
> Sources versées : `geo-archi-brief.md` (D1–D8), `geo-archi-proposal.md` (§0/§10 v2),
> `geo-archi-fable5-review.md` (F1–F8), V0 réconciliée co-signée, entrée-consommateur DS (§A–§E),
> `docs/spec/SPEC_EVOL_3D_MAPS_2026-08-14.md` (immo).

---

## 0. Décision (résumé — ADR-0025)

Capitaliser la vue géo **mutualisée geo↔immo**. **geo détient le moteur unique** (package dédié, TS
pur, framework-agnostic, dans le repo geo) ; **N adaptateurs framework MINCES + chrome présentationnel
= DS-owned** ; **zéro-copie** (un moteur, N adaptateurs sans logique dupliquée). **Le moteur est
RENDERER-NEUTRE dès la v1** (2D maplibre + 3D Cesium/deck), driven par le spec 3D committé d'immo — PAS
maplibre-only. Le **gel du seam v1 est ACQUIS** (ratifié owner 2026-08-16) : la démo 3D concrète (re-run canonique
`b67eb222`, deck.gl) a prouvé qu'un renderer 3D réel satisfait le contrat couche+caméra neutre — gel gagné
sur preuve, jamais figé sur l'abstraction seule.

## 1. MOTEUR — geo-owned  *(AUTORITAIRE — geo-archi)*

### 1.1 Principes (invariants du contrat)
1. **Zéro expression de peinture maplibre brute** dans le contrat public : non portable 3D. Le moteur
   traduit tout encodage neutre → paint, **par renderer**.
2. **Tout le visuel passe par des tokens** (rôles sémantiques) — jamais de hex ni d'expression dans la spec.
3. **Renderer-neutre** : le même `GeoLayerSpec` rend en maplibre (2D) et en Cesium/deck (3D) ; le moteur
   **owne la traduction par renderer**.
4. **Champs 3D optionnels & non-breaking** : le renderer 2D les ignore ; les ajouter ne casse pas le contrat.
5. **Host container stable (host ≠ canvas)** : `setRenderer('2d'|'3d')` bascule le renderer **DANS le
   host** — le conteneur monté (`mount(host,…)`) n'est **jamais démonté/reparenté**. Le **canvas interne
   du renderer** est distinct : maplibre / Cesium / deck ont **chacun leur propre `<canvas>` + contexte
   WebGL non transférable**, donc au switch 2D↔3D le canvas interne **PEUT être remplacé** (l'un détruit,
   l'autre créé) — ce n'est PAS le même nœud. Ce qui est garanti au switch : **le moteur préserve
   sélection + caméra + viewport** (round-trip sans perte, §1.5) et **aucun remount composant**. Invariant
   à deux niveaux : cf. §4 / immo C2.
6. **Moteur DOM-free & framework-agnostic** : réconciliation, paint, caméra, internals renderer vivent
   dans le moteur ; l'adaptateur ne fait que **binder** (props→appels, réactivité→moteur, events→framework,
   résolution des tokens DOM→`TokenMap`). Zéro logique dupliquée entre les N adaptateurs (doctrine
   dataviz-core, cf. F3).

### 1.2 Package & dépendances
Package moteur dédié dans le repo geo : **TS pur, framework-agnostic, versionné (semver ; API publique +
versioning = geo-owned)**. Peers : `maplibre-gl` (^5.24, moteur 2D) ; **adaptateurs 3D** (Cesium et/ou
deck.gl) chargés par le renderer 3D. Consomme `geo-core` (types, cf. 1.5) + `dataviz-core` (builders
d'agrégation + classification, cf. 1.6). **greenfield** : geo-ui-svelte n'a AUCUN réconciliateur (tout
dans un `onMount`, remount forcé via `{#key}`) — F1 confirmé ; seuls builders + `GeoMapLegend` + style
blank tokenisé sont réutilisables.

### 1.3 Contrat public renderer-neutre  *(intègre l'entrée-consommateur DS §B/§C/§D)*

**1.3.1 Modèle de couche `GeoLayerSpec` (union discriminée).** Champs communs : `id` (namespacé, cf.
1.4), `kind`, `data` (FeatureCollection geo-core ou réf de source), `interactivity?` ({hover?, select?,
idField}), `visible?`, `opacity?: NumberEncoding`, + **3D optionnel** `extrusion?`/`elevation?`.

**Encodages neutres (cœur de la renderer-neutralité)** — le moteur les compile en paint maplibre OU en
accessors deck/Cesium :
```
ColorEncoding =
  | { by:'constant', token }                                    // token = rôle sémantique (ex. 'category1')
  | { by:'category', field, map: Record<value, token> }         // catégoriel → token
  | { by:'valueStep', field, stops: {upTo:number, token}[] }    // choroplèthe/bins → token (remplace un `step` maplibre)
  | { by:'valueRamp',  field, domain:[min,max], ramp: token[] } // continu → rampe de tokens
NumberEncoding =
  | { by:'constant', value:number }
  | { by:'value', field, domain:[min,max], range:[min,max] }    // rayon/épaisseur/opacité ∝ valeur
```
`token` = **rôle sémantique** (jamais de hex), résolu par le moteur via la `TokenMap` (1.3.3). Par `kind` :
`geojson` (sous-specs `fill/outline/points/label`), `choropleth` (bins neutres de `dataviz-core`, cf. 1.6),
`hexbin`/`cluster`/`density` (FeatureCollection + encodage neutre par builders `dataviz-core`),
`points`/markers, `flow`.

**1.3.2 Basemap (`BasemapSpec`, union, attribution OBLIGATOIRE, jamais d'URL hardcodée)** :
```
{ kind:'blank',  background: token }
{ kind:'raster', tiles:string[], attribution, saturation? }   // OSM / neutral-gray (immo, saturation −1)
{ kind:'vector', style|pmtiles, attribution }                 // incrément geo
// forward 3D non-breaking : terrain?, sky?
```

**1.3.3 Contrat de résolution des tokens (fix Fable F7b — « couleurs figées au switch de thème »)** :
- **Adaptateur (DS)** : résout les `--st-*` depuis le conteneur thémé (`getComputedStyle`) en une
  `TokenMap: Record<role, resolvedValue>` concrète, passée au moteur **au mount ET à chaque changement de
  thème**.
- **Moteur (geo)** : à l'application du paint, résout les tokens d'encodage via la `TokenMap` → paint
  concret **par renderer**. Sur `setTokens(newMap)`, **ré-applique sur TOUTES les couches ET tous les
  renderers**. Le moteur reste **DOM-free** (il reçoit une map de primitives, pas un resolver couplé au DOM
  — arbitrage E.1 tranché : `TokenMap` résolue, pas callback).

**1.3.4 Surface mince (adaptateur ↔ moteur)** :
```
mount(host, { basemap, layers, viewport, renderer:'2d'|'3d', tokens:TokenMap, options }) → handle
// déclaratif :  setLayers(layers) · setBasemap(b) · setViewport(vp) · setRenderer('2d'|'3d') · setTokens(map)
// impératif (handle) : flyTo · fitBounds · recenterKeepZoom · resetToInitialView · syncLayers(nsInput)
//                       · queryRenderedFeatures · getFeatureBoundary
// events : onReady · onHover(hit|null) · onSelect(hit) · onViewportChange(vp)
```
`setRenderer` bascule le renderer **dans le host stable, sans reparent** (invariant §4 étendu 2D↔3D).

**1.3.5 Tool-plugin (chrome §5) renderer-neutre** : les outils profonds (mesure) consomment un **contexte
outil fourni par le moteur** (couches propres + interception d'événements + suppression hover/select
pendant l'outil) — **renderer-neutre** → l'outil marche en 2D ET 3D. Le chrome DS ne touche jamais le
renderer en direct (fix F6c).

### 1.4 Internals moteur (geo-owned, greenfield)
- **Réconciliateur de couches déclaratif** (diff `setLayers`) — vit DANS le moteur (F1/F3).
- **Partition d'ownership par préfixe d'ID de couche** : `layers` (déclaratif) et `syncLayers`
  (impératif, escape-hatch haute-fréquence, pattern perf immo) coexistent ; le réconciliateur **ne
  traverse jamais un namespace étranger** (arbitre déclaratif↔impératif, fix F6b).
- **Viewport** : **non-contrôlé par défaut** (`initialViewport` + `onViewportChange`) ; contrôlé opt-in
  avec **contrat d'écho** (compare epsilon + throttle `moveend`) pour ne pas jitter/annuler les `flyTo`
  (fix F7a). Porte `bearing/pitch` (déjà modélisé immo `GeoViewportState`).
- **Tokens→paint par renderer** + **ré-application au changement de thème** (F7b).
- **Basemap** : `setStyle` maplibre **détruit les overlays** → **ré-injection post-setStyle prévue dès la
  conception** (F7d).
- **Caméra** (`flyTo`/`fitBounds`/`recenterKeepZoom`/`resetToInitialView`) + **tool-plugin context**.

### 1.5 `geo-core` — type viewport + zoom normalisé + équivalence caméra 2D/3D
`geo-core` (repo geo, 0.5.x) n'exporte **pas** de type viewport/caméra aujourd'hui (F2 confirmé ;
`GeoFeatureHit` vit dans geo-ui-svelte). À AJOUTER dans geo-core :
- `GeoViewport { center, zoom, bearing, pitch }` (maison du type = geo-core).
- **Zoom normalisé + équivalence caméra 2D/3D** : une sémantique de zoom **commune aux deux renderers**,
  telle qu'un `viewport` **round-trip 2D↔3D sans changement de contrat** (prérequis immo C1(b) + du seam
  « porte 1 »). C'est l'unité que l'écho du viewport contrôlé DS (epsilon+throttle) vise, et que la démo 3D
  (§9) exerce. **Évolution geo-core = release cross-repo** (ownership à confirmer par geo-cond/owner).

### 1.5.1 Convention de zoom normalisé — GRAVÉE *(validée par le spike 3D §9)*

Le spike 3D (deck.gl, `spike/engine-3d-20260815 @931f27a6`) a prouvé le round-trip caméra 2D↔3D à
**~7×10⁻¹⁵° (état)** / **5,5×10⁻¹² px (projection)** SOUS la convention exacte ci-dessous. §1.5 énonçait
l'**exigence** ; cette convention en est la **NORME** — geler « il existe un zoom normalisé » sans la graver
serait une invention (d'où le verdict **ROUGE-constructif** du gate au 1er run). Convention autoritaire :

- **Centre** : CRS84 `[longitude, latitude]` (ordre lon/lat, WGS84, degrés décimaux).
- **Projection** : WebMercator (EPSG:3857).
- **Zoom** : taille du monde = **512 × 2^zoom pixels CSS** (tuile 512 px ; identique maplibre 2D et `MapView` deck 3D).
- **Angles** : `bearing`/`pitch` en **degrés**. Domaines : `bearing ∈ [0, 360)` (normalisé mod 360),
  `pitch ∈ [0, pitchMax]` — `pitchMax` = **capacité renderer** exposée par le seam (ex. ~60° maplibre 2D).
- **Équivalence 3D (dérivée déterministe)** : altitude relative **1,5** (unités écran), **FOV = 2·atan(0.5/1.5)** ;
  le zoom normalisé mappe la distance caméra ↔ emprise au sol.
- **États neutralisés (hors contrat v1)** : **pas** de terrain, padding, roll, ni wrap horizontal. Leur entrée
  au contrat est explicite + versionnée (non-breaking, §1.1 principe 4), jamais implicite.
- **Domaine commun 2D/3D** : les deux renderers partagent `center/zoom/bearing/pitch` dans ces unités → un
  `GeoViewport` est **transportable 2D↔3D sans changement de contrat**.

**Round-trip = préservation de l'état COURANT (clarification §1.1.5 — correctif du gate).** Au `setRenderer`
(2D↔3D), le moteur préserve le **viewport COURANT** : si l'appelant a fait `setViewport(vp3d)`, le retour
vers 2D **conserve vp3d** (pitch/bearing portés par maplibre 2D dans leurs domaines) ; il ne **restaure
JAMAIS** un viewport antérieur (ex. `initialViewport`). « Round-trip sans perte » (§1.1.5) = l'état courant
traverse la frontière renderer **sans dérive**, PAS un retour à un état initial. Le test du gate assert
`vpX → autre renderer → retour → vpX` (à tolérance `1e-7`° / `1 px`), **jamais** `vpX → vp_initial`.

*(Non-gel : cette convention PRÉCISE §1.5, elle ne gèle pas §1. Gel toujours gaté sur le re-run CANONIQUE
du gate — fixtures DS réelles + F7b theme-switch — vert, puis OK geo-cond→owner. §9.)*

### 1.6 Frontière `dataviz-core` (arbitrage E.3, tranché)
Aujourd'hui la choroplèthe passe par `binsToStepExpression` = **expression maplibre** (non portable 3D).
**Découpage tranché** : `dataviz-core` émet des **bins NEUTRES `{upTo, token}[]`** (la MATH de
classification quantile/equal) ; **le moteur compile** en `step` maplibre OU en équivalent deck/Cesium (le
PAINT par renderer). Implication : **changement cross-package `dataviz-core`** (retirer l'émission maplibre
`step` → bins neutres) — **OWNER-GATED**, séquencé en amont (cf. §7 ; ne bloque que le chemin
choroplèthe/chrome L5, pas les adaptateurs de base).

### 1.7 Arbitrages tranchés & findings Fable résolus
- **E.1** livraison tokens = `TokenMap` résolue (moteur DOM-free), pas callback. **E.2** vocabulaire
  d'encodage = `constant/category/valueStep/valueRamp` (jeu minimal ; extension seulement si une couche
  réelle l'exige). **E.3** frontière dataviz-core (1.6). **E.4** formes 3D `extrusion`/`elevation`
  optionnelles & non-breaking (forme arbitrée par geo). **E.5** zoom normalisé — convention **GRAVÉE en §1.5.1**
  (validée 7/7 au gate §9, `b67eb222`).
- **Fable** : F1/F3 (moteur écrit UNE fois, greenfield, testé 1× contre une fausse map — réponse au risque
  « tests sans GL ») ; F2 (geo-core, 1.5) ; F6 (namespaces, 1.4) ; F7 (viewport/thème/setStyle, 1.3.3+1.4).
  F4/F5/F8 relèvent des sections DS (§2/§4) et du resourcing (§7).

### 1.8 Gel
Le §1 est **GELÉ (contrat v1 stable)** depuis **2026-08-16**, **ratifié owner**. La **démo 3D concrète** (§9)
est VERTE (re-run canonique `b67eb222`, deck.gl), prouvant le contrat renderer-neutre satisfiable en 3D — le
gel a été **gagné sur preuve** (anti-généralisation-prématurée respectée), jamais figé sur l'abstraction seule.
Toute évolution du seam gelé = **nouvelle version (semver) + ADR**, jamais un changement silencieux. Réf : ADR-0026.

---

## 2–6. Sections DS-authoritative *(conducteur design-system ; intégrées sans altération ; DS relit)*

- **§2 NAMING** : le `GeoMap` SVG du DS est un **chart thématique statique** → **rename sec `GeoMap →
  GeoChart`** (4 frameworks), **SANS alias** (zéro consommateur externe vérifié 2026-08-15 ; un alias
  créerait deux `GeoMap` incompatibles — F5). La classe CSS `.st-geoMap` **reste un nom interne stable**
  (styles.css byte-identiques + ancre du gate hex intouchés). Le nom `GeoMap` libéré = composant interactif
  canonique adossé au moteur, dans les packages adaptateurs DS.
- **§3 CONTRAT D'ADAPTATEUR THIN** : `design-system-geo-{svelte,react,vue,angular}`, **renderer-neutres,
  zéro maplibre brut** (amende C1). Règle zéro-copie (1.1 §6). Le moteur se teste UNE fois contre une fausse
  map ; les adaptateurs = tests de binding minces. API+versioning moteur = geo-owned.
- **§4 APPSHELL + INVARIANT CANVAS** : mode `panelCollapse="drawer"` (off-canvas transform, panneaux
  **toujours montés, jamais reparentés** ; matchMedia JS, défaut 900px/899px cf. C4 ; **PAS** le `Drawer` DS
  destructeur, **PAS** le `ViewLayout` immo remontant). **INVARIANT à DEUX niveaux (testable ; host ≠
  canvas, correctif DS)** :
  1. **Host container (fort, toujours)** : le conteneur monté (`mount(host,…)`) n'est **jamais
     démonté/reparenté** — panneau, breakpoint, mode, ET switch renderer 2D↔3D. Test : réf du nœud host
     stable sur toutes ces transitions.
  2. **Canvas interne du renderer** : (a) **hors switch de renderer** (panneau/breakpoint, 2D→2D) →
     persiste (mount-once) ; (b) **au switch 2D↔3D** → PEUT être remplacé (maplibre/Cesium/deck ont chacun
     leur propre `<canvas>`/contexte WebGL non transférable), MAIS **sélection + caméra + viewport
     préservés** (responsabilité moteur, équivalence §1.5), aucun remount composant, aucune perte d'état.
  Tests (amende C2) : (a) host stable toujours ; (b) canvas interne stable hors switch ; (c) au switch,
  l'état round-trip sans perte (test host côté AppShell + test moteur côté round-trip).
- **§5 CHROME** : slots overlay par coin ; `GeoLegend`, `GeoMeasureTool` (via tool-plugin context 1.3.5),
  `GeoBasemapSwitcher` ; drill = `SegmentedControl` générique + logique consommateur ; millésime = `Select`
  DS ; zoom = wrapper opt-in.
- **§6 GATES + MIGRATION IMMO** : **Gate A** split versions geo(0.5)↔immo(0.1.1) + inventaire breaking
  0.1→0.5 + coût upgrade `GeoView.svelte` (C5). **Gate B** externalisation du fetch immo interne
  (`GeoCityMapApi`→municipalities) élargi à **municipalities + zones + lots + signals** (C3) → migration
  immo = **refactor** (sortir le fetch, adopter le composant canonique + handle moteur), pas un drop-in.

---

## 7. Resourcing — OWNER-GATED (aucune implémentation avant ratification)

**Jalon amont bloquant = démo 3D verte → gel §1** (cf. §9). Ordre :
```
démo 3D verte → GEL §1
   → (L1–L4 adaptateurs de base : geojson/points ; ne consomment PAS les bins → avancent)
   ‖ (refactor dataviz-core → bins neutres, owner-gated)
   → L5 chrome/choroplèthe (dépend des bins neutres) → L6 migration immo (adoption + fetch-out)
```
- **Build moteur (geo owner)** : greenfield — réconciliateur + viewport/écho + tokens→paint **par
  renderer** + caméra + ré-injection post-setStyle + tool-plugin + **couche renderer-neutre + spike 3D**
  (§9). Dimensionnement remonté par geo.
- **Build DS (owner DS)** : L1 (1er adaptateur svelte + rename `GeoChart` + mode AppShell drawer + test
  invariant canvas + **spike Angular** pour verrouiller l'API adaptateur) ; L2 React ; L3 Vue ; L4 Angular
  (risque max) ; L5 chrome ; L6 support migration immo.
- Draft d'abord ; h2a-vif seulement en cas de vrai désaccord.

## 8. Contraintes immo (i-cond) — révision v0.1

immo a ratifié (owner) « module carto GEO-OWNED, DS-compliant » ; réfs `SPEC_EVOL_3D_MAPS_2026-08-14.md` +
`DOSSIER_DECISION_3D_MAPS_2026-08-14.md §9`. Cinq contraintes :
- **C1 renderer-neutral** (amende §1 + §3) — intégrée en §1.
- **C2 invariant canvas étendu au switch 2D↔3D/renderer** (amende §4).
- **C3 fetch externalisé élargi** municipalities+zones+lots+signals (amende §6 Gate B).
- **C4 mobile** : fuite d'instance maplibre au 1er chargement mobile à corriger ; breakpoint 899px ;
  annotations lot/zone préservées au breakpoint ET au switch de mode.
- **C5 gate migration précisé** : inventaire breaking 0.1→0.5 + coût upgrade `GeoView.svelte` (livrable Gate A).

## 9. Jalon de gel : DÉMO 3D concrète (geo-owned) — ✅ GATE PASSÉ (VERT, 2026-08-16)

**Statut : gate ATTEINT — §1 GELÉ (ratifié owner, ADR-0026).** *(La barre ci-dessous est conservée pour référence historique.)*
**Le gel de §1 était gaté sur cette démo.** Barre (geo-owned : moteur + geo-core) : un **spike minimal**
prouvant qu'un renderer 3D **réel** (Cesium OU deck.gl) :
1. **consomme le modèle de couche renderer-neutre** (§1.3.1) — un `GeoLayerSpec` avec `ColorEncoding` +
   `TokenMap` rend en 3D via le compile-par-renderer du moteur (tokens→paint 3D), sans expression maplibre ;
2. **satisfait l'équivalence caméra 2D/3D + zoom normalisé** (§1.5) — un `viewport` **round-trip 2D↔3D sans
   changement de contrat**, dans les unités de zoom normalisé.
Démo verte ⟹ le contrat §1 est prouvé satisfiable en 3D ⟹ **gel §1** ⟹ démarrage des lots §7. Démo rouge ⟹
§1 corrigé avant tout gel (jamais de figement sur l'abstraction seule).

**Historique du gate.** *1er run (2026-08-16, deck.gl, `spike/engine-3d-20260815 @931f27a6`)* = **ROUGE-constructif** :
satisfiabilité 3D PROUVÉE — encodages neutres → accessors deck.gl (**zéro expression maplibre**), rôles via
TokenMap, extrusion, render WebGL2 réel, round-trip caméra 2D↔3D à **~7×10⁻¹⁵°** — MAIS §1.5 « zoom normalisé »
était sous-spécifié (convention à inventer). **Correction appliquée** : convention gravée en **§1.5.1** + sémantique
round-trip clarifiée (préservation de l'état courant). Réserve du 1er run : données synthétisées (fixtures DS non
lues, F7b non exercé). *Re-run CANONIQUE requis avant gel* : fixtures DS réelles (`geo-spike-fixtures.json`) +
**F7b** (`setTokens` light→dark) + assertion round-trip corrigée DS (vp3d→2D→3D→vp3d).
*2e run CANONIQUE (2026-08-16, deck.gl, `spike/engine-3d-rerun-20260816 @b67eb222`)* = **VERT** : §1.5.1
validé **7/7** dans les octets (mesuré : 512·2^zoom=32768px@z6, FOV 0.6435 rad, pitchMax 60 refuse 61, sans
terrain/padding/roll/wrap), **fixtures DS réelles LUES** (`import geo-spike-fixtures.json`, zéro synthèse),
**F7b PROUVÉ** (framebuffer `2a6dd3ee→fead4a30`, `updateTriggers`), **round-trip vp3d-préservé** + assertion
négative, render WebGL2 réel (4 frames, 25 pické), round-trip **7.1e-15° / 5.5e-12 px**, zéro expression
maplibre. *Verify-the-verifier geo-archi confirmé dans le code (`data.ts` import, `deck-compiler.ts`).*
⟹ **gate ATTEINT** ⟹ **GEL §1 RATIFIÉ OWNER (2026-08-16)** + cap 74–118 p-j ratifié ⟹ démarrage Phase 0 (§7).
**§1 = contrat v1 GELÉ** (cf. §1.8, ADR-0026).

---

## Références
- Sources : `geo-archi-brief.md` (D1–D8), `geo-archi-proposal.md` (§0/§10 v2), `geo-archi-fable5-review.md`
  (F1–F8), V0 réconciliée co-signée, entrée-consommateur DS (§A–§E).
- immo : `SPEC_EVOL_3D_MAPS_2026-08-14.md` + `DOSSIER_DECISION_3D_MAPS_2026-08-14.md §9`.
- Décision : `docs/decisions.md` ADR-0025.

**DRAFT co-signé — OWNER-GATED — §1 NON-GELÉ pending démo 3D. Anti-invention : grounded sur sources +
code (file:line dans les sources versées), rien d'implémenté avant ratification.**
