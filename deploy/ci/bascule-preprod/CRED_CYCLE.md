# Bascule prod geo — credential cycle (governance record)

Clone of the immo record (`radar-immobilier:deploy/ci/bascule-preprod/CRED_CYCLE.md`).
The geo bascule prod bundle references k8s Secrets by NAME. Their material is committed as
**SealedSecrets** (encrypted, safe in git — `geo-db-ro-prod-sealed.yaml`,
`geo-pra-writer-prod-sealed.yaml`, sealed and committed by geo-cond) and materialized
in-cluster by the sealed-secrets controller. **No plaintext is ever committed
and no GH secret carries these creds.** A `.env` copy stays the recovery convenience per the
governed k8s↔tenant cred cycle (CLAUDE.md), so recovery is verifiable at any time — no
per-act owner GO.

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

## GH secrets (kubeconfigs only — never an app cred)

| GH secret | SA | minted by |
| --- | --- | --- |
| `KUBE_CONFIG_DATA_PROD` | `geo-ci-bascule-prod` (ns geo) | `install-cd-bootstrap.sh` step 2 |
| `KUBE_CONFIG_DATA_BASCULE_PREPROD` | `geo-ci-bascule-preprod` (ns geo-preprod) | step 2 |
| `KUBE_CONFIG_DATA_PROD_TRIGGER` | `geo-ci-trigger-prod` (ns geo) | step 5 (after the bundle CD run and its anti-RCE gate) |

Legacy SA token secrets (non-expiring, like the existing deployers): rotation = delete the
`<sa>-token` secret and re-run the corresponding mint step.

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
