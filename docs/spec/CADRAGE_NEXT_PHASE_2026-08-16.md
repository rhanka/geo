# CADRAGE — Direction post-moteur-2D : jumeau 3D-deck (A) vs 1er adaptateur DS (B)

> **Statut : décision-support WP6 — CALL OWNER. Aucune option n'est un nouvel élément de contrat**
> (le moteur 2D est complet et gelé). La question tranchée par l'owner est la **SÉQUENCE** de deux
> demandes owner **déjà ratifiées** : A (3D progressif, secondaire) et B (adaptateur DS, primaire).
> Date : 2026-08-16. Auteur : geo-archi (`claude:archi`, WP6). Pièce jointe au dossier owner (geo-cond).
>
> **Contexte** : le moteur carto geo-owned est un **renderer 2D complet, testé, interactif** —
> `SPEC_GEO_MAP_ENGINE §1` gelé (ADR-0026), matérialisé en `@sentropic/geo-map-engine`, W1–W8 sur
> `main @6f97f986` (contrat §1.3.4 intégralement implémenté 2D contre une vraie maplibre-gl, e2e
> Chromium bloquant vert en CI). Le contrat renderer-neutre est **prouvé satisfiable en 3D** par le
> spike `b67eb222` (encodages neutres → accessors deck + round-trip caméra 2D↔3D).

---

## A — Jumeau 3D-deck (demande SECONDAIRE : 3D photoréaliste progressive)

**Objet** : un 2e renderer (deck.gl / Cesium) implémentant le **MÊME contrat gelé §1** — bâtiments/zones
en 3D à l'échelle zone, satellite 2D au dézoom (`SPEC_EVOL_3D_MAPS`).

**Steelman (crédité honnêtement)** :
- **Purement geo, zéro friction cross-repo** — tout le travail vit dans le repo geo ; pas de coordination DS/immo.
- **Momentum pipeline** — la flotte de W-items terra est rodée (W1–W8 livrés) ; A est un miroir 3D du même patron → cadence connue.
- **Satisfiabilité DÉJÀ prouvée** (spike `b67eb222`) — le binding renderer n'est **pas** l'inconnue.

**Scope geo-interne** : miroir 3D de W1–W8 — reconciler / paint-compiler (accessors deck) / viewport
(caméra deck ↔ `GeoViewport` §1.5.1) / tool-context (picking deck) / basemap 3D / mount + `setRenderer('3d')`
(switch **host-stable** §1.1.5 : canvas interne remplacé, sélection/caméra/viewport round-trip). ~8 W-items + le switch.

**⚠ Inconnue MAJEURE (owner-gated, PAS le binding)** : le **fournisseur de tuiles 3D photoréalistes** — D1/D3
(Google Photorealistic 3D Tiles / Cesium ion / self-hosted), arbitrage spike, **coût / licence / clé / CSP /
couverture Québec** (`SPEC_EVOL_3D_MAPS §3, §7 ; D8` fond satellite). **A ne peut PAS aller au bout sans une
AUTRE décision owner** (choix + budget fournisseur) — le risque vit là, pas dans le moteur.

**Valeur** : **aucun consommateur** tant qu'un adaptateur ne l'expose pas → livre un 2e renderer sans valeur
end-user par lui-même.

## B — 1er adaptateur DS (mandat PRIMAIRE : capitaliser les vues immo)

**Objet** : capitaliser les vues immo en **module de navigation geo** inscrit dans la lib sentropic ET le
design system (mandat owner primaire) → **livre la valeur end-user + valide le contrat gelé contre un VRAI consommateur**.

**Steelman (crédité honnêtement)** :
- **Mandat primaire** — c'est la demande de fond ; A en découle.
- **Contrat validé contre un vrai consommateur** — jusqu'ici prouvé par tests+e2e ; un adaptateur DS réel le
  confronte à un usage de production **avant** de scaler à un 2e renderer.
- **Valeur end-user immédiate** (une vue immo migrée sur le moteur capitalisé).

**Geo-interne (fait ou geo-owned)** : `@sentropic/geo-map-engine` (contrat gelé + moteur 2D complet à W8) = le
runtime que l'adaptateur bind. **Reste geo** : **publier le package npm** (conso cross-repo DS) + option
matérialiser `GeoViewport` en `geo-core` (§1.5, release cross-repo).

**Exige DS** (`sent-tech-design-system`) : adaptateur mince `design-system-geo-svelte` (§3 : props→mount/setters,
events→framework, tokens→`TokenMap` via `getComputedStyle`) + chrome (§5 : `GeoLegend`, `GeoMeasureTool` via le
tool-context W6, `GeoBasemapSwitcher`) + rename `GeoChart` (§2) + AppShell drawer / invariant canvas (§4, **DS déjà en cours**).

**Exige immo** (`radar-immobilier`) : migration — externaliser le fetch interne (§6 Gate B élargi
municipalities+zones+lots+signals, C3) + Gate A split de version geo0.5↔immo0.1.1 (C5, coût upgrade `GeoView.svelte`).

**Seams d'intégration** : `TokenMap` (DS `getComputedStyle` → moteur) · host (AppShell → conteneur, invariant §4) ·
données (immo servi → `GeoLayerSpec`) · events (moteur → chrome DS → `selectionState` immo).

**1re vue cible (D5)** : consommateurs de `GeoCityMapBase` (Signaux/Sources) + route geo/`GeoView.svelte` → le
plus simple = **UNE vue migrée**.

**Blocage principal** : **coordination cross-repo** (lanes DS + immo + timing du publish npm), PAS la techno.

## C — Les deux en parallèle (3e option)

A est **solo-driveable côté geo** (pipeline W-items rodé) et la coordination de B a de la **latence** (cross-repo
DS/immo). Comme A et B **n'entrent pas en concurrence sur le moteur gelé** (A = 2e renderer, B = adaptateur ;
lanes différentes), l'owner PEUT lancer **A en fond côté geo** pendant que **B s'amorce en cross-repo** — sous
réserve de ressources et **du déblocage de la dépendance 3D-tiles de A** (sans quoi A plafonne au binding).

## Recommandation WP6

**B d'abord, A ensuite** (ou C si ressources). Raisons :
1. **B est le mandat primaire** et **prouve le contrat gelé contre un vrai consommateur** avant d'investir dans un 2e renderer.
2. **A est bloqué en aval de toute façon** par une décision owner non résolue (fournisseur 3D-tiles) → même
   priorisé, A ne peut pas se terminer sans ce 2e call owner → commencer par B ne coûte rien à A.
3. Découvrir un manque de contrat via un adaptateur réel est moins cher **avant** d'avoir doublé la surface (2D+3D).

**Mais c'est un call owner** — A et B sont deux demandes owner ; la priorisation lui revient (DS/immo sont concernés).

## Réversibilité / séquencement

- **Additif et réordonnable** : A et B sont **indépendants sur le moteur gelé** — ni l'un ni l'autre ne change le
  contrat §1. L'ordre est une **priorisation**, pas une contrainte technique.
- **Parallélisable** (option C) : lanes différentes, fondation commune (moteur gelé).
- **Aucun lock-in** : B ne ferme pas A (3D prouvée par spike) ; A ne ferme pas B.

## Références
- `docs/spec/SPEC_GEO_MAP_ENGINE.md` (§1 gelé, §1.3.4 handle, §1.5.1) ; `docs/decisions.md` ADR-0025/ADR-0026.
- `@sentropic/geo-map-engine` (moteur 2D complet, main @6f97f986) ; spike 3D `b67eb222`.
- immo : `SPEC_EVOL_3D_MAPS_2026-08-14.md` (§3 fournisseurs, §5 UX, §6 gates DS/immo, D1/D3/D5/D8).

**Décision-support — CALL OWNER. Anti-invention : options steelmanées des deux côtés ; reco WP6 explicite mais
non contraignante. Rien n'est gelé/priorisé sans décision owner.**
