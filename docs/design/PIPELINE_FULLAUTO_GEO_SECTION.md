# Pipeline full-auto — SECTION geo (2 sous-domaines) — input design-doc commun

> **But.** Contribution **geo-archi (wp6)** au design-doc commun du pipeline refresh 100% automatisé sur k8s
> (track `01M1S25MVCND04YZN76KTVNGAE`, doc canonique consolidé immo/i-cond). Grounded repo (measure>infer,
> sweep 2026-09-05, file:line). Mes 2 sous-domaines : **satellite/3D-tiles VIEW** + **extraction-archi
> (graphify↔llm-mesh↔cluster-mesh)**. Format par sous-domaine : (i) reusable/create · (ii) flux full-auto
> minimal (seuls composants nécessaires) · (iii) ce que ma couche PRODUIT vers le graphe canonique (immo-owned).
> **Seam graphe** : `canonical-graph + atomic-PG-writer = IMMO-owned` (i-arch) ; ma couche l'ALIMENTE par un
> contrat cadré (i-arch + geo-cond) APRÈS cet inventaire.

## EN TÊTE — 2 décisions AI-gating owner-précoces (chemin critique de la couche IA)

**GATE #1 — ADR-0024 remplaçant vision (extraction).** État grounded : route vision **INOPÉRANTE par
construction** (`grille-vision-extractor.ts:351` appelle `assertVisionModelAllowed` → throw sans modèle
sanctionné ; garde `vision-engine-policy.ts:25,45` live + CI-test ; **aucun modèle remplaçant câblé** ;
**aucun ADR de suivi**). Décision : candidat modèle vision fort **via gateway** (a priori `gpt-5.6-terra`/`luna`
xhigh, prompt JSON strict par cellule + gardes anti-décalage), **benchmark sur grilles DÉJÀ extraites** (0
re-paiement Mistral) → **double-consensus + ratif geo-archi** → nouvel ADR. **⚠ Blocker run** : l'exécution du
benchmark exige le gateway/Codex (**down →6/09**) → design + critères **maintenant**, run **post-gateway**.
**Non-vision avance en //** (OCR `/v1/ocr` `mistral-ocr-latest` sanctionné).

**GATE #2 — LLM-engine hosting (A.3 / D-moteur-2) : CONFIRMER la direction owner « cluster-mesh », trade-off
exposé.** **Reframe (i-cond)** : l'owner a **DÉJÀ énoncé la direction** (« pipeline basé sur cluster-mesh »,
« graphify intégré au cluster-mesh »). ⟹ le dossier = **EXPOSER LE TRADE-OFF fidèlement pour un CONFIRM/override
informé, PAS re-litiger de zéro**. Trade-off (2 faces) : **(a) cluster-mesh-hosting [direction owner]** vs
**(b) service central `sentropic-sentech`** — netpol / latence / coût / effort exposés pour chacune. **⚠ Term-lift
à graver — FAIT, input au côté COÛT/EFFORT du trade-off, PAS un argument d'override** : le `@sentropic/cluster-mesh`
**EXISTANT = fédération d'identité, ne route AUCUN LLM** (`git grep cluster-mesh` geo = 0 ; grounding fable
cross-repo ; seule occurrence = doc-comment `packages/s3-dag/src/identity.ts:31`). Donc « cluster-mesh LLM-hosting »
**ne réutilise pas ce package** — c'est un **NOUVEAU mesh inter-cluster LLM à construire** (#627
`SPEC_LLM_CLUSTER_MESH` = socle). Ce fait informe le coût de la face (a) pour un confirm éclairé — **il ne
re-litige pas la direction**. **present-decision dossier** : substance prête (2 faces steelmanées + [FAIT]/
[JUDGMENT] + term-lift + grounding repo + revue **fable**). **Caveat codex-sol (levé par le reframe)** : la 2e
passe design codex-sol (gateway-bloquée) était requise pour une décision **ouverte-de-zéro** ; pour une
**exposition-de-trade-off** (confirm/override), **la substance suffit** → **codex-gap flaggé honnêtement mais
NON-bloquant** pour ce but précis. Gate le **llm-mesh** (A.2, absent in-geo) + conditionne netpols/latence/coût IA
in-cluster.

---

## SOUS-DOMAINE 1 — Satellite / 3D-tiles VIEW

### (i) Reusable / create
- **REUSABLE (deployed)** : §5 2D satellite client-mint — endpoint descripteur (`packages/geo/src/basemap/endpoint.ts`),
  adapter (`geo-map-engine/src/basemap-google2d-adapter.ts`), workflow `basemap-activate.yml` (GO#2 owner-gated),
  overlay préprod flag-ON, RBAC least-priv single-secret. Code-complete, mergé, gouverné (ADR-0030/0031).
  **Scaffolding** : budget-guardrail GCP (`docs/ops/gcp-3dtiles/`, runbook owner-exécuté, gate testable — PAS CI-auto).
- **INERTE** : live serving = **503 jusqu'à GO#2** (owner-gated key mint) — **activation, pas build**.
- **TO-CREATE** : **3D-tiles serving ENTIÈREMENT**. `mount.ts:45,61,161` hard-throw `PENDING_3D` sur `renderer:"3d"` ;
  pas de `mount-3d.ts`, pas de `GEO3D_ENGINE_ENABLED`, pas de `Tile3DLayer`/Cesium/Photorealistic.
  `SPEC_GEO_MAP_ENGINE_V2_PHOTOREAL` = **roadmap non-ratifiable, 8 blockers ouverts** (track SÉPARÉ).

### (ii) Flux full-auto minimal
Le satellite/3D est une **couche VUE (display)**, PAS un pipeline de refresh de données. → **léger pour le full-auto** :
- **2D** : rien à refresher (tuiles live navigateur→Google ; activation GO#2 = one-shot owner-gated ; seul composant
  « opérationnel » = le budget-guardrail → **owner-manuel** recommandé (garde-fou coût = décision owner, pas auto)).
- **3D** : **hors scope du full-auto immédiat** (track PHOTOREAL séparé, non-ratifiable).
- **Composants nécessaires** : quasi-nuls pour le pipeline de données (le satellite est un fond, pas une donnée refreshée).

### (iii) Ce que ma couche PRODUIT vers le graphe canonique — **feed MINCE**
Couche VUE → **peu de données graphe**. Elle **CONSOMME** le graphe (rend les couches data sur le fond). Contrat
**léger** : métadonnées provenance-de-vue (fond/attribution/coverage), (3D futur) tileset metadata. **Pas de données domaine.**

---

## SOUS-DOMAINE 2 — Extraction-archi (graphify ↔ llm-mesh ↔ cluster-mesh) — **le cœur**

### (i) Reusable / create
- **REUSABLE (deployed)** : briques extraction — grille parsers natifs + classifier + locators (tested) ;
  `grille-ocr-extractor.ts` (`/v1/ocr` `mistral-ocr-latest` **sanctionné**, backend-pluggable `OCR_PROVIDER`) ;
  garde `vision-engine-policy.ts` (live, enforce ADR-0024). PV : pilot `pv-graphify-run.ts` (graphify↔PV knowledge-graph).
- **IN-BUILD (scaffolding)** : `@sentropic/s3-dag` (orchestrateur **D-moteur-1 ratifié**, lib testée :
  dag/executor-k8s/quota/reconcile/lease/identity ; PV canary câblé ; **gate 4-preuves pending — PAS promu** en moteur prod).
- **TO-CREATE** : (1) **remplaçant vision** [GATE #1] ; (2) **routeur cascade commun** insufficiency-scored (drop
  défaut `both`) — briques existent, routeur `[cible]` ; (3) **llm-mesh** (absent in-geo, A.2 `[cible]`, cross-repo) ;
  (4) **cluster-mesh/D-moteur-2** [GATE #2] ; (5) **graphify↔extraction généralisé** (typed-linking `zone_code` =
  **proposal non-ratifié au maintainer graphify externe**, `SPEC_GRAPHIFY_TYPED_LINKING_CAPABILITY`) ; (6)
  **Refresh Controller / DAG-invalidation-par-hash / staging versionné** (`[cible]` target-arch).

### (ii) Flux full-auto minimal (SEULS composants nécessaires)
Chaîne minimale (grounded `SPEC_PIPELINES_TARGET_ARCH`) : **Capture** (EXISTE `capturedFetch`→CAS+preuve-v2) →
**Normalize** (EXISTE par-famille) → **Extract** (routeur cascade minimal : natif → `pdftotext` → **OCR sanctionné
conditionnel** → **modèle-fort sur résidu mesuré SI GATE #1 résolu**) → **Join** (EXISTE `lotZoneJoin`) → **Gate**
(EXISTE verify / `[cible]` per-lane) → **Promote** (EXISTE `coherence.json`).
**Réduction aux seuls nécessaires** :
- **Orchestration = `@sentropic/s3-dag`** (D-moteur-1 ratifié) — **PAS Argo, PAS un nouveau moteur**. Le SEUL
  orchestrateur ; à **promouvoir** (gate 4-preuves sur canary PV) puis généraliser par-lane (Refresh Controller).
- **Extraction IA = cascade LLM-minimal** (natif/OCR d'abord, **modèle-fort SEULEMENT sur résidu mesuré**) → **pas
  de vision-par-défaut**. Le modèle-fort résiduel passe par **llm-mesh (gateway)** → dépend de **GATE #1** (candidat
  vision) + **GATE #2** (hosting du moteur).
- **graphify** = couche knowledge-graph (PV pilot extensible ; typed-linking = proposal externe).
→ SEULS nécessaires : **s3-dag + cascade-extract-minimal + contrat d'alimentation graphe**. Pas de sur-ingénierie
(0 Argo, 0 moteur-LLM-nouveau si central-service tranché, 0 vision si résidu-nul).

### (iii) Ce que ma couche PRODUIT vers le graphe canonique — **feed RICHE (le poids du contrat)**
Sorties d'extraction **STRUCTURÉES + normalisées + provenance-v2** (url/retrieved_at/sha256) :
- **zonage** (zones + usages dominants), **normes** (grilles → valeurs par cellule), **env-constraints**
  (CPTAQ/BDZI/GRHQ hits + couverture 3-états), **effet-densifiant** (avant/après).
- **Format contrat (à cadrer i-arch + geo-cond APRÈS cet inventaire)** : nœuds typés (`zone_code`,
  `norme-cell-value`, `constraint-hit`, `usage-dominant`) + arêtes (`lot↔zone`, `zone↔norme`, `zone↔constraint`)
  + **provenance par nœud**.
- **graphify** : la couche knowledge-graph (PV → entités/relations ; extensible règlements/zonage via typed-linking si accepté).
→ **Le contrat d'alimentation** (i-arch `atomic-PG-writer` immo-owned ← mon extraction) formalise quels
**nœuds/arêtes/provenance** ma couche écrit. **C'est ici que le poids du seam graphe porte.**

---

## RÉSUMÉ / next
- **SD-1 (satellite/3D)** : **léger** pour full-auto (2D fait, GO#2 owner restant ; 3D = track séparé PHOTOREAL).
  Feed graphe **mince** (provenance-de-vue).
- **SD-2 (extraction)** : **le cœur**. Réutilise **s3-dag** (orchestration) + les briques extract ; à-créer =
  **routeur cascade** + les **2 gates AI** + le **contrat d'alimentation graphe**. Feed graphe **riche**.
- **2 gates owner-précoces** = **chemin critique** de la couche IA, escaladés par i-cond : **vision ADR-0024**
  (décision de principe : candidat + méthode maintenant, run post-gateway) + **D-moteur-2** (**CONFIRMER** la
  direction cluster-mesh owner + trade-off exposé — PAS re-litiger). Mes 2 dossiers prêts (caveats gateway-down
  honnêtes ; le caveat codex-sol de D-moteur-2 est **levé** par le reframe trade-off-exposition).
- **Contrat d'alimentation graphe** (i-arch + geo-cond, après cet inventaire) = le prochain seam à cadrer pour SD-2.
