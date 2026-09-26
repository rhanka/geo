# bascule-preprod — bascule PROD → PRÉPROD geo (« iso-prod »)

**Clone geo de la recette immo** (`radar-immobilier:deploy/ci/bascule-preprod/`, i-cond) :
mêmes chemins, mêmes noms de fichiers, même mécanique. Seules différences : noms geo,
buckets/préfixes, namespaces, runners geo, et le sous-ensemble d'étapes arbitré par i-cond
(préprod geo SANS PostgreSQL). Rejouable par la CI / l'owner SANS IA. **0 Python.**

> CD-native (iso immo) : le bundle prod (2 SealedSecrets + Job rôle RO + CronJob dump + VAP + RBAC T1)
> est appliqué par le CD `bascule-bundle-cd.yml` (SA permanente `geo-ci-bascule-prod`) — 1er run
> dispatché par k8s après merge (`install-cd-bootstrap.sh`), puis au merge. Les **netpols ne font pas
> partie du bundle** (`netpol-geo-db-backup.k8s-apply.yaml`, appliquée par k8s). La bascule tourne en
> planification hebdomadaire, dimanche 03:17 UTC (`bascule-preprod.yml`, armée par `BASCULE_SCHEDULE_ENABLED`) ou en
> `workflow_dispatch` (CONFIRM). Voir `CD_NATIVE_MIGRATION.md` et `CRED_CYCLE.md`.

## Deux jambes indépendantes, en parallèle (directive i-cond, validée owner)

La bascule geo = **deux jambes INDÉPENDANTES**, jouées **EN PARALLÈLE** par deux jobs du
workflow **sans `needs:` entre eux**. Chaque jambe rend son **statut GitHub séparément**
(un job rouge n'annule ni ne masque l'autre) :

| Job | Jambe | Séquence | Kubeconfigs | N'attend |
| --- | --- | --- | --- | --- |
| `pg` | PG (archive DR) | `preflight pg` → `dump` (S1) | préprod (Job freshness, ns geo-preprod) + PROD-TRIGGER (2 patch cronjob, hors DRY) | rien de S3 |
| `s3` | S3 (couche servie) | `preflight s3` → `copy-docs` → `recon` → `rollout` (G4) → `smoke` | préprod seul | rien de PG |

- Aucune dépendance de données PG → S3 côté geo : la préprod n'a pas de PostgreSQL, le dump
  est une archive DR, rien ne le consomme dans la bascule. **Seul l'orchestrateur e2e (côté
  immo) couple les deux jambes** ; le job `cycle-leg` (voir « Contrat e2e ») ne fait que
  rapporter leur résultat et ne crée aucun `needs:` entre `pg` et `s3`.
- `concurrency: bascule-preprod` reste au niveau **workflow** : jamais deux runs de bascule en
  même temps ; à l'intérieur d'un run, `pg` et `s3` tournent en parallèle.
- Chaque job a son propre runner → `BASCULE_WORKDIR` (sentinels `T1.txt`, `recon.ok.json`)
  n'est **pas partagé**. Les Jobs in-cluster des deux jambes ont des noms distincts
  (`geo-bascule-freshness` / `geo-normalized-sync-prod-to-preprod`, `geo-bascule-recon`) :
  aucune collision de `delete`/`apply`.
- Pointeurs séparés (hors DRY, `always`) : `bascule-pg-pointers-<run_id>` (`T1.txt`),
  `bascule-s3-pointers-<run_id>` (`recon.ok.json`).

## RUNNER KUBECTL-ONLY (contrat owner, NON négociable — identique immo)

**AUCUNE cred S3/DB, AUCUN listing/clé ne transite ni n'est lu par le runner GitHub.**
Le runner ne fait QUE :

- `kubectl` (2 kubeconfigs : **préprod** par défaut, dans les 2 jobs + **PROD** pour le seul
  trigger dump, job `pg` uniquement) :
  patch cronjob (suspend), dispatch + **OBSERVE `.status`** des Jobs, `rollout restart` geo-api.
- `curl` sur l'**API geo publique** (smoke S7 : données publiques, 0 cred).

**Le runner ne lit JAMAIS `kubectl logs`** (STATUS-ONLY). Debug = in-cluster.
Tout l'accès object-store/DB vit dans des Jobs verdict-only (creds via `secretKeyRef`).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `bascule.mjs` | CLI Node kubectl-only : `preflight [pg\|s3]`, `dump`, `copy-docs`, `recon`, `rollout`, `smoke` + gardes + `classifyJobStatus` + `preflightRequirements`. |
| `bascule.selftest.mjs` | Self-test des fonctions pures (0 appel kubectl/aws/réseau), dont le sélecteur de jambe du preflight. |
| `served-ids.mjs` | Contrat e2e : `validate-cycle-id`, `builder-version`, `build` (ids ZONES servis via l'API publique + builder publié), `cycle-leg` (`legs.geo`). 0 kubectl, 0 cred. |
| `served-ids.selftest.mjs` | Self-test du contrat e2e (API OGC et builder simulés, 0 réseau) + validation structurelle du workflow (`yaml`). |
| `s3-check-job.tmpl.yaml` | Checks S3 verdict-only (aws-cli, même pin qu'immo) : `freshness` (S1) et `recon` (S3b). |
| `docs-sync-job.tmpl.yaml` | Copie `normalized/` prod → préprod (S3) : image geo-api, aws-sdk `CopyObject` server-side ADDITIF + `GrantFullControl`, identité éphémère k8s. |
| `cronjob-db-backup-prod.yaml` | CronJob `geo-db-backup-prod` (ns geo, suspendu) : `pg_dump --format=custom --no-owner --no-privileges` RO → `geo-postgres/prod/sets/<ISO-ts>/geo.dump` (`EXPECTED_DATABASE=geo`). |
| `db-ro-role-provision.yaml` | ConfigMap SQL + Job : rôle `geo_db_ro_prod` (`pg_read_all_data` + `CONNECT` sur `current_database()`), superuser `geo-postgis-credentials`. |
| `vap-ci-trigger-suspend-only.yaml` | VAP : la SA trigger ne peut muter QUE `spec.suspend` de `geo-db-backup-prod`. |
| `rbac-ci-trigger-prod.yaml` | SA/Role/RB `geo-ci-trigger-prod` (ns geo) : get/patch du seul CronJob dump. |
| `rbac-ci-bascule-prod.yaml` | SA permanente `geo-ci-bascule-prod` (ns geo) : apply du bundle, 0 `secrets:create`. |
| `rbac-ci-bascule-preprod.yaml` | SA `geo-ci-bascule-preprod` (ns geo-preprod) : Jobs + rollout geo-api, secrets get/update sur `geo-backup-reader-preprod` et `geo-backup-restore-docs` seulement, 0 logs. |
| `restore-mode.mjs` · `backup-restore.cjs` · `backup-read-job.tmpl.yaml` · `docs-restore-backup-job.tmpl.yaml` | `MODE=restore\|list` : restauration DEPUIS `geo-backup` (section « Restore depuis un backup »). |
| `restore-mode.selftest.mjs` | Selftest hors ligne du mode restore/list (faux S3 versionné par identité, CLI réelle contre un faux kubectl). |
| `geo-db-ro-prod-sealed.yaml`, `geo-pra-writer-prod-sealed.yaml` | SealedSecrets **committées par geo-cond** (scellées, validées) — appliquées par le bundle. |
| `netpol-geo-db-backup.k8s-apply.yaml` | **À appliquer par k8s** (jamais par un workflow) : ingress postgis + egress des pods de backup (ns geo). |
| `install-cd-bootstrap.sh` | Install one-time (k8s lane, cluster-admin, après merge) : RBAC des SA, 3 kubeconfigs GH, armement, dispatch du CD bundle. |
| `../../../.github/workflows/bascule-preprod.yml` | Le run (schedule + dispatch). |
| `../../../.github/workflows/bascule-bundle-cd.yml` | Apply du bundle au merge. |

## Séquence geo (sous-ensemble iso de S0→S7)

| Pas | Jambe (job) | Sous-commande | Ce qui se passe | Où |
| --- | --- | --- | --- | --- |
| S0 | `pg` | `preflight pg` | binaires runner (`node kubectl`) + params PG (`EXPECTED_DATABASE`, `BHS`, `DUMP_BUCKET`) ; **0 cred S3/DB runner**. | runner |
| S1 | `pg` | `dump` | **DÉCLENCHEUR T1** : `kubectl --kubeconfig $DUMP_KUBECONFIG -n geo patch cronjob geo-db-backup-prod suspend=false` ; **Job freshness** (ns geo-preprod, kubeconfig préprod ; poll interne : LastModified > T1, clé ⊇ `EXPECTED_DATABASE`, `.dump`, Size>0) ; **re-suspend** toujours. | runner (kubectl) + Job |
| S0 | `s3` | `preflight s3` | binaires runner (`node kubectl curl`) + params S3/smoke (`BHS`, `PROD_DOCS`, `PREPROD_DOCS`, `PREPROD_API_URL`, `PROD_API_URL`). | runner |
| S3/S4 | `s3` | `copy-docs` | Job `geo-normalized-sync-prod-to-preprod` (image geo-api) : pré-check GET fail-closed + boucle `CopyObject` server-side `s3://sentropic-geo/normalized/` → `s3://sentropic-geo-preprod/normalized/` + `GrantFullControl`. ADDITIF, idempotent. DRY : non jouée. | préprod (Job) |
| S3b | `s3` | `recon` | Job DIFF LIST-only Key+Size → dest ⊇ src → exit 0, sinon 1. Sentinel local `recon.ok.json`. | préprod (Job) |
| S5' | `s3` | `rollout` | **G4** (sentinel + recon rejouée) puis `kubectl rollout restart deployment/geo-api -n geo-preprod` + `rollout status` : geo-api recharge son index (StoreProvider). | préprod (kubectl) |
| S7 | `s3` | `smoke` | `curl` API publique : landing préprod 200 + ids `/collections` préprod ⊇ ids `/collections` prod. | runner (curl) |

`preflight` sans argument vérifie les params des DEUX jambes (comportement historique, usage
manuel) ; une jambe inconnue échoue (fail-closed).

Ordre workflow (les deux jobs démarrent ensemble) :

- job `pg` : S0 pg → [DRY : arrêt, rien de destructif] → S1 → pointeur `T1.txt` (`always`).
- job `s3` : S0 s3 → [DRY : copy-docs non jouée, recon + smoke informatifs] → S3 → S3b → S5' → S7 → [CYCLE_ID : served ids zones] → pointeur `recon.ok.json` (`always`).
- job `cycle-leg` (seulement si CYCLE_ID non vide) : après `pg` ET `s3`, quel que soit leur résultat → `legs.geo`.

## Contrat e2e immo+geo (`CYCLE_ID`)

L'orchestrateur e2e (radar-immobilier, conducteur i-cond) dispatche ce workflow puis vérifie,
par **INCLUSION**, que chaque id canonique référencé par immo existe **octet pour octet** dans
le *served set* de geo. Contrat symétrique : immo fait la même chose dans son dépôt. Toute la
logique geo est dans `served-ids.mjs` ; le workflow reste fin.

### Input

| Input | Type | Règle |
| --- | --- | --- |
| `CYCLE_ID` | string, optionnel (défaut vide) | `^[A-Za-z0-9._-]{1,100}$`, validé (`validate-cycle-id`) au début des jobs `pg`, `s3` et `cycle-leg`, AVANT tout usage dans un nom d'artefact. Jamais interpolé dans un `run:` (passé par `env`). **Vide ⇒ comportement inchangé** : aucune étape e2e, pas de job `cycle-leg`. Un run planifié n'a pas d'input ⇒ jamais d'e2e. |

### Artefact `geo-served-canonical-ids-<CYCLE_ID>` (fin du job `s3`)

Produit **après le smoke S7 vert**, **hors DRY**, si `CYCLE_ID` est non vide. S'il échoue, le job
`s3` passe au rouge (fail-closed).

| Fichier | Contenu |
| --- | --- |
| `served-ids.txt` | 1 id par ligne, **ordre d'octets (LC_ALL=C), dédupliqué**, LF final. |
| `served-ids.txt.sha256` | `<hex>  served-ids.txt` (vérifiable par `sha256sum -c`). |
| `served-ids.meta.json` | `scope: "zones"`, version du builder, registre (chemin + sha256), comptes, collections lues (features/pages/ids par collection), collections exclues. |
| `missing-zone-collections.txt` | Slugs du registre **sans** collection `qc-zonage-<slug>` dans `/collections` (1 par ligne, vide s'il n'y en a aucun). |

- **Scope = ZONES seules** (arbitrage i-cond). Format : `ogc:zones:<city_slug>:<canonicalizeZoneCodeForJoin(zone_code)>`,
  par exemple `ogc:zones:westmount:R-13-02-02` (`zone_code` servi `R13-02-02`). **Les lots viendront
  plus tard** par un endpoint geo-api `/join-keys` : les `qc-lots-*` ne sont pas lisibles par l'API
  OGC actuelle (géométrie obligatoire ; chaque page relit l'objet entier côté serveur, soit environ
  63 min pour Laval avec 401 594 lots ; `qc-lots-montreal` ferme la connexion vers 50 s).
- **Builder** : `buildServedCanonicalIds({ zones })` + `serializeServedCanonicalIds` de
  **`@sentropic/geo` PUBLIÉ sur npm**, version épinglée dans `served-ids.mjs` (`BUILDER_VERSION`,
  aujourd'hui `0.6.2`, source unique : `node served-ids.mjs builder-version`), installé hors workspace
  (`npm install --prefix $RUNNER_TEMP/served-ids-builder --no-save --ignore-scripts`). La version
  installée est revérifiée avant l'import ; la sortie est recontrôlée (tri octets strict, format,
  sérialisation). Geo et immo utilisent ainsi exactement le même builder.
- **Univers** (SPEC_GEO_SERVED_CONTRACT §2) : collections `qc-zonage-<slug>` dont le slug appartient
  au registre committé des 1106 municipalités (`packages/qc-sources/src/geo/municipalities.qc.json`).
  **Exclus** : `qc-zonage-norms-*` (tables de normes), couches thématiques (`qc-zonage-arcgis-*`,
  `qc-zonage-laval-sad-*`, …) et les **3 variantes de slug servies hors registre** : `l-assomption`,
  `l-epiphanie`, `sainte-christine-d-auvergne`. Elles restent exclues **tant qu'immo n'a pas dit s'il
  les référence** ; elles figurent dans `served-ids.meta.json` (`excluded_unregistered_qc_zonage_collections`).
- **Lecture** : API **publique** préprod (`PREPROD_API_URL`), 0 credential comme le smoke, 4 collections
  en parallèle, pagination `limit=10000` / `offset` **calculés** (les liens `next` de l'API sont en
  `http://` derrière la terminaison TLS, on ne les suit pas). Propriété lue : `zone_code` (brute ;
  vide ⇒ ignorée par le builder).
- **Fail-closed** : erreur HTTP (429/5xx/réseau/JSON illisible : 3 tentatives puis échec ; 4xx :
  échec immédiat), page incohérente (`numberReturned`, `numberMatched` qui change, page vide avant la
  fin), collection **servie** illisible, registre invalide, builder absent ou d'une autre version,
  résultat vide ⇒ exit 1. **Seule tolérance, choisie volontairement** : un slug du registre **absent
  de `/collections`** n'est pas une erreur, puisque le served set est par définition ce qui est servi.
  Il est listé dans `missing-zone-collections.txt`. Une collection présente dans `/collections` mais
  illisible reste une erreur.

### Artefact `cycle-leg-geo-<CYCLE_ID>` (job `cycle-leg`)

`needs: [pg, s3]`, `if: always() && inputs.CYCLE_ID != ''`. Ce job **rapporte seulement** : 0 kubectl,
0 secret. Il télécharge `bascule-pg-pointers-<run_id>` (T1) et `geo-served-canonical-ids-<CYCLE_ID>`
(les deux en `continue-on-error` : absents en DRY ou si une jambe a échoué). Il écrit
`cycle-leg-geo.json`, qui contient UNIQUEMENT la sous-branche `legs.geo` du schéma partagé :

```json
{
  "repo": "rhanka/geo",
  "workflow": "bascule-preprod.yml",
  "run_id": "<github.run_id>",
  "sha_main": "<7 premiers caractères de github.sha>",
  "t1": "<ISO 8601 de T1.txt (jambe pg)> | null",
  "verdict": { "pg": "success|failure|pending", "s3": "success|failure|pending" },
  "served_ids_artifact": "geo-served-canonical-ids-<CYCLE_ID>",
  "served_ids_sha256": "<hex> | null",
  "served_ids_scope": "zones"
}
```

- **Mapping des verdicts** (`needs.<job>.result`) : `success` → `success` ; `failure`, `cancelled`,
  `skipped` → `failure` ; vide ou inconnu → `pending` (jamais observé une fois les `needs` terminés).
- `t1` : `null` si l'artefact pg est absent (DRY, échec avant S1) ou si `T1.txt` est illisible.
- `served_ids_sha256` : **recalculé** sur `served-ids.txt` et comparé au `.sha256` (un artefact
  incohérent fait échouer le job) ; `null` si l'artefact est absent, **sans modifier le verdict `s3`**.
- `served_ids_scope` : champ additionnel (`"zones"`), ignoré par un orchestrateur qui ne le connaît pas.
- Un dispatch **DRY** avec `CYCLE_ID` produit un `legs.geo` avec `t1: null` et `served_ids_sha256: null` :
  ce n'est pas un cycle e2e exploitable.

### Dépendance cross-repo (owner / infra)

Le dispatch de `rhanka/geo` par l'orchestrateur immo exige un jeton côté immo : **PAT repo-scopé
`GEO_DISPATCH_TOKEN`** (décision owner), avec le droit `actions:write` sur `rhanka/geo` (dispatch
+ lecture des runs et artefacts). **À provisionner par l'owner/infra** ; ce dépôt ne le crée ni ne
le lit. Ce workflow ne demande aucune permission supplémentaire (`contents: read`).

## Mapping immo → geo

| immo | geo | justification |
| --- | --- | --- |
| 1 job `bascule` séquentiel (S0→S7) | 2 jobs parallèles `pg` / `s3`, 0 `needs:` | directive i-cond (validée owner) : pas de restore préprod geo → aucune dépendance PG → S3 ; statut rendu par jambe |
| S0 preflight | `preflight [pg\|s3]` (sans argument = identique) | chaque job ne vérifie que les params de sa jambe |
| artefact `bascule-rollback-<run_id>` | `bascule-pg-pointers-<run_id>` (`T1.txt`) + `bascule-s3-pointers-<run_id>` (`recon.ok.json`) | un artefact par jambe ; pas de clé de rollback (pas de restore) |
| S0.b / S3c `precheck-runs` | retiré | mémoire de collecte `runs/` propre à immo |
| Q / U quiesce / un-quiesce, G2 | retiré | pas de PG préprod ni de writer à geler (arbitrage i-cond) |
| S1 dump (trigger + freshness + re-suspend) | identique | CronJob `geo-db-backup-prod` ns geo |
| S2 restore + G1 rollback, S2c migrate | retiré | préprod geo sans PostgreSQL (arbitrage i-cond) |
| S3 docs-sync (`radar-api`, identité éphémère, grant) | S3 copy `normalized/` (`geo-api`, `geo-normalized-src-preprod`, grant) | objets servis geo = `normalized/` ; direct prod→préprod (arbitrage i-cond) |
| S3b recon | identique (`geo-normalized-reader-preprod`) | — |
| S5 flip `GEO_DOCUMENTS_REPOINT` (G4) | S5' `rollout restart geo-api` (G4) | le « flip » geo = rechargement de l'index servi |
| S6 refresh / force-refresh, `bascule-refresh.yml` | retiré | worker-live / `radar-refresh-pv` propres à immo |
| S7 smoke `/health` (db.ok + objectStore.ok) | S7 smoke API publique (préprod ⊇ prod sur `/collections`) | geo-api sans DB ; verify through l'API côté runner = 0 netpol d'ingress |
| `db-restore/rollback/migrate-job.tmpl.yaml` | non répliqués | arbitrage i-cond |

Écarts techniques ponctuels (commentés dans chaque fichier) : `resources` posés sur les pods du ns geo
(ResourceQuota), options S3 OVH-safe (checksum `WHEN_REQUIRED`), labels pod `geo-preprod-sync` (réutilisation
de la netpol existante), source vide = échec dans le copy-docs, GRANT CONNECT agnostique du nom de DB.

## Gardes fail-closed

- **STATUS-ONLY** : `runJobFromTemplate` lit UNIQUEMENT `.status` (`classifyJobStatus`), 0 `kubectl logs`.
- **G3 — CONFIRM** : `iso-prod-AAAA-MM-JJ`, recoupé au jour UTC (anti-rejeu) ; un run planifié matérialise le CONFIRM du jour.
- **G4 — rollout seulement si recon OK** : sentinel local + recon rejouée juste avant le rollout.
- **EXPECTED_DATABASE (contrôle POSITIF in-cluster)** : le CronJob refuse de dumper si `current_database()` ≠ `EXPECTED_DATABASE` ; la clé du dump frais ⊇ `EXPECTED_DATABASE` (Job freshness).
- **Anti-RCE (bundle)** : impersonation `--dry-run=server` — mutation `jobTemplate` DENIED, flip `suspend` ALLOWED, sinon Role T1 neutralisé.
- **Bundle prêt** : `bascule-bundle-cd.yml` / `install-cd-bootstrap.sh` refusent tant qu'une SealedSecret (committée par geo-cond) est absente ou qu'une valeur `REPLACE_WITH_` subsiste.
- G1 / G2 : N-A (pas de restore DB préprod).

## Matrice « quel secret / où »

**Runner GitHub** — kubectl-only, 0 cred S3/DB :

| Clé | Type | Usage |
| --- | --- | --- |
| `KUBE_CONFIG_DATA_BASCULE_PREPROD` | secret d'env `geo-bascule` | kubeconfig préprod — SA `geo-ci-bascule-preprod` (pilotage) ; jobs `pg` (Job freshness) et `s3`. |
| `KUBE_CONFIG_DATA_PROD_TRIGGER` | secret d'env `geo-bascule` | kubeconfig PROD — SA `geo-ci-trigger-prod` (2 patch cronjob, VAP) ; job `pg` seul. Non requis en DRY. |
| `KUBE_CONFIG_DATA_PROD` | secret d'env `geo-prod-bundle` | kubeconfig PROD — SA `geo-ci-bascule-prod` (apply du bundle, job `apply-bundle`). |
| `BASCULE_EXPECTED_DATABASE` | var | nom littéral de la DB prod geo (défaut `geo`, fourni par k8s). |
| `BASCULE_*` (autres) | vars | endpoint, buckets, préfixes, CronJob, ns, URLs API, grantee — NON secrets, défauts dans le workflow. |

**Kubeconfigs = secrets d'ENVIRONMENT, lisibles depuis `main` SEULEMENT.** Les 3 kubeconfigs
bascule se posent avec `gh secret set <NOM> --repo rhanka/geo --env <coffre>` (`install-cd-bootstrap.sh`
étapes 2 et 5) : `geo-bascule` ← `KUBE_CONFIG_DATA_BASCULE_PREPROD` + `KUBE_CONFIG_DATA_PROD_TRIGGER`
(jobs `pg`/`s3`, `environment: geo-bascule`) ; `geo-prod-bundle` ← `KUBE_CONFIG_DATA_PROD` (job
`apply-bundle`, `environment: geo-prod-bundle`). Coffres SANS reviewer, deployment branch policy = `main`
seule : les jambes `pg`/`s3` restent autonomes, la gate owner de `bascule-bundle-cd` reste le job
`approve` (`geo-prod`). Les secrets de DÉPÔT homonymes sont retirés (`gh secret delete <NOM> --repo
rhanka/geo`) après vérification d'un run vert — ne jamais les re-poser au niveau dépôt.

**In-cluster** : voir `CRED_CYCLE.md` — ns geo : `geo-db-ro-prod`, `geo-pra-writer-prod`,
`geo-postgis-credentials` (référencé) ; ns geo-preprod : `geo-backups-reader-preprod`,
`geo-normalized-reader-preprod`, identité éphémère `geo-normalized-src-preprod`.

## Provisionnement k8s (liste consolidée)

| # | Élément | État (2026-09-25) |
| --- | --- | --- |
| 1 | SealedSecret `geo-pra-writer-prod` (ns geo, `S3_ACCESS_KEY`/`S3_SECRET_KEY`, writer `radar-immobilier-backups-preprod/geo-postgres/`) | scellée par k8s, **fichier committé par geo-cond** |
| 2 | SealedSecret `geo-db-ro-prod` (ns geo, `POSTGRES_USER=geo_db_ro_prod`/`POSTGRES_PASSWORD`/`POSTGRES_DB=geo`) | scellée, **fichier committé par geo-cond** |
| 3 | `geo-backups-reader-preprod` (ns geo-preprod, `S3_ACCESS_KEY`/`S3_SECRET_KEY` + `S3_BUCKET`/`S3_ENDPOINT`/`S3_REGION`) — Job freshness | déposé |
| 4 | `geo-normalized-reader-preprod` (ns geo-preprod, `S3_ACCESS_KEY`/`S3_SECRET_KEY` + `S3_ENDPOINT`/`S3_REGION`, RO sur les 2 `normalized/`) — Job recon | déposé |
| 5 | Identité éphémère `geo-normalized-src-preprod` (watch du Job `geo-normalized-sync-prod-to-preprod`, `ownerRef=Job.UID`, TTL 3600 s) ; grantee `1901410700457444:9056dbb240a04d2584ffbaec38171228` | en place côté k8s |
| 6 | Nom de DB prod geo = `geo` (`EXPECTED_DATABASE`, clé `geo.dump`) | fourni, intégré |
| 7 | Netpols `netpol-geo-db-backup.k8s-apply.yaml` (ns geo : UNIQUE ingress postgis ← pods `role=pra-backup` :5432 = Job `db-ro-role-provision` ET CronJob `geo-db-backup-prod` ; egress DNS + postgis + S3-BHS) | **à appliquer par k8s**, avant le 1er dispatch |
| 8 | `install-cd-bootstrap.sh` (cluster-admin, après merge) : RBAC des 2 SA, 3 kubeconfigs GH, armement, dispatch de `bascule-bundle-cd.yml` (gate anti-RCE inclus) | **à lancer (k8s)** |
| 9 | ResourceQuota ns geo (`secrets: 10`) : +4 secrets (2 SealedSecrets matérialisés + 2 tokens SA) | à vérifier |
| 10 | `log_statement=none` sur la postgis geo (mot de passe du rôle RO non journalisé) | à confirmer |

Les Jobs préprod réutilisent la netpol existante `allow-geo-sync-egress` (label `geo-preprod-sync`) ; le
verify tourne sur le runner (API publique) : aucune netpol d'ingress vers geo-api.

## Rejouer SANS IA

1. **DRY (défaut, sûr).** `CONFIRM=iso-prod-<aujourd'hui UTC>`, `DRY_RUN=true` : job `pg` = preflight seul ; job `s3` = preflight + recon + smoke informatifs ; aucune écriture.
2. **Exécution.** `DRY_RUN=false` + `CONFIRM=iso-prod-<date du jour UTC>`. Lire le statut **par job** : `pg` vert = dump frais confirmé ; `s3` vert = préprod sert ⊇ prod. Un job rouge se rejoue sans l'autre (« Re-run failed jobs »), sous réserve d'un CONFIRM du jour (G3).
3. **Isolation S5'** : `SKIP_ROLLOUT=true` si le patch deployment manque.
4. **DR DB** : dumps durables sous `s3://radar-immobilier-backups-preprod/geo-postgres/prod/sets/<ts>/geo.dump` ; restore = `pg_restore` in-cluster à la demande (hors bascule, préprod sans PG).

## Points ouverts (non déterminables par lecture)

1. **Copie additive** : aucun delete en préprod (objets supprimés en prod restent servis) et `normalized/coherence.json` n'est pas re-stampé (il est copié si la prod en a un) — conséquence de l'arbitrage « iso docs-sync ».
2. **CopyObject ≤ 5 Go par objet** (limite S3) : sinon le Job échoue (fail-closed).
3. **Digest de l'upload du CronJob** : épinglé sur le build `main-f39cd4b2` (CD préprod) ; re-pinner sur le digest geo-api PROD mesuré s'il diffère.
4. **État mesuré avant toute bascule (2026-09-25, smoke S7 local)** : prod sert 3900 collections, préprod 3886, 18 absentes en préprod (`qc-zoning-events-*`) — le smoke est aujourd'hui rouge, la bascule doit le rendre vert.
5. **Quota ns geo-preprod en parallèle** : les jambes font coexister le Job freshness (limits 500m / 768Mi) et le Job copy-docs (500m / 512Mi) puis recon (500m / 768Mi) — au plus 2 pods bascule simultanés. Marge de la ResourceQuota geo-preprod : `unverified` (à confirmer par k8s).

## Restore depuis un backup — `MODE=restore` / `MODE=list`

Input `MODE` : `chain` (défaut, et toujours pour un run planifié : jambes `pg` + `s3`
ci-dessus, inchangées) | `restore` (restaurer la préprod geo DEPUIS un backup quotidien de
`geo-backup`, voir `../backup/`) | `list` (lecture seule). Port de la bascule immo
(rhanka/radar-immobilier#777), mêmes gardes. Logique : `restore-mode.mjs` (runner, kubectl
seul) + `backup-restore.cjs` (étapes in-pod embarquées dans les templates, `node -e`, image
geo-api, 0 python, 0 image nouvelle). `BASCULE_SCHEDULE_ENABLED` inchangé.

| Input | Valeurs | Effet |
| --- | --- | --- |
| `MODE` | `chain` \| `restore` \| `list` | voir ci-dessus |
| `BACKUP_ID` | `latest` (défaut) \| `AAAA-MM-JJ` | `latest` = `manifests/latest.json` → `latestComplete` (jamais le dernier partiel) ; une date = `manifests/<D>.json` |
| `ALLOW_STALE_BACKUP` | `false` \| `true` | accepter un `latest` de plus de 24 h |
| `CYCLE_ID`, `CONFIRM`, `DRY_RUN`, `SKIP_ROLLOUT` | inchangés | G3 anti-rejeu inchangé ; `DRY_RUN=true` = lecture seule |

### Séquence (job `restore`, environment `geo-bascule`)

| Pas | Sous-commande | Ce qui se passe |
| --- | --- | --- |
| S0 | `preflight-backup` | **G3 (`CONFIRM`) en premier, dans tous les MODE (list compris), avant l'écriture des Secrets et tout Job** (re-contrôlé avant chaque écriture de Secret et chaque Job) ; binaires, params, format `BACKUP_ID`/`CYCLE_ID`, endpoint figé ; destinations interdites de la copie = bucket prod figé `sentropic-geo` + `PROD_DOCS` + bucket de backup (jamais une liste vide ; l'étape in-pod refuse une liste vide et fige en plus `sentropic-geo` et `geo-backup`) ; `PREPROD_DOCS` parmi elles ⇒ refus |
| S0.s | `backup-secret-fill` | réécrit les Secrets pré-créés `geo-backup-reader-preprod` (depuis `GEO_BACKUP_READER_PREPROD_*`) et, en `restore`, `geo-backup-restore-docs` (depuis `GEO_BACKUP_RESTORE_DOCS_*`) — gardes #405 : une ligne, `^[A-Za-z0-9]{16,128}$` / `^[A-Za-z0-9/+=]{16,128}$`, endpoint `https://s3.bhs.io.cloud.ovh.net`, `kubectl replace --dry-run=server` des deux avant la première écriture, jeu de clés vérifié ; valeurs par `env:` seulement, jamais en argv/log |
| R0 | `backup-resolve` | Job de lecture AVANT toute mutation : `BACKUP_ID` → D ; statut `complete` exigé ; `latest` > 24 h refusé sauf `ALLOW_STALE_BACKUP` (âge = début du dump) ; date explicite non bloquante ; sidecar sha256 = manifeste, taille, **sha256 du dump recalculé en flux** (préprod geo SANS PostgreSQL : le dump est vérifié, pas restauré) ; PIN `backup-pin.json` |
| S3' | `docs-restore` | G3 ; état AU JOUR D du préfixe servi `normalized/` d'après `docs-inventory/<D>.json` (sha256 = manifeste) : copie **côté serveur** signée par `geo-backup-restore-docs`, clé `geo-backup/docs/normalized/X` → `sentropic-geo-preprod/normalized/X` (préfixe `docs/` retiré, clé source conservée), depuis la version enregistrée, sinon celle dont l'ETag est celui de l'inventaire si l'objet a été réécrit depuis ; `UploadPartCopy` au-delà de 5 GiB (lève la limite du point ouvert 2 pour ce mode) ; additif ; `GrantFullControl id=<BASCULE_DOCS_SYNC_GRANTEE>` exactement comme docs-sync (même variable, même défaut : canonical id owner/serving de `sentropic-geo-preprod`) ; entrées `excluded` par le backup lui-même (préfixes exclus, backup toujours `complete`) traitées comme le backup les traite : non exigées, comptées à part (`excluded`) et journalisées ; tout autre objet absent du backup (`pending`, `failed`) ou sans version restaurable ⇒ refus avant la 1re copie |
| S3b' | `recon-backup` | préprod ⊇ inventaire(D) sur `normalized/` (Key + Size) ; sentinel `recon.ok.json` (D + sha256 du manifeste) |
| S5' | `rollout` | G4 = sentinel de CE backup + `recon-backup` rejouée |
| S7 | `smoke` | landing 200 + `/collections` non vide ; préprod ⊇ prod devient **consultatif** (une collection créée en prod après D peut manquer) |

`DRY_RUN=true` : S0 (G3) + S0.s + R0 + plan S3' (0 copie) + smoke informatif. **Un restore
DRY écrit quand même les Secrets** (mêmes valeurs, nécessaires aux Jobs de lecture) **et
lance R0** (Job de lecture seule) ; ni copie, ni rollout. Job `list` : S0 (G3, `CONFIRM`
dans l'env du job) + S0.s + Job de liste → journal, résumé du run, artefact
`backup-list-geo-<CYCLE_ID|run_id>` (`backup-list.json`, format `radar-backup-list/v1`
attendu par l'orchestrateur immo).
Le runner lit le message de fin des pods (RBAC pods get/list existante), jamais les logs,
et **seulement sur les pods de l'instance du Job qu'il vient de créer** (uid lu après
l'apply ; ownerReference contrôleur ou label `controller-uid`) — jamais un pod d'une
instance précédente du même nom ; sans uid, aucun verdict.

Budget du job `restore` : **350 min** (plafond 360), au-dessus de la somme des attentes
runner des étapes (≈ 313 min : R0 45 + S3' 183 + recon 15 + G4 15 + rollout 10 +
served-ids 45) : un Job bloqué finit par son propre timeout (échec d'étape), pas par la
coupure du job (annulation).

### Contrat e2e (`CYCLE_ID`)

- job `restore` : `geo-served-canonical-ids-<CYCLE_ID>` après le smoke (inchangé) ;
- job `cycle-leg` (`needs: [pg, s3, restore]`) : `legs.geo` gagne `mode` et `backup`
  (`id`, `date`, sha256 manifeste/dump, `dump_started_at` = `t1`) ; en MODE=restore,
  `verdict.pg` = R0 (backup + dump vérifiés), `verdict.s3` = job `restore` ;
- `run-name: bascule-preprod <MODE> <CYCLE_ID>` (corrélation exacte par l'orchestrateur).

### Identités et prérequis

| Élément | Contenu | Statut |
| --- | --- | --- |
| Secret `geo-backup-reader-preprod` (ns `geo-preprod`, OVH 809855) | clés `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET` ; GetObject `pg/*`, `manifests/*`, `docs-inventory/*`, `docs/*` + ListBucket | créé et testé par k8s ; secrets GitHub `GEO_BACKUP_READER_PREPROD_*` en place dans `geo-bascule` ; rotation 90 j (`CRED_CYCLE.md`) |
| Secret `geo-backup-restore-docs` (ns `geo-preprod`, identité DÉDIÉE `geo-backup-restore-preprod`, OVH 809950) — signataire S3' (`BACKUP_DOCS_COPY_SECRET`) | clés `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET` (= `geo-backup`) ; GetObject (avec versionId) sur `geo-backup/docs/normalized/*` ; `pg/` 403 ; aucune écriture sur le backup ; ListBucket + GetBucketLocation + PutObject + PutObjectAcl sur `sentropic-geo-preprod`, sans delete ; CopyObject versionné avec grant = 200 | créé et testé par k8s (6/6, puis 7/7 : LIST réel 200 sur la préprod) ; secrets GitHub `GEO_BACKUP_RESTORE_DOCS_*` en place dans `geo-bascule` ; rotation 90 j (`CRED_CYCLE.md`) |
| RBAC `geo-ci-bascule-preprod` | secrets get/update sur `geo-backup-reader-preprod` et `geo-backup-restore-docs` seulement (ni create/patch/list) — `rbac-ci-bascule-preprod.yaml` | à appliquer par k8s |
| Grant des objets copiés | `GrantFullControl id=${BASCULE_DOCS_SYNC_GRANTEE}` — même variable et même défaut que docs-sync (`1901410700457444:9056dbb240a04d2584ffbaec38171228`, owner/serving de `sentropic-geo-preprod`) | variable de dépôt, surchargeable |
| NetworkPolicy | les pods portent `app.kubernetes.io/name=geo-preprod-sync` → `allow-geo-sync-egress` existante (DNS + S3-BHS) | rien à ajouter |

OVH : `s3:GetObjectVersion` est refusé dans les policies ; une lecture versionnée est un
GetObject / CopyObject avec `versionId`, couverte par GetObject.

## Lancer une sous-commande à la main (hors workflow)

```bash
# mêmes variables d'env que le workflow — 0 cred S3/DB runner
node deploy/ci/bascule-preprod/bascule.mjs preflight      # les deux jambes
node deploy/ci/bascule-preprod/bascule.mjs preflight pg   # jambe PG seule (job `pg`)
node deploy/ci/bascule-preprod/bascule.mjs preflight s3   # jambe S3 seule (job `s3`)
node deploy/ci/bascule-preprod/bascule.mjs smoke        # API publique, lecture seule
node deploy/ci/bascule-preprod/bascule.selftest.mjs     # fonctions pures, 0 appel réel

# contrat e2e — served ids ZONES (API publique, lecture seule, 0 cred)
npm install --prefix /tmp/served-ids-builder --no-save --ignore-scripts "@sentropic/geo@$(node deploy/ci/bascule-preprod/served-ids.mjs builder-version)"
node deploy/ci/bascule-preprod/served-ids.mjs build --builder-dir /tmp/served-ids-builder --out /tmp/served-ids
node deploy/ci/bascule-preprod/served-ids.selftest.mjs  # 0 réseau ; YAML_RESOLVE_FROM=<package.json> si pas de node_modules
```
