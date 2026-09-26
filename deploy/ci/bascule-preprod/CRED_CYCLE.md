# Bascule prod geo — credential cycle (governance record)

Clone of the immo record (`radar-immobilier:deploy/ci/bascule-preprod/CRED_CYCLE.md`).
The geo bascule prod bundle references k8s Secrets by NAME. Their material is committed as
**SealedSecrets** (encrypted, safe in git — `geo-db-ro-prod-sealed.yaml`,
`geo-pra-writer-prod-sealed.yaml`, sealed and committed by geo-cond) and materialized
in-cluster by the sealed-secrets controller. **No plaintext is ever committed
and no GH secret carries these creds.** A `.env` copy stays the recovery convenience per the
governed k8s↔tenant cred cycle (CLAUDE.md), so recovery is verifiable at any time — no
per-act owner GO.

**Scope of the SealedSecret model: the two bundle Secrets only.** The daily prod backup
identities (last section) follow the owner rule "no SealedSecret committed": their source
of truth is the GitHub Environment `geo-prod-bundle` + `.env`, and the CD writes them.

## Minted secrets — ns geo (prod), bundle SealedSecrets

| secret (k8s name, hyphen) | keys | consumer | sealed by |
| --- | --- | --- | --- |
| `geo-db-ro-prod` | `POSTGRES_USER=geo_db_ro_prod`, `POSTGRES_PASSWORD=<openssl rand>`, `POSTGRES_DB=geo` | CronJob `geo-db-backup-prod` (pg_dump RO) + Job `geo-db-ro-role-provision` (`RO_PASSWORD`) | sealed + committed by geo-cond |
| `geo-pra-writer-prod` | `S3_ACCESS_KEY`, `S3_SECRET_KEY` | CronJob upload (PutObject → `radar-immobilier-backups-preprod/geo-postgres/`) | sealed by k8s, committed by geo-cond |

Referenced, not minted here: `geo-postgis-credentials` (ns geo, superuser of the postgis
StatefulSet — `POSTGRES_DB/USER/PASSWORD`, host `geo-postgis.geo.svc:5432`), used ONLY by the
RO-role provision Job. The provision SQL is DB-name agnostic (`current_database()`); the literal
prod DB name `geo` (from k8s) is `EXPECTED_DATABASE` and names the dump
`geo-postgres/prod/sets/<ISO-ts>/geo.dump`.

## Secrets — ns geo-preprod (run Jobs)

| secret | keys | consumer | lifecycle |
| --- | --- | --- | --- |
| `geo-backups-reader-preprod` | `S3_ACCESS_KEY`, `S3_SECRET_KEY` (+ `S3_BUCKET`/`S3_ENDPOINT`/`S3_REGION`, unused by the Job) | Job freshness (S1, LIST backups) — var `FRESHNESS_CHECK_SECRET` | persistent, deposited by k8s |
| `geo-normalized-reader-preprod` | `S3_ACCESS_KEY`, `S3_SECRET_KEY` (+ `S3_ENDPOINT`/`S3_REGION`) | Job recon (S3b, RO LIST of both `normalized/`) — var `CHECK_DOCS_SECRET` | persistent, deposited by k8s |
| `geo-normalized-src-preprod` **(EPHEMERAL)** | `S3_ACCESS_KEY`, `S3_SECRET_KEY` (read `sentropic-geo` + rw `sentropic-geo-preprod`) | copy Job `geo-normalized-sync-prod-to-preprod` ONLY | created by k8s (watch of the Job name, `ownerRef=Job.UID`), GC at the Job TTL (3600 s). **Never referenced by a check Job.** |

GrantFullControl grantee (serving identity preprod, canonical id, not a secret):
`1901410700457444:9056dbb240a04d2584ffbaec38171228`.

**Naming (do not conflate):** the SECRET object name is hyphenated (`geo-db-ro-prod`,
RFC1123); the PG ROLE name and the `POSTGRES_USER` VALUE are underscored (`geo_db_ro_prod`).
`db-ro-role-provision.yaml` sets the role password from `geo-db-ro-prod/POSTGRES_PASSWORD`
via psql `\getenv` (never in argv/logs). To confirm on the geo postgis: `log_statement=none`
(immo measured it on theirs) so the `ALTER ROLE … PASSWORD` statement is not logged.

## GH secrets — Environment secrets, main-only

The three bascule kubeconfigs are **GitHub Environment secrets**, set with
`gh secret set <NAME> --repo rhanka/geo --env <vault>`. Each vault Environment has **no
reviewer** and a deployment branch policy of **`main` only**: the kubeconfig is readable only
by a job started from `main` (a dispatch or re-run on any other branch cannot read it).

| GH secret | Environment (vault) | SA | read by | minted by |
| --- | --- | --- | --- | --- |
| `KUBE_CONFIG_DATA_PROD` | `geo-prod-bundle` | `geo-ci-bascule-prod` (ns geo) | `bascule-bundle-cd.yml` job `apply-bundle` | `install-cd-bootstrap.sh` step 2 |
| `KUBE_CONFIG_DATA_BASCULE_PREPROD` | `geo-bascule` | `geo-ci-bascule-preprod` (ns geo-preprod) | `bascule-preprod.yml` jobs `pg` + `s3` | step 2 |
| `KUBE_CONFIG_DATA_PROD_TRIGGER` | `geo-bascule` | `geo-ci-trigger-prod` (ns geo) | `bascule-preprod.yml` job `pg` | step 5 (after the bundle CD run and its anti-RCE gate) |

The vault `geo-prod-bundle` also holds the daily prod backup identities
(`GEO_BACKUP_{WRITER,READER,PURGER}_{ACCESS,SECRET}_KEY` + 4 variables, see the last section),
read by `bascule-bundle-cd.yml` job `apply-backup`.

The vault Environments add no approval: the owner gate of `bascule-bundle-cd.yml` stays the
`approve` job (Environment `geo-prod`, required reviewer). Out of the bascule but same rule:
`KUBE_CONFIG_DATA_PREPROD` lives in Environment `geo-preprod-cd` (`cd-preprod.yml` job
`deploy-preprod`; its owner gate stays `approve` on `geo-preprod`).

**Repository-level secrets with these names are removed** (`gh secret delete <NAME> --repo
rhanka/geo`) once a green run from the vaults is verified. Never re-create one at repository
level: it would be readable again from any branch. To verify: `gh secret list --repo rhanka/geo`
must not list them; `gh secret list --repo rhanka/geo --env <vault>` must.

Legacy SA token secrets (non-expiring, like the existing deployers): rotation = delete the
`<sa>-token` secret and re-run the corresponding mint step (it writes to the same `--env` vault).

## Rotation
- `geo-db-ro-prod`: regenerate password (openssl) → re-seal → commit → the bundle re-applies on
  merge, the idempotent `geo-db-ro-role-provision` Job re-asserts the new password → `.env` backup.
  No app impact (dump-only role).
- `geo-pra-writer-prod`: rotate the underlying S3 key → re-seal → commit → `.env` backup.
- `geo-backups-reader-preprod`, `geo-normalized-reader-preprod`: rotate the S3 key → update the
  secret (k8s) → `.env` backup.
- `geo-normalized-src-preprod`: ephemeral per run, nothing to rotate in git.

## Verify recovery (any operator/owner/AI, no owner GO)
1. secrets present: `kubectl -n geo get secret geo-db-ro-prod geo-pra-writer-prod` and
   `kubectl -n geo-preprod get secret geo-backups-reader-preprod geo-normalized-reader-preprod`.
2. role usable: last `geo-db-backup-prod` Job `.status` = Complete (or a psql login as
   `geo_db_ro_prod` with the secret password succeeds).
3. latest dump present: `s3://radar-immobilier-backups-preprod/geo-postgres/prod/sets/<ts>/geo.dump`
   (`pg_restore --list` of it is readable).
4. `.env` holds the current values (backup) at the documented owner location.

## Daily prod backup identities (deploy/ci/backup/)

Clone of the immo record (radar-immobilier#771), with the copy and the purge split
between two identities (geo-cond review).

| secret (k8s name) | keys | GitHub source (Environment `geo-prod-bundle`) | consumer | rights |
| --- | --- | --- | --- | --- |
| `geo-backup-writer` | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET`, `SOURCE_BUCKET` | secrets `GEO_BACKUP_WRITER_ACCESS_KEY`, `GEO_BACKUP_WRITER_SECRET_KEY` | initContainer `backup` of CronJob `geo-backup-daily` | read `sentropic-geo`; `geo-backup` Put/Get/List/multipart; **no delete of any kind** (no DeleteObject, no DeleteObjectVersion, no BypassGovernanceRetention) |
| `geo-backup-purger` | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET` | secrets `GEO_BACKUP_PURGER_ACCESS_KEY`, `GEO_BACKUP_PURGER_SECRET_KEY` | container `purge` of CronJob `geo-backup-daily` | `geo-backup` DeleteObject without VersionId (delete-marker) restricted by ARN to `pg/*`, `manifests/*`, `docs-inventory/*` + ListBucket / GetBucketLocation; no GET, no PUT, no `docs/` |
| `geo-backup-reader` | `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET` | secrets `GEO_BACKUP_READER_ACCESS_KEY`, `GEO_BACKUP_READER_SECRET_KEY` | CronJob `geo-backup-freshness` + restores (`deploy/ci/backup/RESTORE.md`) | `geo-backup` GetObject (incl. versionId), ListBucket, ListBucketVersions |

Shared keys come from the Environment variables `BACKUP_S3_ENDPOINT` (→ `S3_ENDPOINT`,
exactly `https://s3.bhs.io.cloud.ovh.net`),
`BACKUP_S3_REGION` (→ `S3_REGION`, exactly `bhs`), `BACKUP_BUCKET` (→ `BACKUP_BUCKET`, `geo-backup`) and
`BACKUP_SOURCE_BUCKET` (→ writer `SOURCE_BUCKET`, `sentropic-geo`).

**Source of truth: GitHub Environment `geo-prod-bundle` + `.env`. No SealedSecret, nothing
committed.** The k8s lane sets the 6 secrets and 4 variables in the vault (main only) and keeps
the same values in its `.env` recovery copy at the documented owner location. The three k8s
Secrets (ns `geo`, type `Opaque`) are pre-created by the k8s lane; `bascule-bundle-cd.yml` job
`apply-backup` rewrites them from GitHub at every run (`kubectl replace`: exact key set, no
`last-applied-configuration` copy of the values). The SA `geo-ci-bascule-prod` holds
get/update on these three names only (server-side dry-run of the three before any write) — no create, patch, list, watch or delete on Secrets.

**Rotation: every 90 days** (and at once on suspected exposure), one identity at a time:

1. k8s lane: create a new S3 credential for the OVH user of the identity (re-POST
   `s3Credentials`; the old one stays valid for now).
2. k8s lane, same moment: set the new values in the vault
   (`gh secret set GEO_BACKUP_<WRITER|PURGER|READER>_ACCESS_KEY --env geo-prod-bundle --repo
   rhanka/geo`, same for `_SECRET_KEY`; single-line values of the expected charset/length — the CD refuses any other)
   **and** in the `.env` recovery copy.
3. `workflow_dispatch` of `bascule-bundle-cd` (owner approval; no `backup_run_now` needed):
   `apply-backup` rewrites the Secret; its log shows `secret/geo-backup-<id> replaced from
   GitHub — keys: …`. No PR, no commit.
4. Verify with the NEW credential:
   - writer: one backup run (next night, or `workflow_dispatch` input
     `backup_run_now=true`, outside 03:13–06:30 UTC) → `backup` step `VERDICT OK`,
     `manifests/latest.json` date = today and `status: complete`;
   - purger: the `purge` step of that run → `PURGE VERDICT OK` (a run with nothing to
     purge still proves the LIST; the next purge date proves the DeleteObject);
   - reader: the next `geo-backup-freshness` Job `Complete`, and a restore check of that
     backup (`RESTORE.md` §0–1: download `pg/D/geo.dump`, `sha256sum -c` OK,
     `pg_restore --list` lists).
5. Only after the checks of that identity pass: k8s lane deletes its old credential.
6. Record the rotation date (next due = +90 days).

Verify recovery at any time (any operator/owner/AI, no owner GO):
- `gh secret list --repo rhanka/geo --env geo-prod-bundle` lists the 6 `GEO_BACKUP_*` secrets
  and `gh variable list --repo rhanka/geo --env geo-prod-bundle` the 4 variables; the `.env`
  copy holds the same values;
- `kubectl -n geo get secret geo-backup-writer geo-backup-purger geo-backup-reader`; the last
  `apply-backup` run is green;
- last `geo-backup-daily` and `geo-backup-freshness` Jobs `Complete`; `manifests/latest.json`
  of `geo-backup` fresh (`latestComplete.date` = today or yesterday).

## Preprod restore-from-backup reader (bascule `MODE=restore|list`)

Dedicated preprod identity, created and tested by the k8s lane (2026-09-26).

| secret (k8s name) | OVH user | keys | GitHub source (Environment `geo-bascule`, main-only) | consumer | rights |
| --- | --- | --- | --- | --- | --- |
| `geo-backup-reader-preprod` (ns `geo-preprod`, pre-created Opaque, no ownerReference) | 809855 | `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET` (= `geo-backup`) | secrets `GEO_BACKUP_READER_PREPROD_ACCESS_KEY`, `GEO_BACKUP_READER_PREPROD_SECRET_KEY` | `bascule-preprod.yml` jobs `list` and `restore` (Jobs `geo-bascule-backup-*`, `geo-docs-restore-backup`) | `geo-backup`: GetObject on `pg/*`, `manifests/*`, `docs-inventory/*`, `docs/*` + ListBucket; no write, no delete |

OVH: `s3:GetObjectVersion` is refused in policies; a versioned read (GetObject /
CopyObject with `versionId`) is covered by GetObject.

**Source of truth: GitHub Environment `geo-bascule` + `.env`. No SealedSecret.** The
bascule rewrites the pre-created Secret at every `MODE=restore|list` run (step "Write
backup reader Secret from GitHub", `restore-mode.mjs backup-secret-fill`): values via
`env:` only, same guards as #405 (single-line, `^[A-Za-z0-9]{16,128}$` /
`^[A-Za-z0-9/+=]{16,128}$`, endpoint pinned to `https://s3.bhs.io.cloud.ovh.net`),
`kubectl replace --dry-run=server` then `kubectl replace`, key set checked on the
object the server returns. SA `geo-ci-bascule-preprod`: secrets get/update by
resourceNames on `geo-backup-reader-preprod` and `geo-backup-restore-docs` (the S3'
signer, section below) only (`rbac-ci-bascule-preprod.yaml`) — no create, patch, list,
watch or delete.

**Rotation: every 90 days** (and at once on suspected exposure):

1. k8s lane: new `s3Credentials` for OVH user 809855 (the old one stays valid for now).
2. Update locations 1 to 3 by hand (section "Where every geo backup key lives" below): the
   GitHub secrets `GEO_BACKUP_READER_PREPROD_ACCESS_KEY` / `_SECRET_KEY` (`gh secret set …
   --env geo-bascule --repo rhanka/geo`), the central `.env`, the geo `.env`.
3. `workflow_dispatch` of `bascule-preprod.yml` with `MODE=list`: the step "Write backup
   reader Secret from GitHub" rewrites the k8s Secret and is green, and the backup list is
   printed (proves the new key).
4. Only then: k8s lane deletes the old credential; record the date (next = +90 days).

Verify recovery at any time: `kubectl -n geo-preprod get secret geo-backup-reader-preprod`
(3 keys); last `MODE=list` run green.

## Preprod restore-from-backup copy signer (bascule `MODE=restore`, S3')

Dedicated preprod identity, created and tested by the k8s lane (2026-09-26, 6/6: GET
`docs/normalized/*` with versionId 200; `pg/` 403; PUT on the backup 403; DELETE on preprod
403; versioned CopyObject with `x-amz-grant-full-control` 200). Second k8s check
2026-09-26 (effective policy + real tests 7/7): ListBucket + GetBucketLocation on
`sentropic-geo-preprod` (real LIST 200 — the preprod listing of S3'/S3b'), no delete of
any kind.

| secret (k8s name) | OVH user | keys | GitHub source (Environment `geo-bascule`, main-only) | consumer | rights |
| --- | --- | --- | --- | --- | --- |
| `geo-backup-restore-docs` (ns `geo-preprod`, pre-created Opaque, no ownerReference) | `geo-backup-restore-preprod` (809950) | `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET` (= `geo-backup`) | secrets `GEO_BACKUP_RESTORE_DOCS_ACCESS_KEY`, `GEO_BACKUP_RESTORE_DOCS_SECRET_KEY` | `bascule-preprod.yml` job `restore` (Job `geo-docs-restore-backup`: signer of the server-side copy `geo-backup/docs/normalized/X` → `sentropic-geo-preprod/normalized/X`) | `geo-backup`: GetObject (incl. versionId) on `docs/normalized/*`, nothing else; `sentropic-geo-preprod`: ListBucket + GetBucketLocation + PutObject + PutObjectAcl, no delete |

Written by the bascule exactly like the reader (step "Write backup Secrets from GitHub",
same #405 guards, server-side dry-run of both Secrets before the first write). SA
`geo-ci-bascule-preprod`: secrets get/update on `geo-backup-reader-preprod` and
`geo-backup-restore-docs` only. The copied objects carry `GrantFullControl
id=${BASCULE_DOCS_SYNC_GRANTEE}` (same variable and default as docs-sync).

**Rotation: every 90 days** (and at once on suspected exposure):

1. k8s lane: new `s3Credentials` for OVH user 809950 (the old one stays valid for now).
2. Update locations 1 to 3 by hand (section below): the GitHub secrets
   `GEO_BACKUP_RESTORE_DOCS_ACCESS_KEY` / `_SECRET_KEY` (`gh secret set … --env geo-bascule
   --repo rhanka/geo`), the central `.env`, the geo `.env`.
3. `workflow_dispatch` of `bascule-preprod.yml` with `MODE=restore` and `DRY_RUN=true`: the
   step "Write backup Secrets from GitHub" rewrites the k8s Secret and the S3' plan is green
   (proves the new key).
4. Only then: k8s lane deletes the old credential; record the date (next = +90 days).

Verify recovery at any time: `kubectl -n geo-preprod get secret geo-backup-restore-docs`
(3 keys); last `MODE=restore` run (or DRY) green.

## Where every geo backup key lives (4 locations) and how to rotate it

Each key lives in **four places**; the `.env` variable names are the GitHub secret names:

1. the GitHub Environment secret (`geo-prod-bundle` for the prod identities, `geo-bascule`
   for the preprod ones);
2. the central `.env` `/home/antoinefa/src/sentropic/.env` — source of the mint scripts,
   referenced by the k8s-ops registry;
3. the tenant `.env` `/home/antoinefa/src/geo/.env` (recovery copy; perms 600, ignored by git);
4. the k8s Secret (ns `geo` or `geo-preprod`), rewritten from (1) by the CD
   (`bascule-bundle-cd.yml` `apply-backup`) or by the bascule (`bascule-preprod.yml`
   `MODE=list|restore`) — never edited by hand.

| identity (OVH user) | OVH user id | (1) GitHub secrets — Environment | (4) k8s Secret — ns | rewritten by | rotation due |
| --- | --- | --- | --- | --- | --- |
| `geo-backup-writer` | à compléter (registre k8s) | `GEO_BACKUP_WRITER_ACCESS_KEY`, `GEO_BACKUP_WRITER_SECRET_KEY` — `geo-prod-bundle` | `geo-backup-writer` — `geo` | CD `apply-backup` | before 2026-12-25 |
| `geo-backup-reader` | à compléter (registre k8s) | `GEO_BACKUP_READER_ACCESS_KEY`, `GEO_BACKUP_READER_SECRET_KEY` — `geo-prod-bundle` | `geo-backup-reader` — `geo` | CD `apply-backup` | before 2026-12-25 |
| `geo-backup-purger` | à compléter (registre k8s) | `GEO_BACKUP_PURGER_ACCESS_KEY`, `GEO_BACKUP_PURGER_SECRET_KEY` — `geo-prod-bundle` | `geo-backup-purger` — `geo` | CD `apply-backup` | before 2026-12-25 |
| `geo-backup-reader-preprod` | 809855 | `GEO_BACKUP_READER_PREPROD_ACCESS_KEY`, `GEO_BACKUP_READER_PREPROD_SECRET_KEY` — `geo-bascule` | `geo-backup-reader-preprod` — `geo-preprod` | bascule `MODE=list|restore` | before 2026-12-25 |
| `geo-backup-restore-preprod` | 809950 | `GEO_BACKUP_RESTORE_DOCS_ACCESS_KEY`, `GEO_BACKUP_RESTORE_DOCS_SECRET_KEY` — `geo-bascule` | `geo-backup-restore-docs` — `geo-preprod` | bascule `MODE=restore` | before 2026-12-25 |

(2) and (3) hold the same variable names for every row.

**Rotation procedure** (every 90 days, and at once on suspected exposure; one identity at a
time; the k8s lane first mints a new `s3Credential` for the OVH user, the old one staying
valid):

- mettre à jour 1 à 3 à la main ;
- le CD ou la bascule propage vers 4 ;
- vérifier le backup ou le restore suivant ;
- seulement alors, supprimer l'ancienne s3Credential OVH.

(The per-identity steps above give the exact run that propagates to (4) and the check.)
