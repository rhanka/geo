# SPEC — Plan de migration des pipelines geo vers l'architecture cible (Option B)

> **Synthèse de convergence** (geo-cond, 2026-08-22). Entrées : 2 passes modèles
> indépendantes — `docs/spec/MIGRATION_PLAN_PASS_SOL.md` (gpt-5.6-sol xhigh) et
> `docs/spec/MIGRATION_PLAN_PASS_FABLE.md` (claude-fable-5 xhigh) — plus 2 voix lanes
> convergentes : découpe tronc-commun geo-socle (`work/tronc-commun-refresh-decoupe-20260821.md`
> @833a04e7) et le formalisme cible §A geo-archi (`SPEC_PIPELINES_TARGET_ARCH.md` @6b0cb833).
> **gemini-3.7** : passe bloquée par une dégradation du gateway llm-mesh (529/503) — à ajouter
> en voix supplémentaire quand l'infra récupère.
>
> **Décision owner ratifiée en amont, non rediscutée** : Track `01M0JAMM5YWV1ZH8D6R47RA9A8` →
> **Option B** (strangulation incrémentale par lanes) + les 4 décisions cibles ; **D2** =
> versionner maintenant la capitalisation. WP `01M0N3PGJPY3FK8Y3ACXNV17A8`.
>
> **Méthode** : `[FAIT]` = vérifié fichier:ligne / ref git ; `[JUGEMENT]` = position de la
> convergence ; **les désaccords sont préservés, pas moyennés**. Grounding = `origin/main`
> (≈`fb0f7b62`), pas le checkout d'analyse (voir §0).

---

## §0. Correction de grounding — le checkout d'analyse est périmé

**[FAIT]** Le working tree `feat/cadre-acquisition` est **~1010 commits derrière `origin/main`**
(fable §0, vérifiable `git rev-list --left-right --count HEAD...origin/main`). Conséquence : la
passe sol, lue en partie sur ce checkout, sur-diagnostique le « trou preprod ». Rectification
**grounded origin/main** :

- **ADR-0027 et ADR-0028 EXISTENT** (ratifiées owner, `origin/main:docs/decisions.md`).
- **`cd-preprod.yml` EXISTE** : push `main` → build image → digest → `make k8s-deploy-preprod`
  (kustomize `set image` par digest, ns `geo-preprod`).
- **Le miroir prod→preprod EXISTE** : `scripts/geo-preprod-sync.mjs` (miroir plein `normalized/`,
  prune borné `DEFAULT_MAX_DELETE_FRACTION`, watermark **`coherence.json`**), Job appliqué par
  poc-k8s en fenêtre gatée (NetworkPolicy 2×/32), gate `geo-api-preprod-verify-job` (count +
  set-hash, fail-closed).
- **Manque réel restant** : **C4 release-prod (tag→prod) n'est PAS implémenté** (chantier ADR-0028).

**[JUGEMENT]** Le cycle preprod n'est donc **pas un chantier à inventer** : c'est un socle **déjà
mergé** à étendre (C4 + refresh data on-k8s). Le split-brain git (1010 commits) est lui-même une
violation du principe CONVERGENCE CONTINUE → **Lane 0 du plan = rebase/convergence du poste
d'analyse** (voir §4).

---

## §1. Convergence forte (toutes les voix d'accord)

1. **Modèle DAG** : chaque pipeline devient un DAG dont **chaque nœud lit des artefacts S3
   immuables et écrit un artefact versionné** (clé porteuse `run_id` + hash des entrées). Un nœud
   ne tourne **que si le hash de ses entrées a changé** (fraîcheur *par construction*, pas cron
   aveugle). La promotion vers `normalized/` est le **dernier nœud, atomique**, stampant le
   `coherence_id` (réutilise `buildCoherenceManifest`/`computeSetHash` déjà codés).
2. **Le DAG décide, le LLM exécute** : un nœud LLM est un template gardé par `when:` sur un
   **score d'insuffisance produit par le nœud déterministe précédent**. **3 nœuds LLM dans toute
   l'architecture** (grille résiduelle ; numéro/millésime règlement ambigu ; proposition initiale
   de `prefix_map` usage). Échec de gate = `unknown`, jamais une 2e passe pour fabriquer un vert.
   Réponse cachée par `(input_sha, prompt_version, model_policy)`. `mistral-*` vision reste **banni
   (ADR-0024)** ; seul `mistral-ocr-latest` sanctionné.
3. **Spécifique-ville mutualisé par TYPE DE SITE, jamais par ville** : la variation municipale
   devient une **liste de sources en DATA** (`{slug, adapter_id, urls[], cadence, licence,
   field_map, strict_path, legal_context}`), pas du code. Adaptateurs mutualisés par famille
   (ArcGIS/AGOL, WFS, CKAN, WebLex/OctoberCMS/WP-REST, GoNet/geocentralis, JMap, plan-PDF,
   navigateur Chromium, XML MAMH). **Multi-sources sur un même site** = un seul nœud capture (le
   manifeste porte déjà `slugs[]` multivalué, le CAS déduplique) ; les lanes aval fan-out du même
   artefact. Garde gravée : `city_slug_in_runtime_code` = **métrique CI** (échec si un slug
   apparaît dans le code runtime).
4. **Tronc commun (geo-socle) = T1–T6** (découpe geo-socle, isomorphe à §A geo-archi) : T1 Capture
   (`capturedFetch`+manifeste+CAS, mûr), T2 Serving+refresh (StoreProvider+coherence+verify-gate,
   récent), T3 Normalisation déclarative (`makeFieldMapNormalizer`), T4 Extraction LLM/OCR
   (multi-moteur, appelé PAR le DAG), **T5 Orchestration DAG+fraîcheur = LE gap à construire**,
   T6 Provenance/preuve (manifeste = preuve v2, fail-closed à chaque stage).
5. **LLM via llm-mesh `enroll`** (comptes codex+claude+gemini) ; les pods ne reçoivent **jamais**
   les credentials fournisseurs — seulement une identité de workload + une policy (modèles
   autorisés, budget). Usage LLM minimal, instrumenté par run.

> **Signal de solidité** : sol (modèle) et geo-socle+geo-archi (lanes) ont **convergé
> indépendamment** sur la même architecture (Argo/DAG/artefacts-S3/ville-mutualisée) — c'est un
> anti-artefact, pas un écho.

---

## §2. Architecture cible — les 8 DAGs

**Template commun** `geo-refresh-lane-v1` (possédé geo-socle), composant le tronc :

```
detect-change → plan-worklist → capture-to-S3-CAS → classify
  → native/structured → [OCR si score insuffisant] → [LLM si résidu admissible]
  → validate/close-partition → materialize immutable release → readback gates
  → invalidate downstream joins → promote current pointer (atomique, coherence_id)
```

| Nœuds COMMUNS (geo-socle, `packages/`) | Spécifique mutualisé (config/data par ville) |
|---|---|
| capture · staleness · text-extract · ocr · **llm-extract (gated)** | worklists par lane-source (JSON S3) |
| zone-join (`lotZoneJoin`) · fold (`putServedZoneAdditive`) · promote+verify (coherence) | registre PV (sortir le TS 4500 lignes → data) ; `usage-dominant-map/<slug>.json`, `reglement-provenance.json` (déjà le bon patron) ; page-ranges de grille ; aliases cadastre |

**Les 8 lanes = 8 instances DAG** composant T1–T4 + adaptateurs de source. Résumé des
enchaînements (détail : passes sol §A / fable §A) : **zones** (SIG/plan-PDF→GDAL→preuve v2) ·
**normes/grilles** (règlement→classifieur→native→OCR conditionnel→zone-header→résidu LLM→registre
versionné — supprime le défaut « deux moteurs partout ») · **PV** (index→capture doc→pdftotext→OCR
si scan→parseur sémantique→**événements `zone-change-candidate`**) · **règlement**
(capture→numéro/millésime→registre→`fold-reglement-to-zonage`) · **usage dominant** (réutilise
grille→`prefix_map` validé→`fold-usage-dominant`) · **effet densifiant** (**diff de deux versions
du registre normes** — *gratuit*, aucun moteur nouveau) · **cadastre/rôle** (branches séparées,
**aucun LLM**, rôle en zone restreinte) · **immo-lots** (hashes amont→`lotZoneJoin`/`enrichWithNorms`→
`qc-lots-<slug>`, **aucun LLM**).

---

## §3. Les 2 décisions moteur jumelles — à trancher par l'owner (present-decision)

Ces deux décisions se **conditionnent** (le placement LLM dépend en partie du moteur d'orchestration)
et remontent ensemble dans **UN** dossier present-decision (préparé par geo-archi, recos ci-dessous).

### D-moteur-1 — Orchestrateur DAG (T5)

| Option | Pour | Contre |
|---|---|---|
| **Argo Workflows** *(reco convergence : sol + fable)* | k8s-natif/déclaratif (CRD committé, retry/timeout/`when` sans écrire un scheduler) ; artefacts S3 natifs ; sémaphores pour le quota (ns geo = 6 pods) ; installé au niveau cluster par poc-k8s ; **réversible** (chaque nœud reste un Job k8s seul) | dépendance à un composant cluster ; courbe Argo |
| **DAG-S3-state maison** (étendre `lib/pv-capture-backlog.ts`) *(résiduel : geo-socle D.1 ouvert)* | pattern déjà éprouvé (manifeste immuable + pointeur d'état CAS, phases pending→settled, `max_active_jobs`) ; zéro dépendance nouvelle | réinvente un orchestrateur (= pré-mortem « framework universel ») ; pas de `when`/exit-handlers natifs |

**[JUGEMENT convergence]** Les **2 passes modèles nomment Argo** ; geo-archi garde §A
engine-agnostic. Reco = **Argo, la logique restant en TS dans les conteneurs (Argo n'orchestre
que)**, avec repli documenté vers CronJobs. Owner à ratifier.

### D-moteur-2 — Placement du moteur LLM sentropic — **DÉSACCORD PRÉSERVÉ**

| Position | Voix | Argument |
|---|---|---|
| **Service central sentropic** (gateway `llm.sent-tech.ca`, « sentropic-sentech ») | **fable** | **[FAIT]** `@sentropic/cluster-mesh` = contrats de **fédération d'identité de clusters**, il **ne route AUCUN LLM** ; `push-cluster` (comptes→Secret k8s) est **en suppression** côté h2a ; la décision owner sentropic `DECISION_LLM_EGRESS_STANDARD_PATH.md` retient **Option C** (gateway = porte d'entrée des usages cluster/metered). → « cluster-mesh » comme moteur LLM serait un cul-de-sac. Condition dure : personal-passthrough (comptes owner, pooling cross-user ToS OFF). |
| **Cluster-mesh sentropic partagé** (via ClusterIP) | **sol** | Intégrer le mesh partagé géré par la plateforme, garder le DAG souverain ; ne pas embarquer/forker le mesh ; sentropic-sentech introduirait une frontière distante + un moteur de service plus haut niveau alors que le besoin est un appel borné/auditable/conditionnel. |

**[JUGEMENT — désaccord réel]** fable oppose une réfutation appuyée sur des **[FAIT] cross-repo
(sentropic/h2a) NON re-vérifiés dans cette passe** (cluster-mesh = fédération d'identité sans routage
LLM ; push-cluster en suppression ; `DECISION_LLM_EGRESS_STANDARD_PATH.md` = Option C) que sol ne
traite pas ; le terme « cluster-mesh » du mandat owner est **ambigu** et doit être **levé auprès de
l'owner**. Ces faits **pencheraient vers le service central/gateway SI geo-archi les confirme**
(revue #243 raffinement #1 → vérification indépendante en cours, `SPEC_PIPELINES_TARGET_ARCH` §4.6) ;
tant qu'ils ne sont pas vérifiés, le désaccord reste **pleinement ouvert**. **Je ne tranche pas** :
c'est une décision owner. geo-archi prépare le dossier (vérifie d'abord les faits, puis enjeux
netpol/latence/coût/ToS), recommande, l'owner ratifie **avant l'industrialisation de
l'extraction LLM**. **Intérim** (gateway pas encore servie) : file d'exception CAS + inférence
locale *lecture seule sur octets déjà captés* (légitime `SPEC_CAPTURE_ON_CLUSTER.md §4.2`), bascule
gateway **sans changer le DAG**.

---

## §4. Chemin de migration — strangulation old→new

**Gabarit par lane** : dual-run → comparaison de receipts/partitions → bascule → **suppression du
chemin local** (le shard `fleet.json` de la lane passe à 0 dans la **même PR** — la flotte tmux
meurt par strangulation, pas par décret).

**Lane 0 — convergence & hygiène (préalable, ~jours) — « les commits qui manquent »** :
- rebase/convergence du poste d'analyse sur `origin/main` (le split-brain 1010 est le premier
  défaut à corriger) ;
- **committer `deploy/k8s/geo-pv-refresh-cronjob.yaml`** — actif en prod mais **NON suivi** (défaut
  de capitalisation caractérisé, fable §C) ; dédoublonner les deux CronJobs homonymes
  `geo-pv-backlog-…` à images divergentes (GHCR-digest vs tag Scaleway mutable) ; digest-pin partout ;
- installer **Argo** (poc-k8s) + gate CI **« readback cluster = git »** (un workload actif non
  committé fait échouer la CI).

**P1 — refresh des villes à changement de zone (la commande owner, priorité ratifiée)** :
1. **PV documents+extraction (canari)** : étendre le seul refresh on-k8s actif (index PV,
   `pv-refresh-cron.ts`) en CronWorkflow : index → capture documents (`job-capture.yaml`,
   `pv-capture-backlog-run.ts`) → pdftotext→OCR-si-scan → parseur sémantique → **émission
   d'événements `zone-change-candidate` par ville**. C'est le nœud qui dit **OÙ** rafraîchir.
2. **Règlement** (déclenché par `zone-change-candidate` + staleness) → `fold-reglement-to-zonage` +
   restamp. Shard flotte `geo-reglement` → 0.
3. **Grilles/normes** (même site-engine que 2) → cascade native→OCR (**retirer le défaut `both` de
   `zonage-norms-2engine-keepbest`**, il paie deux moteurs) → nœud LLM gated (après ratification du
   remplaçant vision ADR-0024) → registre versionné → re-join lot-zone incrémental. **Effet
   densifiant** devient un simple diff numérique de deux versions du registre normes.
4. **Zones vectorielles** (WFS/ArcGIS/AGOL/JMap) → re-acquisition par capture-node → **preuve v2 par
   construction** (`proofFromFetched`) → débloque le KPI zones. Obscura/Tor **en dernier** (risque IP
   datacenter prouvé).

**P2 — étude des patterns → consolidation totale** : mesurer, via les receipts P1, taux de recours
par `adapter_id` / coût / échecs ; consolider d'abord les familles couvrant le plus de sources ;
migrer usage dominant, cadastre/rôle (**après l'ADR Loi 25**, §5.2), immo-lots ; extinction de
`geo-fleet.ts` ; revue des ~541 sondes `_*.ts` (archivage, promotion en lib de ce qui a servi deux
fois). **Sortie P2** : zéro refresh prod hors DAG (fleet/tmux/Serverless-hors-cluster/`_*.ts`) ;
100 % des partitions avec état terminal.

---

## §5. Les 6 arbitrages — reco de convergence (à graver en décisions Track)

| # | Arbitrage | Reco de convergence |
|---|---|---|
| 1 | **Reco4 tag-mécanisme** | Tag **SemVer signé/annoté `v*`**, protégé, pointant un SHA de `main` à `PREPROD_ACCEPTANCE` immuable ; `release-prod` exige le **same-digest** (jamais de rebuild) ; **le tag ne rejoue PAS toutes les données** (produites en continu par les DAGs on-prod, versionnées par `coherence_id`) ; **ne pas inventer `prod/current.json`** → étendre `coherence.json`. Rollback = re-pin digest + re-pointer `coherence.json`. |
| 2 | **Loi 25 / rôle** | **Allowlist de champs committée + garde de lib fail-closed** (pattern `assertVisionModelAllowed`) : lib fetch-only par défaut ; parse autorisé **uniquement** des champs d'emplacement non-personnels (jamais propriétaires/RL0101) ; `role:lot` porte capture+minimisation+`PII_REFUSED` ; raw chiffré, **aucune copie preprod**, aucun LLM, allowlist de sortie publique. **ADR dédiée ratifiée owner requise** ; tant qu'elle n'existe pas, cadastre/rôle **ne migre pas** sur k8s et l'adresse reste `unknown`. |
| 3 | **Seuil pruning preprod** | Prune **borné (10 %** fable / **20 % bootstrap** sol — *à trancher owner dans cette fourchette*) par fenêtre de sync ; au-delà → dry-run diff + **approbation owner** ; delete-list journalisée dans le manifeste de cohérence ; `raw/**`, CAS, `capture/_runs/**`, receipts, backups **jamais** prunés ; source vide = refus. |
| 4 | **Seuil tag prod** | Gate **non-régression, PAS complétude** : verify-job preprod vert (parité count+set-hash, coherence fraîche) ; CI verte ; **Δ portfolio ≥ 0** sur colonnes servies (aucune ville ne régresse) ; drill rollback re-pin < 90 j. Toute suppression = **tombstone déclaré + approuvé owner** ; baisse >1 % features/octets = anomalie bloquante. |
| 5 | **ADR-0027/0028** | **Existent, ratifiées** (§0) — la « réconciliation » est **close**. Conserver leur contenu intégralement ; **écrire une ADR-0029** (orchestration DAG + nœud-LLM-gated + gateway/placement + ordre de strangulation) + l'**ADR Loi 25** (#2). Amendement mineur 0027 : étendre `coherence_id` aux produits de DAG (lineage run→collection). *Ne pas renuméroter.* |
| 6 | **4 conductors manquants** | **Consolider à ~5 conductors** (pas créer 4 lanes de plus) en suivant les dépendances de moteur. Convergence : **normes + effet densifiant → un conductor** (l'effet EST un diff normes — fable propose `geo-normes`) ; **usage dominant → `reglements`** ; **cadastre/rôle → `geo-lot`**. geo-socle porte les **moteurs**, pas une lane ; `geo-cond` arbitre le portefeuille ; Argo conduit les runs. *(Léger delta sol/fable sur le regroupement normes — à figer à la ratification.)* |

---

## §6. Lifecycle code / preprod / prod consolidé

**Merge `main` → preprod** *(étend l'existant §0)* : CI + `cd-preprod.yml` (build→digest→kustomize→
ns `geo-preprod`) ⇒ fenêtre gatée poc-k8s : `geo-preprod-sync` **miroir plein prod→bucket preprod
séparé** (sens-unique par credentials, prune borné §5.3) + stamp `coherence.json` ⇒ `verify-job`
parité fail-closed ⇒ **[nouveau]** exécution des DAGs en **mode canari** (échantillon représentatif
par famille de source, **pas 1106**) dans `preprod-runs/<sha>/` ⇒ `PREPROD_ACCEPTANCE`. *Preprod
prouve le CODE des pipelines sur données réalistes écrasables. Un merge sans changement effectif =
run idempotent `skipped-by-hash`, jamais un vert par omission.*

**Tag `v*` → prod (C4, à implémenter)** : `release-prod` : same-digest + acceptance exigés ⇒
backup/inventaire signé + object-versioning **avant** mutation ⇒ migrations de layout S3 par **Job
idempotent** avant bascule serving ⇒ apply overlay prod ⇒ les **CronWorkflows prod produisent les
vraies données en continu**, chaque promotion stampée `coherence_id` ⇒ rollback = re-pin digest +
version précédente des CronWorkflows.

**Garde-fous anti-perte (données ET jobs)** : sens-unique par credentials (ADR-0027 inv.3) ; `raw/`
append-only + CAS ; versioning bucket ; **parité git↔cluster en CI** (workload actif non committé =
échec readback) ; **migration d'un job** = `suspend` l'ancien → dual-run → **delete du YAML dans la
même PR** que l'armement du nouveau ; jamais deux workloads homonymes à images divergentes (cas
constaté aujourd'hui). Détail serving/provenance : voir l'input geo-archi
`INPUT_PREPROD_SERVING_S4_RESPEC.md` (index-discipline `isCanonicalGeojsonKey` family-agnostic ;
durabilité provenance 2 buckets ; served-id = `datasetId ?? stem` — **SoT durable = spec socle
rapatriée ADR-0027/SPEC_GEO_PREPROD_SERVING**, ce plan la référence).

---

## §7. Risques majeurs & pré-mortem

1. **Split-brain git récidivant** *(constaté : cette commission a produit des faux constats sur
   checkout périmé)* → gate refusant un dossier/analyse ancré à > N commits de `origin/main` ;
   Lane 0 obligatoire.
2. **Argo devient un emballage de 1106 scripts** → schéma fermé, registre d'adaptateurs, gate CI
   `city_slug_in_runtime_code`, KPI `runs hors DAG` publié au portfolio ; une lane migrée supprime
   sa flotte dans la même PR.
3. **Dual-run perpétue le split-brain** → releases shadow, lease unique sur `current`, date de
   retrait obligatoire par lane.
4. **Source municipale cassée → régression en masse** → capture durable des échecs, quarantaine,
   seuils de delta, conservation de la dernière release prouvée ; **jamais promouvoir un vide**.
5. **Quota ns geo (6 pods / ~2 utiles)** → sémaphores Argo, demande de quota poc-k8s, Serverless
   Scaleway comme **adaptateur du même nœud** pour les lanes massives (pas un chemin parallèle).
6. **Mesh épuise les comptes / réintroduit l'agent comme opérateur** → budget par lane, cache CAS,
   circuit breaker ; panne mesh → `unknown`, le DAG déterministe continue ; ToS pooling reste OFF
   (personal-passthrough).
7. **Prune / migration rôle divulgue ou détruit** → buckets/credentials séparés, raw rôle exclu du
   miroir, scan PII, restore drill, refus `PII_REFUSED`.
8. **Tag partiellement réussi (nouvelles données, anciens jobs)** → release manifest unique
   code+données+jobs, lease, transaction de cutover, rollback conjoint (pointeur **et**
   CronWorkflows).

**Pré-mortem global (6 mois)** : Argo installé, 2 lanes migrées, la flotte tmux vit encore, le LLM
est resté l'opérateur du rattrapage, C4 jamais implémenté. **Antidotes déjà dans le plan** : Lane 0
avant P1 ; strangulation mesurée `fleet.json→0` lane par lane ; **C4 dans le premier lot P1, pas en
queue** ; portfolio publie `runs hors DAG` + âge par lane pour rendre la dérive **visible, pas
déniable**.

---

## §8. Décisions owner & prochaines actions

**À trancher par l'owner (present-decision jumeau, geo-archi prépare)** :
- **D-moteur-1** orchestrateur : Argo *(reco)* vs DAG-S3-state maison.
- **D-moteur-2** placement LLM : **service central/gateway** *(convergence, mieux groundé)* vs
  cluster-mesh — **désaccord réel**, terme « cluster-mesh » à clarifier.
- **Seuil pruning preprod** (§5.3) : 10 % vs 20 % bootstrap.

**À graver en décisions Track** (recos §5, la plupart déterministes) : tag-mécanisme, Loi 25 (ADR),
tag prod non-régression, ADR-0027/0028 conservées + ADR-0029, consolidation à ~5 conductors.

**Commits qui manquent (Lane 0, à initier)** : committer `geo-pv-refresh-cronjob.yaml`,
dédoublonner les CronJobs homonymes, digest-pin, gate CI readback=git.

**Séquençage capitalisation** : ce plan + les 2 passes brutes + le formalisme §A + la décision
re-gravée → **UN** PR propre vers `origin/main` (worktree isolé off main ; `.track` protégé
branch-lifecycle) ; geo-archi pousse **un** commit de suivi batché (recale-ULID + grounding
`pv-capture-backlog` + écart T5-engine + cross-ref découpe socle) informé par cette synthèse.
