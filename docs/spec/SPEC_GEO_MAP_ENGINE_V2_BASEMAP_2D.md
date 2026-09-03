# SPEC — geo-map-engine v2.0 : basemap satellite 2D renderer-neutre (source abstrait · attribution dynamique · policy)

> **Statut : DRAFT — design pass geo-archi (wp6). Double-instruction PASSÉE : 2e avis fable-5
> full-draft (NEEDS-REWORK borné) → SPLIT + rework → re-check fable-5 focalisé = RATIFY-WITH-FIXES
> (3 fixes + 1 nit, tous intégrés). En attente (b) ratification geo-cond→owner (present-decision)
> + (c) mini-gate wp7 (§5) AVANT gel.** Additif au contrat
> FIGÉ v1 (`SPEC_GEO_MAP_ENGINE §1`, ADR-0026) → **version MAJEURE v2.0** : ajoute **un** kind
> de basemap (`raster-source`) + ses types support ; **ne touche AUCUN membre gelé v1**.
> Auteur : geo-archi. Périmètre **wp6 = le CONTRAT (le *quoi*, renderer-neutre), PAS le build**
> (adaptateur provider + résolution source + garde policy = wp7 socle/Codex, `SPEC_WORKPACKAGES §1`).
>
> **Slice « satellite 2D vite » (décision geo-cond 2026-08-31, split du 3D complet)** : ce contrat
> livre le **fond satellite 2D** — Voie A **Google Map Tiles 2D** câblable **en jours** — tout en
> gardant la voie OPEN (bare XYZ / PMTiles auto-hébergé) exprimable **sans changer le contrat**.
> Le **3D photoréel** (`tileset-3d`, `terrain`, drape, caméra) est un **track séparé** (voir
> `SPEC_GEO_MAP_ENGINE_V2_PHOTOREAL.md`), qui **réutilise les types de ce contrat** comme fondation.

## 0. Correctifs fable-5 intégrés (traçabilité)

Ce contrat répond aux blockers/should-fix fable-5 qui portent sur le 2D :
**B4** (attribution DYNAMIQUE, pas string statique) → §2.2 `AttributionSpec` + §3.1 ;
**B5** (`policy` fail-open) → §2.2 `policy` **REQUISE** + §3.2 garde committée + test CI ;
**B6** (mutation du membre `raster` gelé) → **nouveau membre** `raster-source`, `raster` v1 **intact** (§2.1) ;
**B3** (partie 2D : source hand-wavy + zéro canal d'erreur) → §2.2 forme exacte + §2.4 `onError` + seam de résolution ;
**S4** (comportement renderer) → §4 ; **S5** (Google-2D ≠ v1-exprimable) → §2.3 ; **S6** (cycle session) → §2.4 ;
**S7** (artefacts dérivés) → §3.2 ; **S8** (qui rend l'attribution) → §3.1.
Les blockers 3D (**B1** union tileset-3d, **B2** composition terrain, **B7** caméra-terrain, **B8** drape,
S1/S2/S3/S9) relèvent du **track 3D**, pas de ce contrat.

## 1. Objet

Le contrat v1 exprime un basemap `blank | raster | vector`. Le membre `raster` v1 =
`{ tiles: readonly string[]; attribution: string; saturation? }` — un **XYZ statique à attribution
statique** (basemap.ts:12, GELÉ). C'est correct pour un **bare XYZ ouvert** (imagerie open à URL
publique + attribution fixe), mais **incapable** d'exprimer un provider satellite **à clé + session +
attribution dynamique** (cf. §2.3). v2.0 ajoute **un** kind — `raster-source` — porteur d'un
**`source` abstrait** (résolu par la config d'adaptateur, jamais une URL/clé provider dans le contrat),
d'une **attribution qui peut être dynamique**, et d'une **policy licencielle**. Neutralité v1 préservée
(§1.1 : tokens, zéro provider/paint brut dans le contrat public) ; **CRS WebMercator hérité** de v1
§1.5.1 (pas de globe).

## 2. Le kind `raster-source` (gelé v2.0)

### 2.1 Membre de basemap — ADDITIF (v1 intact)

```
BasemapSpec (v2.0) = <les 3 membres v1 GELÉS, inchangés>
  | { kind: "blank";  background: TokenRole }                                   // v1 gelé
  | { kind: "raster"; tiles: readonly string[]; attribution: string; saturation?: number }  // v1 gelé — bare XYZ ouvert
  | { kind: "vector"; style?: string; pmtiles?: string; attribution: string }  // v1 gelé
  | { kind: "raster-source"; source: RasterSource; saturation?: number }       // v2.0 NOUVEAU
```

- **Purement additif** : les 3 membres v1 sont **inchangés** ⟹ aucun re-piège W5 (le membre `raster`
  gelé n'est **pas** muté ; on n'empile pas un 2e « both-optional » — fable B6). `BASEMAP_KINDS` gagne
  `"raster-source"` (nouveau membre d'union = **MAJOR** + ADR, `index.ts` : tout changement des types
  gelés impose major+ADR).
- **Compile** → raster 2D du renderer (maplibre raster source / deck), imagerie drapée à plat (z=0).
- **Répartition des voies** :
  - **bare XYZ ouvert** (ex. imagerie Sentinel-2 cloudless à URL publique + attribution fixe) → membre
    **`raster` v1** (inchangé, exprimable **aujourd'hui**).
  - **provider 2D à clé/session/attribution-dynamique** (Voie A **Google Map Tiles 2D**) → membre
    **`raster-source` v2.0** (§2.3).
  - **PMTiles satellite auto-hébergé** (voie open self-host, S3) → membre **`raster-source` v2.0**
    (`imageryType: "pmtiles"`).

### 2.2 Types support (forme exacte)

```
RasterSource:
  id:          string          // id LOGIQUE — l'adaptateur (config déploiement) le résout en URL/clé/session,
                               //   comme la TokenMap résout les --st-* (v1 §1.3.3). JAMAIS une URL/secret provider ici.
  imageryType: "provider-2d" | "pmtiles" | "xyz-templated"
                               //   provider-2d   = flow clé + session (ex. Google Map Tiles 2D)
                               //   pmtiles       = tileset PMTiles auto-hébergé (S3)
                               //   xyz-templated = gabarit d'URL que l'adaptateur remplit (open à params)
  attribution: AttributionSpec // §2.3 — peut être STATIQUE ou DYNAMIQUE
  policy:      SourcePolicy     // REQUISE (pas optionnelle) — fail-closed par le type (fable B5)

AttributionSpec =
  | { mode: "static";  text: string }   // text NON-VIDE obligatoire (refus si vide — §3.1)
  | { mode: "dynamic" }                  // le moteur/adaptateur RÉCUPÈRE ET REND le flux d'attribution
                                         //   par-viewport du provider (ex. endpoint attribution Google 2D).
                                         //   Refus si aucun mécanisme dynamique n'est câblé (§3.1).

SourcePolicy = "live-embed-only" | "cacheable"
```

- **`policy` REQUISE** (fable B5) : l'**absence** de policy n'est **pas représentable** ⟹ pas de
  défaut fail-open silencieux. Une source mal configurée **ne compile pas**.
- `AttributionSpec` **dynamique** (fable B4) : l'attribution Google 2D est **par-viewport** (endpoint
  dédié + logo) — une **string statique ne peut pas** l'exprimer, et forcerait un hardcode « © Google »
  (= la violation-qui-a-l'air-conforme). Le mode `dynamic` grave l'obligation de rendre le **flux**.

### 2.3 ⚡ Voie A — Google Map Tiles 2D (le quick-win, en JOURS)

**S5 (fable) gravé — Google 2D N'EST PAS exprimable par le `raster` v1** :
- la **clé + le session-token** ne peuvent pas vivre dans un `tiles: string[]` **statique** (secret dans
  le contrat + **casse à l'expiration** de session — aucun refresh) ;
- l'**attribution par-viewport** ne peut pas être une **string statique**.
⟹ Google 2D exige le membre **`raster-source`** :

```
{ kind: "raster-source",
  source: { id: "sat-2d", imageryType: "provider-2d",
            attribution: { mode: "dynamic" },
            policy: "live-embed-only" } }
```

L'adaptateur (wp7/geo-socle) résout `id:"sat-2d"` → crée la session Google, injecte clé + session dans
les requêtes de tuiles (transform-request du renderer), gère le refresh à l'expiration, et alimente le
flux d'attribution dynamique. **Le contrat ne nomme jamais Google** (`id` logique) ⟹ un switch
open-PMTiles ne change **que** le `source` (réversibilité). L'owner a son **fond satellite 2D vite**,
le 3D derrière sur son track.

### 2.4 Seam de résolution + canal d'erreur (fable B3 partie-2D, S6)

Le contrat grave les **obligations observables** ; le **mécanisme** de résolution reste wp7 (adaptateur) :

- **Résolution** : l'adaptateur résout `RasterSource.id` → URL/clé/session **au mount** (via le
  transform-request natif du renderer). Un `id` **non résolu** = **refus fail-closed au mount** (jamais
  un lazy silencieux).
- **Cycle de session (S6)** : l'adaptateur **crée / renouvelle / expire** la session. À l'expiration :
  soit l'adaptateur **re-résout** (refresh transparent), soit le moteur **émet `onError`**. Obligation
  moteur : **ne jamais rendre de tuile provider au-delà d'une expiration connue** sans refresh.
- **Canal d'erreur (B3)** — un provider live-embed fait du **refus runtime un mode NORMAL** (session
  expirée, quota, clé révoquée, réseau). Additif à `GeoMapEvents` (surface.ts:40) :

```
GeoMapError:
  source:     "basemap" | "layer"
  sourceId?:  string
  kind:       "resolve-failed" | "session-expired" | "quota" | "forbidden" | "network"
  recoverable: boolean
  message:    string

GeoMapEvents (additif v2.0):
  onError?: (err: GeoMapError) => void
```

Le moteur **DOIT** émettre `onError` **et** rendre un **repli déclaré** (basemap vide + notice
d'attribution), **jamais un blanc silencieux** (vert par omission = rouge).

- **`GeoMapError.kind` est EXTENSIBLE** : de nouveaux `kind` peuvent s'ajouter additivement (**MINOR**,
  non-breaking). Les consommateurs **NE DOIVENT PAS** faire un `switch` exhaustif dessus (branche
  `default` obligatoire) — pas de piège d'exhaustivité au prochain `kind`.

## 3. Règles de CONFORMITÉ (load-bearing — pas déclaratif)

### 3.1 Attribution REQUISE **et RENDUE** ; qui la rend (fable S8)

- Toute `RasterSource` porte une `attribution` (statique **ou** dynamique) ; le moteur **DOIT la RENDRE
  à l'écran**. **Refus fail-closed** = **absence de mécanisme d'attribution** : `{mode:"static", text:""}`
  (vide) **OU** `{mode:"dynamic"}` sans mécanisme dynamique câblé (fable B4 — le refus ne porte plus
  seulement sur « string vide » mais sur « aucun mécanisme »).
- **Qui rend (S8)** : le **moteur** possède tout ce qui est dans le host (surface.ts:72-77 : « The engine
  owns everything inside the host ») ⟹ **le moteur rend le contrôle d'attribution** ; l'adaptateur
  **alimente** le flux dynamique. **Interdit** :
  `attributionControl:false` (maplibre) — attribution portée mais invisible = **violation qui a l'air
  conforme** (catch `app`, `GeoMap.svelte`). **Garde exécutable nommée** : un test de conformance
  assert que l'attribution est **dans le DOM ET visible** (pas seulement dans la source) — c'est la
  cible de garde du catch `attributionControl:false`.

### 3.2 `policy` — live-embed / no-cache / no-redistribution (par construction, fable B5/S7)

- **Voie A Google = `live-embed-only`** : Google **interdit cache et rediffusion** (précédent
  `SPEC_WORKPACKAGES §2` Street View) ⟹ les tuiles vont **navigateur → provider EN DIRECT**, **jamais
  proxifiées/cachées par l'infra geo** (un proxy/CDN geo = rediffusion). L'adaptateur embarque la source
  vive (clé + CSP).
- **Voie OPEN = `cacheable`** : imagerie open (CC-BY/ODbL, attribution) auto-hébergeable en PMTiles → S3.
- **Garde MANDATÉE par le spec (par construction, pattern ADR-0024)** : une **garde committée** dans la
  lib de capture / put-S3 **REFUSE tout octet** dont la provenance est une source `live-embed-only`, +
  un **test CI qui ÉCHOUE** si la garde est contournée (comme `assertVisionModelAllowed` +
  `vision-engine-policy.test.ts`). §3.2 n'est **pas** déclaratif : sans cette garde+test, la règle n'est
  pas satisfaite.
- **Chokepoint de provenance (comment put-S3 sait)** : la provenance **voyage sur le manifeste de
  capture** (`source_id` + `source_policy`) — comme le model-id d'ADR-0024 passe un unique constructeur.
  La garde put-S3 **refuse sur `manifest.source_policy === "live-embed-only"`** : c'est la cible
  exécutable de wp7 (pas une re-dérivation par chemin d'URL contournable). Le mini-gate (§5) prouve ce
  refus sur des octets réels.
- **Policy = résolution AUTORITAIRE (anti-mal-déclaration)** : `policy` non-optionnelle ferme l'oubli,
  mais une source **mal étiquetée `cacheable`** (ex. un provider live-embed déclaré cacheable) passerait
  la garde qui lit la provenance déclarée. ⟹ la **config d'adaptateur/résolution est autoritaire** : la
  résolution **refuse fail-closed** si la policy déclarée au spec est **plus faible** que la policy du
  registre provider pour l'`id` résolu (par-construction, pas par-déclaration).
- **Artefacts dérivés (S7)** : les preuves de conformance v2 (attribution rendue, etc.) **ne déposent
  jamais d'octets d'imagerie provider sur S3** — **assertions / logs**, pas d'octets d'imagerie.
- ⚠ **Distinction du principe fondateur** : « rien uniquement sur une machine / toute donnée captée sur
  S3 » régit la donnée **CAPTURÉE**. Une source `live-embed-only` **n'est PAS capturée** — embed vif sous
  licence, pas une capture. Le contrat le grave (`policy`) pour qu'aucun runner ne tente de la capturer.

### 3.3 Clé / CSP = adaptateur, pas contrat

La clé API + les entrées CSP sont des concerns **adaptateur/déploiement** (wp7). `RasterSource.id` reste
**logique** (résolu par config) ; le contrat ne porte **jamais** de secret/clé.

## 4. Compile + neutralité + renderer (fable S4)

- Le moteur compile `raster-source` → raster 2D du renderer (imagerie plate z=0).
- **Comportement renderer (S4)** : `raster-source` **rend en 2D ET en 3D** (imagerie de fond ; en 3D,
  le sol plat sous les couches vecteur). Aucun champ 3D ici (le relief/tileset-3d = **track 3D séparé**).
- La **résolution provider** (Google vs open) = la config d'adaptateur qui lie `RasterSource` → URL/clé —
  **jamais dans le contrat**. Les 2 voies partagent le MÊME contrat neutre.
- **CRS** : WebMercator hérité v1 §1.5.1 — **pas de globe** (S9), échelle ville.

## 5. Réversibilité, frontière, pré-mortem, mini-gate

- **Réversibilité** : `raster-source` supporte Google (provider-2d) ET open (pmtiles/xyz-templated) → un
  switch owner (coût/licence) **ne change que le `source`**, pas le contrat. Additif : v1 intact,
  rollback = retirer `raster-source`.
- **Frontière** : wp6 = ce kind + les types + les règles (attribution, policy, onError). **wp7
  socle/Codex (geo-socle)** = l'adaptateur (session/clé/CSP/résolution/flux-attribution) + la **garde
  policy committée** + le mount raster.
- **Pré-mortem** : (i) attribution statique hardcodée « © Google » → **§2.2/§3.1 la refusent** (dynamic
  requis) ; (ii) session dans un `tiles` v1 statique → **§2.1/§2.3 imposent `raster-source`** ; (iii) un
  runner cache les tuiles Google sur S3 → **§3.2 garde+test le refusent** ; (iv) clé dans le contrat →
  **§3.3 (adaptateur)** ; (v) blanc silencieux à l'expiration → **§2.4 `onError`+repli déclaré**.
- **Pré-mortem, 6 mois plus tard** — « ça a échoué parce que » : la garde policy §3.2 a été *décrite*
  mais jamais *committée* (pas de test CI) ⟹ un runner a fini par cacher des tuiles Google sur S3 = une
  facture + une violation ToS silencieuse. **⟹ le gel de ce contrat est conditionné à la garde+test
  RÉELS**, pas à leur mention (comme le gel v1 « gagné sur preuve », §9).
- **Mini-gate wp7 (fable, endossé geo-cond)** — AVANT gel, un gate prouve sur du **réel** : (1) les tuiles
  Google 2D **rendent** ; (2) l'attribution **dynamique est récupérée ET rendue** (visible DOM, pas
  `attributionControl:false`) ; (3) la **garde policy refuse** une tentative de capture S3 ; (4) **aucun
  octet d'imagerie provider sur S3**. Cohérent avec la doctrine v1 (« gel gagné sur preuve »).

## 6. Attendus / suite

- **Design pass** : ✅ double-instruction passée — 2e avis fable-5 full-draft (NEEDS-REWORK borné) →
  SPLIT + rework → re-check focalisé = **RATIFY-WITH-FIXES** (fixes §3.1 cite, §3.2 chokepoint+policy
  autoritaire, `GeoMapError.kind` extensible — **tous intégrés**). Freezable.
- **Ratification** geo-cond→owner (present-decision), comme v1 ADR-0026 + §9.
- Post-ratif : **wp7/Codex (geo-socle)** build l'adaptateur Google 2D + la garde policy committée + le
  mini-gate ; geo-archi ratifie la **conformance** (attribution dynamique rendue + `live-embed-only`
  respecté par la garde+test + zéro octet imagerie sur S3).
- **Track 3D** (`tileset-3d`, `terrain`, drape-only S9, caméra §1.5.1-bis) = **PR séparé**
  (`SPEC_GEO_MAP_ENGINE_V2_PHOTOREAL.md`, reworké B1-B8), qui **réutilise** `RasterSource`/
  `AttributionSpec`/`SourcePolicy`/`onError` de ce contrat comme fondation.
