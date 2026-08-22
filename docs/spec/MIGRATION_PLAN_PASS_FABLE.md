# Passe fable-5 — Plan de migration des pipelines geo (convergence indépendante)

> Passe indépendante `claude-fable-5`, 2026-08-22. Entrées : `CLAUDE.md`,
> `docs/spec/DOSSIER_PIPELINES_SOL_ANALYSIS.md`, `docs/spec/COMMISSION_PIPELINES_DOSSIER.md`,
> code réel (`acquisition/src`, `packages/qc-sources`, `packages/geo`, `deploy/`, workflows),
> plus lecture croisée des repos frères `sentropic`, `h2a`, `poc-k8s` (via `git grep`/`Read`).
> Décision owner ratifiée en amont, non rediscutée : **Option B strangulation + 4 décisions
> cibles ; D2 = versionner maintenant la capitalisation.** `[FAIT]` = vérifié fichier:ligne ;
> `[JUGEMENT]` = position de cette passe.

## 0. Correction préalable — l'analyse Sol repose partiellement sur un checkout périmé

**[FAIT]** Le working tree `feat/cadre-acquisition` est **1010 commits derrière `origin/main`**
(`git rev-list --left-right --count HEAD...origin/main` → `10 / 1010`). Conséquences directes :

- **ADR-0027 et ADR-0028 EXISTENT**, acceptées et ratifiées owner, sur
  `origin/main:docs/decisions.md:558` et `:582`. Le constat Sol §11.5 (« aucune entrée
  correspondante ») est un artefact de checkout.
- **`cd-preprod.yml` EXISTE** (`origin/main:.github/workflows/cd-preprod.yml`) : push `main` →
  build image → digest → `make k8s-deploy-preprod` (kustomize `set image` par digest, ns
  `geo-preprod`, secrets `SCW_SECRET_KEY` + `KUBE_CONFIG_DATA_PREPROD`).
- **Le miroir prod→preprod EXISTE** : `origin/main:scripts/geo-preprod-sync.mjs` (miroir plein
  `normalized/`, prune borné `DEFAULT_MAX_DELETE_FRACTION`, watermark **`coherence.json`** —
  pas `current.json`), Job `geo-preprod-sync` appliqué par poc-k8s en fenêtre gatée
  (NetworkPolicy à 2 ipBlocks /32), gate `geo-api-preprod-verify-job` (count + set-hash,
  fail-closed).
- Manque réel restant : **C4 release-prod (tag→prod) n'est PAS implémenté** (chantier ADR-0028,
  « attend BR-55d »).

**[JUGEMENT]** La synthèse geo-archi doit requalifier le « trou preprod » de Sol : ce n'est pas
un chantier à inventer, c'est un socle **déjà mergé** à étendre (C4 + refresh data). Et le
split-brain git (1010 commits) est lui-même un cas du principe CONVERGENCE CONTINUE violé — la
première action du plan est un rebase/convergence du poste d'analyse.

---

## A. Architecture cible : les 8 pipelines comme DAGs sur k8s

### A.1 Le modèle : nœuds = artefacts versionnés S3, arêtes = hashes d'entrée

**[FAIT]** Les trois noyaux existent déjà : capture typée (`packages/qc-sources/src/capture/
{manifest,worklist,capturedFetch}.ts` — chokepoint, CAS `raw/`, manifeste `capture/_runs/`),
jointure déterministe (`packages/geo/src/zonage/lotZoneJoin.ts` — canonicalisation source-of-truth,
pont numérique, `unassigned` fermé), serving S3/OGC (`store-provider.ts` + geo-api k8s). Ce qui
manque est **orchestrationnel** (Sol §4.2, confirmé) : pas de graphe d'invalidation par hash,
pas de staging/promotion par run.

**[JUGEMENT]** Cible : chaque pipeline est un DAG dont **chaque nœud lit des artefacts S3
immuables et écrit un artefact versionné** (clé porteuse de `run_id` + hash des entrées). Un
nœud ne tourne que si le hash de ses entrées a changé (staleness par construction, pas par
cron aveugle). La promotion vers `normalized/` est le **dernier nœud**, atomique, stampant le
`coherence_id` — on réutilise le pattern déjà codé (`packages/geo/dist/preprod`:
`buildCoherenceManifest`, `computeSetHash`).

### A.2 Nœuds communs (geo-socle) vs spécifique-ville mutualisé

**[FAIT]** geo-socle n'est pas un repo : c'est le rôle « tronc commun / build » tracé
(`.track/events.jsonl:21236,21303`), face à geo-archi (contrats seuls).

**[JUGEMENT]** Répartition :

| Nœuds COMMUNS (geo-socle, dans `packages/`) | Nœuds SPÉCIFIQUES mutualisés (config/data par ville) |
|---|---|
| `capture` (worklist → capturedFetch → CAS+manifeste) | worklists par lane-source (JSON S3, jamais TS) |
| `staleness` (ETag/Last-Modified/hash → replan) | registre PV villes : sortir le TS de 4500 lignes vers données validées |
| `text-extract` (pdftotext + parsers gardés) | configs `usage-dominant-map/<slug>.json`, `reglement-provenance.json` (déjà le bon patron) |
| `ocr` (mistral-ocr, artefact durable) | page-ranges / gabarits de grille par ville (données) |
| `llm-extract` (gated, voir A.3) | — |
| `zone-join` (lotZoneJoin + partition fermée) | aliases cadastre (sortir de `lot-zone-join-run.ts:47-52`) |
| `fold` (règlement/usage/effet via `putServedZoneAdditive`) | vetos/maps par slug |
| `promote+verify` (coherence, non-régression) | — |

Le **spécifique-par-ville se mutualise par TYPE DE SITE**, pas par ville : moteurs
WebLex / OctoberCMS / WP-REST / GoNet / ArcGIS-AGOL / WFS / JMap / geocentralis / plan-PDF.
`proces-verbaux-generic.ts` et `zones-wfs-run`/`zones-arcgis-replace` prouvent que le patron
marche. **Multi-sources sur un même site** : la capture est UN nœud par site (le même fetch
alimente PV + règlement + grille quand ils vivent sur le même CMS — la ligne de manifeste
porte déjà `slugs[]` multivalué et le CAS déduplique), et les lanes aval fan-out depuis le
même artefact. Interdiction gravée : `city_slug_in_runtime_code` = métrique CI (reprise de
Sol, ratifiée ici).

### A.3 Où le LLM intervient — le DAG décide, jamais l'inverse

**[JUGEMENT — contrainte 1 traduite mécaniquement]** Un nœud LLM est un template de workflow
avec une garde `when:` sur un **score d'insuffisance produit par le nœud déterministe
précédent** (texte natif absent/pauvre, cellule illisible, code ambigu). Entrée = clé CAS ;
sortie = artefact S3 avec provider/model/prompt-version/input-hash/coût ; budget par run ;
échec de gate = `unknown`, jamais une 2e passe pour fabriquer un vert. Trois nœuds LLM
seulement dans toute l'architecture : (1) extraction résiduelle de grilles (remplaçant vision
ADR-0024, à ratifier), (2) numéro/millésime règlement ambigu (proposition + citation, jamais
promotion), (3) proposition initiale de `prefix_map` usage dominant (l'exécution reste
déterministe). Zéro LLM sur zones-SIG, cadastre, immo-lots, jointures, serving —
conforme à la matrice Sol, que je confirme.

### A.4 Moteur d'orchestration : **Argo Workflows** (nommé)

**[JUGEMENT]** Je tranche **Argo Workflows + CronWorkflows**, installé au niveau cluster par
poc-k8s (comme Traefik/cert-manager/sealed-secrets déjà mutualisés), workflows soumis dans le
ns `geo`. Pourquoi lui :

- **k8s-natif et déclaratif** : DAG en CRD committé, retry/timeout/exit-handlers/`when` sans
  écrire un scheduler ; satisfait « tout sur k8s » et « scripts committés uniquement ».
- **Artefacts S3 natifs** : le passage inter-nœuds épouse le design S3-first du repo.
- **Sémaphores/parallelism** : la contrainte dure du quota (`tenant-quota` : 6 pods, ~2 pods
  utiles — `deploy/acquisition-job/README.md:77-93`) se gère par sémaphore Argo, pas par
  discipline humaine.
- **Écartés** : contrôleur TS maison (c'est le pré-mortem « framework universel » de Sol —
  on réécrirait Argo en moins bien) ; Airflow/Dagster/Prefect (Python, contraire au
  Node/TS-only assumé du repo) ; Temporal (serveur + workers long-lived, incompatible quota
  et modèle Job-par-run). La logique reste en TS dans les conteneurs (`geo-capture`,
  `geo-acquisition`) ; **Argo n'orchestre que**.
- Réversibilité : chaque nœud reste un Job k8s exécutable seul (les YAML `deploy/capture-job/`
  actuels deviennent des templates) — si Argo déçoit, on retombe sur CronJobs sans réécrire
  les nœuds.

---

## B. Pattern sentropic tranché : **le service central (« sentropic-sentech »), PAS le cluster-mesh**

**[FAIT — décisif]** (1) `@sentropic/cluster-mesh` (`sentropic/packages/cluster-mesh`) est un
paquet de **contrats de fédération d'identité de clusters** — il ne route AUCUN LLM ; le terme
du mandat est ambigu et doit être levé auprès de l'owner. (2) `@sentropic/llm-mesh` =
**control-plane** (enrollment PKCE/device-code, keyring chiffré local, routage sticky) ;
`@sentropic/llm-gateway` = **data-plane** (proxy) — aujourd'hui zéro consommateur, chemin
live = mesh-direct in-process. (3) Le mécanisme `push-cluster` (comptes → Secret k8s) est **en
voie de suppression** côté h2a (`h2a/.track/events.jsonl:1170,1180`). (4) La décision owner
sentropic `DECISION_LLM_EGRESS_STANDARD_PATH.md` retient **Option C split-by-mode** :
personnel = in-process ; gateway = porte d'entrée pour les usages cluster/metered ; pooling
cross-user **gaté ToS, OFF par défaut**. (5) « sentropic-sentech » ne nomme aucun artefact ;
la lecture cohérente est le **Mode 3** de `h2a/apps/llm-gateway/SPEC.md:72-79` : gateway
centrale `llm.sent-tech.ca` + control-plane `sentropic.sent-tech.ca`.

**[JUGEMENT — reco]** **Utiliser le service sentropic central.** Les Jobs geo appellent la
gateway `llm.sent-tech.ca` avec un JWT de workspace ; l'enrollment des comptes
codex+claude+gemini se fait **une fois, côté plateforme** (`h2a mesh enroll` / `h2a auth
account enroll`), jamais dans un pod. Justification : (a) il n'existe plus de mécanisme
sanctionné pour matérialiser des comptes enrôlés dans le cluster geo (push-cluster supprimé) —
la branche « cluster-mesh » est un cul-de-sac au sens propre ; (b) le quota ns geo (6 pods)
ne paie pas un sidecar/deployment gateway par tenant ; (c) c'est exactement le cas prévu par
l'Option C sentropic (consommateur batch k8s → gateway) — geo s'aligne au lieu de forker ;
(d) budget/kill-switch/instrumentation LLM-minimal deviennent centraux et auditables.
**Condition dure** : le pool servi à geo reste les comptes du même owner
(personal-passthrough) — pas de pooling cross-user tant que le gate ToS est fermé.
**Intérim** (gateway pas encore servie) : les nœuds LLM du DAG émettent une file d'exception
(artefacts CAS) traitée par inférence locale en lecture seule — légitime au sens de
`SPEC_CAPTURE_ON_CLUSTER.md` §4.2 (« inférence sur octets déjà captés ») — puis la file
bascule vers la gateway sans changer le DAG.

---

## C. Migration old→new par strangulation

**[JUGEMENT]** Chaque lane suit le gabarit : dual-run → comparaison → bascule → **suppression
du chemin local** (le shard `fleet.json` de la lane passe à 0 — la flotte tmux meurt par
strangulation, pas par décret). Ordre :

**Lane 0 — convergence & hygiène (préalable, ~jours)** : rebase du poste sur `origin/main` ;
**committer `deploy/k8s/geo-pv-refresh-cronjob.yaml`** (actif en prod mais NON suivi —
défaut de capitalisation caractérisé) ; dédoublonner les deux CronJobs homonymes
`geo-pv-backlog-pv-probable-…` (images divergentes GHCR-digest vs tag Scaleway mutable) ;
digest-pin partout ; installer Argo (poc-k8s) + gate CI « readback cluster = git ».

**P1 — le refresh des villes à changement de zone (la commande owner)** :

1. **PV documents+extraction (canari)** : étendre le CronJob index existant (seul refresh
   on-k8s actif, `pv-refresh-cron.ts`) en CronWorkflow : index → capture documents (les
   briques existent : `job-capture.yaml`, worklists S3, `pv-capture-backlog-run.ts`) →
   pdftotext→OCR-si-scan → parseur sémantique (`proces-verbaux-parser.ts:987-1119`) →
   **émission d'événements `zone-change-candidate` par ville**. Ce nœud est le déclencheur
   amont de tout P1 : c'est lui qui dit OÙ rafraîchir.
2. **Règlement** : déclenché par `zone-change-candidate` + staleness ; capture PDF → extraction
   numéro/millésime déterministe (LLM gated sur ambigu seulement) → `fold-reglement-to-zonage`
   → restamp. La lane flotte `geo-reglement` (2 shards) tombe à 0 ici.
3. **Grilles/normes** : capture grille (même site-engine que 2) → cascade native→OCR
   (**retirer le défaut `both` de `zonage-norms-2engine-keepbest`** — il paie deux moteurs) →
   nœud LLM gated via gateway (après ratification du remplaçant ADR-0024) → registre versionné
   → re-join lot-zone incrémental. Effet densifiant devient **gratuit** ici : diff numérique
   de deux versions du registre normes (aucun moteur nouveau).
4. **Zones vectorielles (WFS/ArcGIS/AGOL/JMap)** : re-acquisition par capture-node → preuve v2
   **par construction** (`proofFromFetched` + manifeste, la spec §3.1 montre que le mapping est
   mécanique) → débloque le KPI K3. Obscura/Tor **en dernier** (risque IP datacenter prouvé).

**P2 — étude des patterns → consolidation totale** : usage dominant (réutilise la capture
règlement, nœud LLM = proposition de map) ; cadastre/rôle (APRÈS l'arbitrage Loi 25, D2
ci-dessous) ; immo-lots (porter `qc-lots-backfill` tel quel en Job puis le déclencher par
hashes amont) ; extinction de `geo-fleet.ts` ; revue des 541 sondes `_*.ts` (archivage,
promotion en lib de ce qui a servi deux fois).

---

## D. Les 6 arbitrages

1. **Reco4 tag-mécanisme [JUGEMENT]** : implémenter **C4 = workflow `release-prod` sur tag
   `v*`**, qui (a) refuse tout digest n'ayant pas un `PREPROD_ACCEPTANCE` (invariant
   same-digest ADR-0027 §4, jamais de rebuild) ; (b) snapshot/inventaire prod + versioning
   bucket AVANT mutation ; (c) apply overlay `deploy/k8s/overlays/prod` ; (d) les données prod
   sont produites par les DAGs on-prod en continu, versionnées par `coherence_id` — **le tag
   ne rejoue PAS toutes les données** (un tag qui attend 8 pipelines est fragile — objection
   Sol, que je retiens) ; (e) rollback = re-pin digest + re-pointer le `coherence.json`
   précédent. **Ne pas inventer `prod/current.json`** : étendre le mécanisme `coherence.json`
   déjà codé et servi.
2. **Loi 25 / rôle [JUGEMENT]** : trancher par **allowlist de champs committée + garde de lib**
   (pattern `assertVisionModelAllowed`) : la lib reste fetch-only par défaut ; un module
   `role-fields-policy` n'autorise le parse QUE des champs d'emplacement non-personnels
   (adresse de l'emplacement, surface — jamais RL0101/propriétaires), fail-closed, avec ADR
   dédiée ratifiée owner. Tant que l'ADR n'existe pas : le nœud cadastre/rôle **ne migre pas**
   sur k8s et l'adresse reste `unknown` (22/1100) — un null explicite vaut mieux qu'un parse
   non sanctionné. La contradiction actuelle (`lots-enriched-run` importe `parseRole` malgré
   la frontière `fetcher.ts:5-15`) se résout dans ce sens, pas en assouplissant la lib.
3. **Seuil pruning preprod [JUGEMENT]** : prune borné à **10 % du set par fenêtre de sync**
   (le garde-fou lib `DEFAULT_MAX_DELETE_FRACTION` existe — le fixer et le graver) ; au-delà :
   dry-run diff + approbation owner explicite ; delete-list journalisée dans le manifest de
   cohérence ; `raw/**` et `capture/_runs/**` **jamais** prunés (règle C-7), source vide =
   refus (garde existante).
4. **Seuil tag prod [JUGEMENT]** : le tag gate la **non-régression, pas la complétude** :
   (a) verify-job preprod VERT (parité count+set-hash, coherence fraîche, fail-closed) ;
   (b) CI verte ; (c) Δ portfolio ≥ 0 sur les colonnes servies (aucune ville ne régresse de
   `complete` vers autre chose) ; (d) un drill rollback re-pin réussi datant de < 90 jours.
   Pas de seuil de couverture absolu : la couverture progresse en continu entre tags.
5. **ADR-0027/0028 [FAIT+JUGEMENT]** : elles existent, ratifiées — la « réconciliation »
   demandée est close ; **conserver leur contenu intégralement** (6 invariants + push-CI).
   Écrire une **ADR-0029** : orchestration DAG Argo + nœud-LLM-gated + gateway centrale +
   ordre de strangulation (le présent plan), et l'ADR Loi 25 (D2). Amendement mineur à 0027 :
   étendre le `coherence_id` du serving aux produits de DAG (lineage run→collection).
6. **Les 4 conductors [JUGEMENT — à ratifier, pas à fabriquer]** : confirmés : zones→
   `geo-zones`, PV→`pv`, règlement→`reglements`, immo-lots→`geo-lot`. Pour les 4 inconnus, je
   propose de NE PAS créer 4 lanes de plus mais de suivre les dépendances de moteur :
   **normes + effet densifiant → un conductor unique `geo-normes`** (l'effet EST un diff de
   deux extractions normes) ; **usage dominant → `reglements`** (même capture, la légende vit
   dans le règlement) ; **cadastre/rôle → `geo-lot`** (consommateur direct, cadence
   provinciale). Net : 5 conductors au lieu de 8 ; geo-socle porte les moteurs, pas une lane.

---

## E. Lifecycle code/preprod/prod consolidé

**Flux merge → preprod** : merge `main` ⇒ CI + `cd-preprod.yml` (build → digest →
kustomize → deploy ns `geo-preprod`) ⇒ fenêtre gatée poc-k8s : `geo-preprod-sync` miroir
plein prod→bucket preprod séparé (sens-unique par credentials, prune borné D3) + stamp
`coherence.json` ⇒ `verify-job` parité fail-closed ⇒ **[nouveau]** exécution des DAGs en mode
canari (échantillon de villes représentatif par famille de source, pas 1106) dans
`preprod-runs/<sha>/` ⇒ `PREPROD_ACCEPTANCE` posé. Preprod prouve le CODE des pipelines sur
des données réalistes écrasables.

**Flux tag → prod** : tag `v*` ⇒ `release-prod` (D1) : same-digest exigé + acceptance ⇒
backup/inventaire + object-versioning ⇒ migrations de layout S3 par Job idempotent AVANT
bascule serving ⇒ apply overlay prod ⇒ les CronWorkflows prod continuent de produire les
vraies données, chaque promotion stampée `coherence_id` ⇒ rollback = re-pin.

**Garde-fous anti-perte (données ET jobs)** : sens-unique par credentials (ADR-0027 inv.3 —
aucune cred preprod n'écrit prod) ; `raw/` append-only + CAS (C-7) ; versioning bucket ;
**parité git↔cluster en CI** : un workload actif non committé (le cas `geo-pv-refresh`
aujourd'hui) fait échouer un job de readback — un manifest est du code ; migration d'un job =
`suspend` l'ancien → dual-run → delete du YAML dans la même PR que l'armement du nouveau,
jamais de delete direct ; jamais deux workloads homonymes à images divergentes (cas constaté).

---

## F. Risques majeurs + pré-mortem

1. **Split-brain git récidivant [FAIT constaté]** : cette commission elle-même a produit des
   constats faux sur checkout périmé. Mitigation : les analyses/dossiers déclarent leur SHA de
   base et un gate refuse un dossier ancré à > N commits de `origin/main`.
2. **Quota ns geo (6 pods / ~2 utiles)** : un DAG à 8 lanes s'étrangle. Mitigation :
   sémaphores Argo, demande de quota poc-k8s, Scaleway Serverless pour les lanes massives
   (patron `normes-job` conservé comme adaptateur du MÊME nœud, pas comme chemin parallèle).
3. **IP datacenter (prouvé : reCAPTCHA GOazimut, 0 dépôt)** : obscura en dernier, variante
   Tor NEWNYM par ville, carve-out local journalisé-même-bucket comme repli documenté.
4. **Gateway LLM pas prête** : la lane normes bloque sur le remplaçant vision. Mitigation :
   file d'exception CAS + inférence locale lecture-seule (légitime), bascule gateway sans
   changer le DAG ; ne JAMAIS re-sanctionner un défaut vision implicite (ADR-0024).
5. **Argo devient une 2e production** (le pré-mortem Option B de Sol, que je durcis) :
   signaux = `fleet.json` shards > 0 après bascule d'une lane, nouveaux `_*.ts` qui fetchent,
   âge du dernier run DAG par lane. Règle : une lane migrée SUPPRIME son CronJob/flotte dans
   la même PR ; KPI `runs hors DAG` publié dans le portfolio.
6. **Pruning accidentel / perte preprod** : borne 10 % + dry-run + approbation (D3) ; datasets
   synthétiques de test dans un préfixe jamais reset.
7. **ToS pooling LLM** : geo reste personal-passthrough (comptes owner) ; tout élargissement
   passe par le gate `crossUserPoolEnabled` côté sentropic, jamais par contournement geo.

**Pré-mortem global (6 mois)** : Argo est installé, 2 lanes migrées, la flotte tmux vit
encore, le LLM est resté l'opérateur du rattrapage, et personne n'a implémenté C4 — le tag
prod reste manuel. Antidotes déjà dans le plan : Lane 0 obligatoire avant P1, strangulation
mesurée par `fleet.json→0` lane par lane, C4 dans le premier lot P1 (pas en queue), et le
portfolio publie `runs hors DAG` + âge par lane pour que la dérive soit visible, pas déniable.
