# Synthèse D-moteur-1 (orchestrateur DAG) — ré-étude sous les 3 exigences owner

> **geo-cond, 2026-08-22.** Ré-ouverture de D-moteur-1 par l'owner avec 3 exigences décisives :
> (1) **API de supervision du scraping consommable par immo** ; (2) **étude SOTA** (pas seulement
> Argo vs pv-capture-backlog) ; (3) **si custom → lib publiable réutilisable**. Entrées :
> passe indépendante `MIGRATION_D1_ORCHESTRATOR_STUDY_SOL.md` (gpt-5.6-sol xhigh) + input
> architecture geo-archi (WP6). **gemini-3.7 : bloqué par la dégradation du gateway llm-mesh
> (503, infra) — voix à ajouter si le gateway récupère.** `[FAIT]` = vérifiable ; `[JUGEMENT]` = position.

## Reco (build-vs-buy) : **cibler la lib custom `@sentropic/s3-dag`** — Argo en **fallback documenté**

**Convergence indépendante** — trois voix pointent le même choix :
- **sol** : « recommander une lib publiable custom, et non Argo » — l'exigence supervision change la décision.
- **geo-archi** : « le critère *API de supervision pour immo* re-pondère vers un DAG-S3 geo-shaped, pas Argo »
  (l'état est déjà en S3, geo sert déjà immo depuis S3 → API de supervision naturelle et S3-first).
- **owner (steer)** : « Argo permet ça sans usine à gaz ? sinon DAG-S3 custom … lib publiée ».

### A. Le critère décisif — l'API de supervision pour immo
**[FAIT]** Le chemin de service existe déjà : `geo-api` (Hono, lit S3) et `radar-immobilier` autorisé à
joindre son ClusterIP ; le proto `pv-capture-backlog.ts` porte déjà manifeste immuable, état CAS, phases,
avancement, état terminal, quota observé. **[JUGEMENT]** L'API immo doit exposer un contrat **métier**, pas
des objets k8s :
`GET /v1/refresh/overview?lane=&city=` (état, dernière réussite, fraîcheur `fresh|stale|unknown|refused`,
run actif, échec bloquant) · `/v1/refresh/runs` (historique paginé) · `/v1/refresh/runs/{run_id}`
(DAG, nœuds/attempts, avancement `{done,total,percent}`, artefacts) · `/v1/refresh/freshness`
(`observed_at`, `last_success_at`, cadence, cause de staleness). **La fraîcheur vient du dernier artefact
promu, pas du dernier Job vert** ; `skipped_unchanged` terminal sain ; `unknown`/`refused` = états fermés.

**[JUGEMENT — nuance décisive (geo-archi, anti-biais)]** « API supervision ⟹ custom » est un **lean, pas une
preuve**. La `freshness` (dernier artefact promu) est **indépendante de l'orchestrateur** — elle lit l'état S3
promu, qu'Argo ou le custom tourne derrière. Le vrai avantage custom porte **spécifiquement sur le `run-history`
(`/runs`)**, nettement plus propre en **S3-natif** que via l'archive-DB + le hop-API d'Argo. **Le choix est donc
un build-vs-buy**, pas une conclusion forcée : facteurs décisifs = **run-history S3-natif + fit 8-DAGs-fixes /
quota-6-pods + lib réutilisable**, **pesés contre le coût de build/maintenance** d'un orchestrateur custom.

**[JUGEMENT] Argo ne sert pas seul ce contrat.** Son API est *Argo-shaped* (Workflow CRD) ; l'historique
long exige le **Workflow Archive sur PostgreSQL/MySQL** ; conserver des Jobs `batch/v1` autonomes exige un
`resource template`. Les 3 intégrations possibles (proxy Argo / lire les CRD / projecteur Argo+S3→index
ville-lane) laissent toutes un read-model métier à construire. **Argo n'est pas une usine à gaz en soi ;
« Argo + server + SQL d'archive + façade geo + index S3 » le devient** pour 8 DAGs fixes et un quota ~6 pods.
Le custom : geo-api lit directement des index S3 versionnés — une sémantique, une rétention, zéro permission
k8s côté API, contrat produit stable même si l'exécuteur change.

**[JUGEMENT — strongest-case Argo, préservé (geo-archi)]** À charge d'Argo : **zéro orchestrateur custom à
maintenir** (controller/server off-the-shelf), sémantique DAG/retry/`when`/observabilité **battle-tested**,
**réversible en CronJobs**. Un custom, lui, est du **code de scheduler à écrire, tester crash-safe et
maintenir** — et « étendre `pv-capture-backlog` » **sous-estime peut-être** le lot réel : un moteur multi-DAG
avec **invalidation cross-lane** (zones→lots→normes→effet) + staging + promotion + API de supervision est
**plus** qu'un backlog-controller mono-lane. ⟹ **Argo reste le fallback explicite documenté** si les 4 preuves
du gate échouent ou si le scope enfle (réversibilité réelle, cf. §D).

### B. SOTA — pourquoi aucun off-the-shelf ne gagne ici
**[FAIT/JUGEMENT]** Survol (sol) : **Argo** (meilleur générique k8s, mais double état + 2 pods de contrôle
pour l'API ciblée) · **Temporal** (event-history remplace S3 comme vérité + control-plane distribué =
surdimensionné) · **Dagster/Prefect** (Python + DB + workers, API non contractuelle) · **Windmill/Inngest/
Hatchet/DBOS** (TS mais workers permanents + état en PostgreSQL, pas S3-first) · **Restate** (bon durable-TS
mais mauvais modèle d'exécution + risque endpoint S3 OVH). **Commun** : tous ajoutent une DB et/ou des workers
permanents, et déplacent l'état hors de S3 — alors que les artefacts/receipts geo **vivent déjà en S3** et
l'unité naturelle est **un Job k8s par nœud**.

### C. `@sentropic/s3-dag` — lib étroite, publiable
**[JUGEMENT]** Apache-2.0, SemVer, schémas JSON + OpenAPI + tests de conformité. **Contrat assumé** : DAG
acyclique connu au build, état S3, exécution at-least-once par **Jobs idempotents**, pas de boucles/signaux
humains/transactions distribuées (sinon → nouveau dossier). API `defineDag({nodes:{… job({needs, when:
receiptPredicate(...), concurrencyKey})}})` + `reconcileTick({store, executor: kubernetesJobs(), quota})` +
`supervision(store).getRun(id)` (monté dans l'API Hono existante). **Modèle d'état S3** (généralise le pattern
PV manifeste-immuable + pointeur CAS) : `definitions/`, `runs/<run_id>/{manifest,nodes/<n>/<attempt>/receipt,
states/<sha>,latest}`, `indexes/{lanes,cities}/…/latest` ; seuls les `latest.json` mutent par `If-Match`
(le repo a déjà `putBytesIfMatch` + snapshot-then-CAS dans `geo-served-contract.ts`). Réconciliateur = CronJob
court (lease k8s + CAS), observe le `ResourceQuota`, réserve la place de geo-api, noms de Jobs déterministes
(reprise après crash), `backoffLimit:0` par défaut. **Elle bat les alternatives ici** : zéro DB, zéro worker
permanent, zéro serveur de supervision ; elle démontre un savoir-faire réutilisable (state-machine crash-safe,
CAS, quotas, receipts, OpenAPI) en laissant le métier geo dans geo.

### D. Réversibilité, coût, garde-fous
- **[JUGEMENT] Réversibilité** : contrat S3 + Jobs **engine-neutral** — un adaptateur futur peut compiler la
  définition vers des `resource` templates Argo (geo-api lit les mêmes receipts/index) ; **la sortie du custom
  est moins coûteuse que la sortie d'Argo** (qui exigerait d'importer CRD/archive). Réexamen si : boucles/signaux
  humains, multi-cluster actif, orchestration sub-seconde, ou > 20 Jobs concurrents soutenus → Argo/Temporal/Hatchet
  redeviennent pertinents.
- **[JUGEMENT] Coût** (hors migration des 8 lanes) : Argo ≈ 5–10 j canari + 10–20 j (archive/sécurité/façade/
  projection) ; **custom ≈ 20–30 j (PV canari + cœur) + 10–15 j hardening/doc/publication**. Le custom coûte plus
  au départ mais retire l'exploitation continue d'un controller/server/DB et **livre exactement l'API décisive**.
- **[JUGEMENT] Garde-fou central (geo-archi + sol)** : **rester scopé** — étendre `pv-capture-backlog`, **PAS
  réécrire Airflow/Temporal**. Budget de scope gelé ; toute demande de boucle/signal/transaction force un nouveau
  dossier (anti pré-mortem « framework universel »). Risques gatés : CAS S3-compatible **à prouver en canari OVH**
  (`If-Match`/412/read-after-write) ; bugs de scheduler (validation acyclique + crash-injection) ; index S3
  reconstructible depuis les seuls objets immuables (readback, aucun vert par omission) ; RBAC ns minimal ;
  API immo strictement read-only.

## Ce qui reste à confirmer / trancher
- **[owner]** ratifier **custom `@sentropic/s3-dag`** (vs Argo, vs défère) — avec **gate** : PV en canari, puis
  ratification owner après démonstration de **4 preuves** (reprise après crash · respect réel du quota ·
  read-model immo complet · reconstruction totale des index depuis les seuls objets S3 immuables).
- **[dépendance]** gemini-3.7 non consulté (gateway 503) — voix supplémentaire si l'infra récupère.
