# bascule-preprod — bascule PROD → PRÉPROD geo (« iso-prod »)

**Clone geo de la recette immo** (`radar-immobilier:deploy/ci/bascule-preprod/`, i-cond) :
mêmes chemins, mêmes noms de fichiers, même mécanique. Seules différences : noms geo,
buckets/préfixes, namespaces, runners geo, et le sous-ensemble d'étapes arbitré par i-cond
(préprod geo SANS PostgreSQL). Rejouable par la CI / l'owner SANS IA. **0 Python.**

> CD-native (iso immo) : le bundle prod (2 SealedSecrets + Job rôle RO + CronJob dump + VAP + RBAC T1)
> est appliqué par le CD `bascule-bundle-cd.yml` (SA permanente `geo-ci-bascule-prod`) — 1er run
> dispatché par k8s après merge (`install-cd-bootstrap.sh`), puis au merge. Les **netpols ne font pas
> partie du bundle** (`netpol-geo-db-backup.k8s-apply.yaml`, appliquée par k8s). La bascule tourne en
> planification nocturne (`bascule-preprod.yml`, armée par `BASCULE_SCHEDULE_ENABLED`) ou en
> `workflow_dispatch` (CONFIRM). Voir `CD_NATIVE_MIGRATION.md` et `CRED_CYCLE.md`.

## RUNNER KUBECTL-ONLY (contrat owner, NON négociable — identique immo)

**AUCUNE cred S3/DB, AUCUN listing/clé ne transite ni n'est lu par le runner GitHub.**
Le runner ne fait QUE :

- `kubectl` (2 kubeconfigs : **préprod** par défaut + **PROD** pour le seul trigger dump) :
  patch cronjob (suspend), dispatch + **OBSERVE `.status`** des Jobs, `rollout restart` geo-api.
- `curl` sur l'**API geo publique** (smoke S7 : données publiques, 0 cred).

**Le runner ne lit JAMAIS `kubectl logs`** (STATUS-ONLY). Debug = in-cluster.
Tout l'accès object-store/DB vit dans des Jobs verdict-only (creds via `secretKeyRef`).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `bascule.mjs` | CLI Node kubectl-only : `preflight`, `dump`, `copy-docs`, `recon`, `rollout`, `smoke` + gardes + `classifyJobStatus`. |
| `bascule.selftest.mjs` | Self-test des fonctions pures (0 appel réel). |
| `s3-check-job.tmpl.yaml` | Checks S3 verdict-only (aws-cli, même pin qu'immo) : `freshness` (S1) et `recon` (S3b). |
| `docs-sync-job.tmpl.yaml` | Copie `normalized/` prod → préprod (S3) : image geo-api, aws-sdk `CopyObject` server-side ADDITIF + `GrantFullControl`, identité éphémère k8s. |
| `cronjob-db-backup-prod.yaml` | CronJob `geo-db-backup-prod` (ns geo, suspendu) : `pg_dump --format=custom --no-owner --no-privileges` RO → `geo-postgres/prod/sets/<ISO-ts>/geo.dump` (`EXPECTED_DATABASE=geo`). |
| `db-ro-role-provision.yaml` | ConfigMap SQL + Job : rôle `geo_db_ro_prod` (`pg_read_all_data` + `CONNECT` sur `current_database()`), superuser `geo-postgis-credentials`. |
| `vap-ci-trigger-suspend-only.yaml` | VAP : la SA trigger ne peut muter QUE `spec.suspend` de `geo-db-backup-prod`. |
| `rbac-ci-trigger-prod.yaml` | SA/Role/RB `geo-ci-trigger-prod` (ns geo) : get/patch du seul CronJob dump. |
| `rbac-ci-bascule-prod.yaml` | SA permanente `geo-ci-bascule-prod` (ns geo) : apply du bundle, 0 `secrets:create`. |
| `rbac-ci-bascule-preprod.yaml` | SA `geo-ci-bascule-preprod` (ns geo-preprod) : Jobs + rollout geo-api, 0 secrets, 0 logs. |
| `geo-db-ro-prod-sealed.yaml`, `geo-pra-writer-prod-sealed.yaml` | SealedSecrets **committées par geo-cond** (scellées, validées) — appliquées par le bundle. |
| `netpol-geo-db-backup.k8s-apply.yaml` | **À appliquer par k8s** (jamais par un workflow) : ingress postgis + egress des pods de backup (ns geo). |
| `install-cd-bootstrap.sh` | Install one-time (k8s lane, cluster-admin, après merge) : RBAC des SA, 3 kubeconfigs GH, armement, dispatch du CD bundle. |
| `../../../.github/workflows/bascule-preprod.yml` | Le run (schedule + dispatch). |
| `../../../.github/workflows/bascule-bundle-cd.yml` | Apply du bundle au merge. |

## Séquence geo (sous-ensemble iso de S0→S7)

| Pas | Sous-commande | Ce qui se passe | Où |
| --- | --- | --- | --- |
| S0 | `preflight` | binaires runner (`node kubectl curl`) + params (dont `EXPECTED_DATABASE`, `BHS`, `DUMP_BUCKET`) ; **0 cred S3/DB runner**. | runner |
| S1 | `dump` | **DÉCLENCHEUR T1** : `kubectl --kubeconfig $DUMP_KUBECONFIG -n geo patch cronjob geo-db-backup-prod suspend=false` ; **Job freshness** (poll interne : LastModified > T1, clé ⊇ `EXPECTED_DATABASE`, `.dump`, Size>0) ; **re-suspend** toujours. | runner (kubectl) + Job |
| S3/S4 | `copy-docs` | Job `geo-normalized-sync-prod-to-preprod` (image geo-api) : pré-check GET fail-closed + boucle `CopyObject` server-side `s3://sentropic-geo/normalized/` → `s3://sentropic-geo-preprod/normalized/` + `GrantFullControl`. ADDITIF, idempotent. DRY : non jouée. | préprod (Job) |
| S3b | `recon` | Job DIFF LIST-only Key+Size → dest ⊇ src → exit 0, sinon 1. Sentinel local `recon.ok.json`. | préprod (Job) |
| S5' | `rollout` | **G4** (sentinel + recon rejouée) puis `kubectl rollout restart deployment/geo-api -n geo-preprod` + `rollout status` : geo-api recharge son index (StoreProvider). | préprod (kubectl) |
| S7 | `smoke` | `curl` API publique : landing préprod 200 + ids `/collections` préprod ⊇ ids `/collections` prod. | runner (curl) |

Ordre workflow : S0 → [DRY : copy-docs non jouée, recon + smoke informatifs] → S1 → S3 → S3b → S5' → S7 → pointeurs (`always`).

## Mapping immo → geo

| immo | geo | justification |
| --- | --- | --- |
| S0 preflight | identique | — |
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
| `KUBE_CONFIG_DATA_BASCULE_PREPROD` | secret | kubeconfig préprod — SA `geo-ci-bascule-preprod` (pilotage). |
| `KUBE_CONFIG_DATA_PROD_TRIGGER` | secret | kubeconfig PROD — SA `geo-ci-trigger-prod` (2 patch cronjob, VAP). Non requis en DRY. |
| `KUBE_CONFIG_DATA_PROD` | secret | kubeconfig PROD — SA `geo-ci-bascule-prod` (apply du bundle). |
| `BASCULE_EXPECTED_DATABASE` | var | nom littéral de la DB prod geo (défaut `geo`, fourni par k8s). |
| `BASCULE_*` (autres) | vars | endpoint, buckets, préfixes, CronJob, ns, URLs API, grantee — NON secrets, défauts dans le workflow. |

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

1. **DRY (défaut, sûr).** `CONFIRM=iso-prod-<aujourd'hui UTC>`, `DRY_RUN=true` : preflight + recon + smoke informatifs, aucune écriture.
2. **Exécution.** `DRY_RUN=false` + `CONFIRM=iso-prod-<date du jour UTC>`.
3. **Isolation S5'** : `SKIP_ROLLOUT=true` si le patch deployment manque.
4. **DR DB** : dumps durables sous `s3://radar-immobilier-backups-preprod/geo-postgres/prod/sets/<ts>/geo.dump` ; restore = `pg_restore` in-cluster à la demande (hors bascule, préprod sans PG).

## Points ouverts (non déterminables par lecture)

1. **Copie additive** : aucun delete en préprod (objets supprimés en prod restent servis) et `normalized/coherence.json` n'est pas re-stampé (il est copié si la prod en a un) — conséquence de l'arbitrage « iso docs-sync ».
2. **CopyObject ≤ 5 Go par objet** (limite S3) : sinon le Job échoue (fail-closed).
3. **Digest de l'upload du CronJob** : épinglé sur le build `main-f39cd4b2` (CD préprod) ; re-pinner sur le digest geo-api PROD mesuré s'il diffère.
4. **État mesuré avant toute bascule (2026-09-25, smoke S7 local)** : prod sert 3900 collections, préprod 3886, 18 absentes en préprod (`qc-zoning-events-*`) — le smoke est aujourd'hui rouge, la bascule doit le rendre vert.

## Lancer une sous-commande à la main (hors workflow)

```bash
# mêmes variables d'env que le workflow — 0 cred S3/DB runner
node deploy/ci/bascule-preprod/bascule.mjs preflight
node deploy/ci/bascule-preprod/bascule.mjs smoke        # API publique, lecture seule
node deploy/ci/bascule-preprod/bascule.selftest.mjs     # fonctions pures, 0 appel réel
```
