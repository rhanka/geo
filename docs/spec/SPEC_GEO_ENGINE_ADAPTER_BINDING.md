# SPEC — Guide de binding de l'adaptateur `@sentropic/geo-map-engine`

> **Statut : contrat de SUPPORT WP6 (geo-owned), pièce de cadrage de la direction B (1er adaptateur DS).**
> Ce document N'EST PAS un nouvel élément de contrat : le contrat moteur `SPEC_GEO_MAP_ENGINE §1`
> est **GELÉ (ADR-0026)**. Ce guide matérialise le **§3 (adaptateur mince)** en **scope de consommateur
> précis** pour que l'équipe DS builde `design-system-geo-svelte` contre une surface figée sans deviner.
> Date : 2026-08-16. Auteur : geo-archi (`claude:archi`, WP6). Destinataires : DS (adaptateur+chrome), immo (données).
>
> **Version-indépendant** : la surface décrite ici est celle du contrat gelé v1 (`CONTRACT_VERSION="1.0.0"`),
> **découplée** du numéro de version npm du train (voir §7). L'adaptateur peut être conçu contre ce guide
> **avant** le tag de publication ; il ne dépend que du package publié pour l'`import` runtime.

---

## §0 — Doctrine (rappel §1.6) : l'adaptateur est un LIANT, pas un moteur

Le moteur est **framework-agnostic** et **DOM-free** dans ses internes (réconciliation, compilation de
paint, caméra). L'adaptateur DS ne fait QUE **lier** :

1. `props → mount/setters` (déclaratif) ;
2. `réactivité framework → appels de setters` (Svelte `$effect`) ;
3. `events moteur → events/stores framework` ;
4. `tokens de thème résolus → TokenMap` (via `getComputedStyle`).

**Zéro logique métier dupliquée** à travers les N adaptateurs (svelte/react/vue). Toute la logique
(réconciliation de couches, compilation d'encodages → paint, caméra, picking) vit **dans le moteur** et
est déjà **testée** (unit + e2e Chromium bloquant en CI). L'adaptateur ne re-teste PAS le rendu (voir §6).

**Neutralité renderer (F3)** : l'adaptateur ne porte **AUCUN type maplibre**. Il bind le contrat neutre ;
il reste donc valide quand le moteur gagnera un renderer 3D (`setRenderer('3d')`), sans changement d'adaptateur.

---

## §1 — La surface gelée que DS consomme (`surface.ts`, §1.3.4 — verbatim)

Point d'entrée unique : `mount(host, opts) → GeoMapHandle`.

```ts
// Générique sur le type d'hôte : le contrat reste DOM-lib-free ; l'adaptateur instancie THost=HTMLElement.
export type MountGeoMap<THost = unknown> = (
  host: THost,
  opts: GeoMapMountOptions & GeoMapEvents,
) => GeoMapHandle;

export interface GeoMapMountOptions {
  basemap: BasemapSpec;             // §1.3.2 : blank | raster | (vector → fail-closed en v1, owner-gated)
  layers: readonly GeoLayerSpec[];  // §1.3.1 : choropleth | points | geojson
  viewport: GeoViewport;            // §1.5 : { center:[lon,lat], zoom, bearing, pitch }
  renderer: RendererKind;           // "2d" (v1 implémenté) | "3d" (pending)
  tokens: TokenMap;                 // §1.3.3 : Record<rôle, primitive résolue>
  options?: Readonly<Record<string, unknown>>;
}

export interface GeoMapEvents {
  onReady?: () => void;
  onHover?: (hit: GeoFeatureHit | null) => void;   // null = sortie de survol
  onSelect?: (hit: GeoFeatureHit) => void;
  onViewportChange?: (viewport: GeoViewport) => void;  // viewport NON-contrôlé par défaut
}

export interface GeoMapHandle {
  // déclaratif (réactivité → ces setters ; JAMAIS un remount)
  setLayers(layers: readonly GeoLayerSpec[]): void;
  setBasemap(basemap: BasemapSpec): void;
  setViewport(viewport: GeoViewport): void;
  setRenderer(renderer: RendererKind): void;   // switch host-stable (§1.1.5) ; canvas interne remplaçable
  setTokens(tokens: TokenMap): void;           // F7b : recompile+réapplique le paint sur TOUTES couches+renderers
  // impératif
  flyTo(viewport: Partial<GeoViewport>): void;
  fitBounds(bounds: GeoBounds, opts?: { maxZoom?: number; padding?: number }): void;
  recenterKeepZoom(center: readonly [number, number]): void;
  resetToInitialView(): void;
  syncLayers(namespacedInput: readonly GeoLayerSpec[]): void;  // escape-hatch haute-fréq, namespace sync/ (§1.4)
  queryRenderedFeatures(): readonly GeoFeatureHit[];
  getFeatureBoundary(layerId: string, featureId: string | number): GeoBounds | null;
  destroy(): void;
}

export interface GeoFeatureHit { layerId: string; featureId: string | number; properties: Readonly<Record<string, unknown>>; }
export interface GeoBounds { west: number; south: number; east: number; north: number; }  // CRS84 degrés
```

**Rien d'autre n'est public.** Le handle n'expose **jamais** un type renderer (les features maplibre sont
réduites à `GeoFeatureHit` **avant** de traverser le seam — `feature-query.ts`).

---

## §2 — Les 4 SEAMS cross-repo (le cœur de ce que DS doit brancher)

### Seam 1 — HOST (AppShell DS → conteneur ; invariant §4 / §1.1.5)

- DS fournit **un élément hôte STABLE** (`HTMLElement`, ex. un `<div bind:this>`), **monté une seule fois**,
  **jamais démonté ni reparenté** tant que la carte vit. Le moteur possède **tout l'intérieur** de l'hôte ;
  l'adaptateur **ne touche jamais le renderer directement** (F6c).
- **Invariant host≠canvas (§1.1.5)** : sur `setRenderer('2d'↔'3d')`, le moteur remplace son **canvas interne**
  mais garde **l'hôte** intact et **round-trip** l'état (sélection/caméra/viewport). L'AppShell drawer/collapse
  DS doit donc **cacher/redimensionner** l'hôte (CSS), **jamais** le détacher du DOM (sinon perte du contexte WebGL).
- **Anti-pattern à proscrire** : recréer l'hôte (ou remonter le composant carte) sur changement de prop.

### Seam 2 — TOKENMAP (thème DS → moteur ; §1.3.3, fix F7b)

- Le moteur est **DOM-free** : c'est **l'adaptateur** qui résout les custom properties `--st-*` du thème
  courant via `getComputedStyle(themedContainer)` en une **`TokenMap` = `Record<rôleSémantique, primitiveRésolue>`**
  (ex. `{ "category1": "#1f77b4", "border-subtle": "rgba(0,0,0,.12)" }`). **DS possède** le mapping
  rôle→custom-property.
- Passée **au montage** (`mount({ tokens })`) **ET à chaque changement de thème** (`handle.setTokens(newMap)`).
  `setTokens` **recompile et réapplique** le paint sur **toutes les couches et tous les renderers** (F7b) — DS
  n'a **rien** à re-peindre, juste à re-résoudre la map et rappeler `setTokens`.
- Les **rôles** (`TokenRole`) sont des noms sémantiques (`"category1"`, `"border-subtle"`), **jamais** un littéral
  couleur (principe §1.1.2). Les `GeoLayerSpec` référencent ces rôles ; la `TokenMap` les résout. Le **catalogue de
  rôles** consommés par les specs de couche de la 1re vue est fourni par le producteur de specs (immo/geo) — DS
  garantit que sa `TokenMap` **couvre** ce catalogue (rôle manquant → défaut fail-closed côté moteur, à ne pas
  provoquer silencieusement).

### Seam 3 — DONNÉES (immo servi → `GeoLayerSpec` ; §1.3.1)

- Le **consommateur métier (immo)** mappe ses données servies (municipalities / zones / lots / signals) en
  **`GeoLayerSpec` neutres** — `choropleth` | `points` | `geojson` — où **tous** les canaux visuels passent par
  `ColorEncoding` / `NumberEncoding` (rôles + champs), **jamais** une expression paint maplibre.
- `data` est une **`FeatureCollection` `@sentropic/geo-core`** (RFC 7946) **ou** un `{ sourceRef }` opaque.
  L'interactivité (hover/select) se déclare par couche via `interactivity: { idField, hover?, select? }` —
  `idField` **re-mappe** le hit vers la feature (voir Seam 4).
- Deux voies d'injection : **`setLayers(...)`** (déclaratif, la voie normale, diff réconcilié dans le namespace
  `layers/`) ; **`syncLayers(...)`** (escape-hatch **haute-fréquence**, namespace **`sync/`** isolé — le
  réconciliateur `layers/` ne traverse **jamais** `sync/` et réciproquement, §1.4). Les curseurs/animations
  temps-réel passent par `sync/` ; l'état déclaratif par `layers/`.
- **Frontière de responsabilité** : immo externalise son **fetch interne** (Gate B élargi, C3) et **produit les
  specs** ; l'adaptateur DS ne fabrique **pas** de specs — il **relaie** celles du consommateur au moteur.

### Seam 4 — EVENTS (moteur → chrome DS + selectionState immo ; §1.3.4)

- Le moteur émet `onHover(hit|null)`, `onSelect(hit)`, `onViewportChange(viewport)`. L'adaptateur les **relaie**
  en events/stores framework (Svelte `dispatch` / store). Le **viewport est NON-contrôlé par défaut** : le moteur
  bouge sa caméra librement et **notifie** via `onViewportChange` — l'adaptateur ne doit **pas** re-`setViewport`
  en réponse (boucle d'écho déjà gardée côté moteur, F7a, mais ne la provoquez pas depuis l'adaptateur).
- `GeoFeatureHit = { layerId, featureId, properties }` — **neutre**, sans projection node-id/graphe du
  consommateur (§6). Le **consommateur (immo)** mappe `hit → selectionState` (sa logique métier).

---

## §3 — Cycle de vie du montage (Svelte, concret)

```
onMount:      handle = mount(hostDiv, { basemap, layers, viewport, renderer:'2d', tokens, ...events })
$effect:      diff quelle prop a changé → LE setter correspondant
              layers→setLayers · basemap→setBasemap · viewport→setViewport(si contrôlé) · tokens→setTokens
              JAMAIS remonter le composant / recréer l'hôte
onDestroy:    handle.destroy()
```

- **Un seul `mount` par cycle de vie de l'hôte.** Les changements de props passent par les **setters**, pas par
  un remount (préserve l'hôte stable §4 + la caméra courante + le contexte WebGL).
- Thème : un `$effect` sur le thème courant → re-résoudre la `TokenMap` → `handle.setTokens(map)`.

---

## §4 — Chrome DS (§5) : consomme le handle + le tool-context, ne touche jamais le renderer (F6c)

- **`GeoLegend`** : dérive la légende des `GeoLayerSpec` (rôles + domaines) — pur affichage DS.
- **`GeoBasemapSwitcher`** : appelle `handle.setBasemap(...)` (blank/raster ; `vector` fail-closed en v1).
- **`GeoMeasureTool`** (outil profond, §1.3.5) : reçoit un **`GeoToolContext`** actif du moteur —

```ts
export interface GeoToolContext {
  readonly layerIdPrefix: string;                              // namespace exclusif : tools/measure/
  setScratchLayers(layers: readonly GeoLayerSpec[]): void;     // réconcilie SES couches scratch (dans son namespace)
  onPointerEvent(listener: (e: { type: "click"|"move"; coordinate: [number, number] }) => void): () => void;
  destroy(): void;                                             // retire scratch + restaure interactions base-map
}
```

  L'outil ne dessine **que** dans son `tools/<id>/` (jamais `layers/` ni `sync/`) ; à la désactivation,
  `destroy()` retire ses couches et **restaure** l'état d'interaction de la base-map (sauvegarde/restauration
  déjà gérée côté moteur, W6). Le chrome DS **wrappe** ce contexte, il ne parle **jamais** à maplibre.

---

## §5 — Répartition geo / DS / immo (pour cadrer les lanes)

| Zone | Owner | Livrable |
|------|-------|----------|
| Package moteur (contrat gelé + 2D W1–W8) | **geo** (geo-cond) | `@sentropic/geo-map-engine` **publié npm** (release cut, §7) + ce guide + support contrat |
| `GeoViewport` en geo-core (§1.5) | **geo** | **DIFFÉRÉ** (mon call steward) — import depuis geo-map-engine marche pour B ; bouger = semver-major inutile |
| Adaptateur mince `design-system-geo-svelte` | **DS** (leur repo) | binding props→mount/setters, tokens→TokenMap, events→framework (§2, §3) |
| Chrome (`GeoLegend`/`GeoMeasureTool`/`GeoBasemapSwitcher`) + AppShell drawer/invariant canvas | **DS** (leur repo) | §4 ; **DS déjà en cours** sur AppShell + rename `GeoChart` (§2 spec) |
| Migration : externaliser le fetch + produire les `GeoLayerSpec` + `selectionState` | **immo** (leur repo) | Gate B élargi (C3) + Gate A split version (C5) ; **revue immo → geo-archi** |

---

## §6 — Tester l'adaptateur : binding mince, PAS le rendu

- Le moteur teste **son** rendu (unit `feature-query`/`paint-compiler`/reconciler + **e2e Chromium bloquant**,
  vraie maplibre-gl, non mockée). **L'adaptateur ne re-teste pas le rendu.**
- Tests d'adaptateur = **binding** : props→appels de setters asservis contre un **faux handle** (spy sur
  `setLayers`/`setTokens`/…), events→callbacks framework, lifecycle (mount une fois, destroy au démontage,
  pas de remount sur prop-change). C'est **léger** et **framework-local**.
- **Anti-omission (« vert par omission = rouge »)** : un test d'adaptateur qui « passe » parce qu'il ne monte
  jamais réellement, ou mocke le moteur au point de ne rien asserter, ne prouve rien. Asserter les **appels réels**
  au handle.

---

## §7 — Version npm vs `CONTRACT_VERSION` (découplage — à documenter dans la release)

- **`CONTRACT_VERSION = "1.0.0"`** = semver du **contrat gelé** (v1, ADR-0026). Stable tant que la surface §1.3.4
  ne change pas (tout changement = major + ADR ; ajout de type/fichier = minor, sans ADR).
- **Version npm du package** = le **train monorepo tag-driven** (uniforme, Trusted Publishing OIDC). Découplée du
  `CONTRACT_VERSION`. DS **pin** `@sentropic/geo-map-engine@^<train>` (le numéro exact confirmé par l'owner au
  release cut) et peut **lire `CONTRACT_VERSION`** pour vérifier la version de contrat.
- Le **release cut** (bump-all + tag) est **owner-gated** (1re publication publique de ce package). DS peut
  concevoir l'adaptateur contre ce guide **dès maintenant** ; l'`import` runtime attend le tag.

---

## §8 — Références

- `docs/spec/SPEC_GEO_MAP_ENGINE.md` — §1 gelé (§1.3.1 layers/encodings, §1.3.2 basemap, §1.3.3 tokens,
  §1.3.4 surface/handle, §1.3.5 tool-context, §1.4 namespaces, §1.5/§1.5.1 viewport, §1.6 doctrine adaptateur).
- `docs/decisions.md` — ADR-0025 (moteur autoritaire renderer-neutre), ADR-0026 (gel du seam v1).
- `@sentropic/geo-map-engine` — `surface.ts` / `encodings.ts` / `layers.ts` / `viewport.ts` / `tool-context.ts`
  (la surface citée ici verbatim), moteur 2D complet W1–W8 (`main`), e2e Chromium bloquant en CI.
- `docs/spec/CADRAGE_NEXT_PHASE_2026-08-16.md` — direction B (ce guide en est le cadrage geo-interne WP-B3).

**Contrat de support WP6 — ne fige rien de neuf (le contrat est §1 gelé). Anti-invention : surface citée
verbatim depuis le code publié ; frontières de responsabilité explicites ; découplage version documenté.**
