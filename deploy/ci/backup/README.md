# Daily prod backup — `geo-backup-daily`

A real, independent backup of production geo: every day, one dated, verified,
retained backup of the PostgreSQL database **and** of the source bucket
`sentropic-geo`, in a dedicated bucket, restorable by date. Port of the immo
job (rhanka/radar-immobilier#771, `radar-backup-daily`): same script logic,
same layout, same retention; the geo deltas are listed in
[Differences from the immo job](#differences-from-the-immo-job).

It is **not** the bascule dump `geo-db-backup-prod` (`*/5`, suspended by design,
only the bascule T1 trigger, under the suspend-only VAP — left untouched; its
dumps go to the immo bucket `radar-immobilier-backups-preprod/geo-postgres/`).

| File | Role |
| --- | --- |
| `cronjob-backup-daily.yaml` | CronJob `geo-backup-daily` (ns `geo`) |
| `backup-daily.cjs` | Node script of the `backup` container (shipped as ConfigMap `geo-backup-daily-script`) |
| `backup-daily.selftest.mjs` | Offline selftest (in-memory versioned S3 fake + wiring checks), run by CI and by the CD before any apply |
| `geo-backup-sealedsecrets.yaml` | **TODO — to commit verbatim**: the two SealedSecrets `geo-backup-writer` + `geo-backup-reader` minted and sealed by the k8s lane (scope strict ns `geo`). Until it is committed, the CD job refuses to apply anything. |
| [`RETENTION.md`](RETENTION.md) | Retention policy and how it is enforced |
| [`RESTORE.md`](RESTORE.md) | Restore a backup of date D (PG + objects) |

## What one run produces (day D, UTC)

Bucket `geo-backup`:

```
pg/D/geo.dump                pg_dump -Fc of db geo (RO role geo_db_ro_prod)
pg/D/geo.dump.sha256         sha256sum line, re-read after upload
pg/D/globals.sql(.sha256)    pg_dumpall --globals-only --no-role-passwords
docs/<key>                   incremental server-side mirror of sentropic-geo
docs-inventory/D.json        source state at D: key, size, ETag, lastModified,
                             backup ETag + version id (when known), state
manifests/D.json             THE record of backup D (see below)
manifests/latest.json        pointer to the newest manifest
```

(`docs/` is the mirror prefix required by the bucket lifecycle; the source keys
are kept as they are below it, e.g. `docs/raw/<source>/cas/<sha256>`.)

`manifests/D.json` (format `geo-backup-manifest/v1`) holds: status (`complete` |
`partial`), start/end times, dump key + sha256 + size + TOC entry count, the
database size (`pg_database_size`), PostgreSQL / PostGIS / pg_dump versions,
globals key + sha256, schema version (`unknown` on geo: no drizzle migrations
table), source counts (objects, bytes, copied, copied by multipart, up to date,
pending, failed, excluded) + inventory key + sha256, and the script sha256 /
image digest that produced it. The DB is dumped first and the source bucket is
listed after, so every object the DB references at dump time is in the
inventory.

## How a run works

Schedule `23 3 * * *` UTC (one hour after the immo backup, off the 04:17 UTC
monthly geo-fetch), `concurrencyPolicy: Forbid`, `activeDeadlineSeconds: 10800`,
`backoffLimit: 1`. One pod, two steps:

1. **initContainer `dump`** — image `postgis/postgis:16-3.4` (the image of the
   postgis StatefulSet). Positive DB assert (`EXPECTED_DATABASE=geo`), DB size,
   `pg_dump -Fc`, `pg_restore --list` (readability: a truncated archive fails
   here), `sha256sum`, globals without passwords (best-effort).
2. **container `backup`** — geo-api image pinned by the **same digest** as
   `geo-db-backup-prod` (Node + `@aws-sdk/client-s3` 3.1068). Guards (bucket
   names, versioning, dump size floor 64 KiB and ≥ 0.5 × the previous dump),
   upload with Content-MD5, **re-read of the whole object and sha256
   comparison**, source copy (server-side `CopyObject`; multipart
   `UploadPartCopy` above 4 GiB; skip when Size + ETag match or the copy is
   newer than the last source write; concurrency 8; 2-hour budget), inventory,
   manifest, `latest.json`, then the retention purge (delete-markers only).

Logs are verdict only (counts, backup keys, sha256) — never a source key, a row
or a credential. Last line: `VERDICT OK|PARTIAL|OK-PURGE-FAILED date=… status=…`.

| Exit | Meaning | Retry |
| --- | --- | --- |
| 0 | complete backup, purge done | — |
| 1 | transient failure before the manifest (DB unreachable, S3 5xx, re-read mismatch) | once (`backoffLimit: 1`) |
| 2 | refusal: wrong DB/bucket, versioning off, dump size anomaly | no (`podFailurePolicy`) |
| 3 | purge failed after a complete manifest (backup valid) | no |
| 4 | manifest written with `status=partial` (objects pending/failed) | no — next night resumes |

### Seed (first runs)

`sentropic-geo` holds ~119 GB / 116 584 objects (k8s lane measurement,
2026-09-26), of which the frozen archive `ops/decommission/20260913/` is
48.94 GB / 45 378 objects (excluded, see below): about **70 GB / 71 000
objects** to seed. The copy is idempotent and resumable: a run that hits the
2-hour budget ends as `partial` (exit 4, the Job shows `Failed` by design) with
the PG backup of the day valid, and the next run copies only what is still
pending. At the only measured rate (0.41 object/s in series, geo-cond
inventory), 8 workers give ≈ 3.3 objects/s, i.e. ≈ 6 h of copy ≈ 3 nights; the
real server-side rate is `unverified` until the first manifest (`docs.copied`
over the budget). `backup_run_now` (below) adds runs during the day; never start
one while another run is active (the CD refuses it).

### What is copied from `sentropic-geo`

Everything that is not explicitly excluded (a new prefix is backed up by
default). `DOCS_EXCLUDE_PREFIXES="ops/decommission/20260913/,pmtiles/"`.

| Prefix | Choice | Why |
| --- | --- | --- |
| `raw/` (CAS PV PDFs) | copied | irreplaceable; write-once (CAS) → copied once |
| `capture/` (incl. `capture/_runs/` manifests = proof v2) | copied | irreplaceable |
| `sources/` (incl. `sources/qc-zonage-grilles/`) | copied | irreplaceable |
| `registry/` (worklists, paid OCR) | copied | irreplaceable |
| `normalized/` | copied | not rebuildable in practice (proof v2 at 0/1106); rewritten under the same key → recopied when Size/LastModified move; each previous content stays a noncurrent version for 190 days |
| `exports/immo/` | copied | rebuildable but small JSON (contract `latest.json` + `snapshots/<sha256>.json` referenced by immo): cheap to keep |
| `docs/` (bucket prefix) | copied | rebuildable but small |
| other prefixes / root files (`deferred/`, `exchange/`, `catalog.json`, …) | copied | unknown value → default is to keep |
| `pmtiles/` | **excluded** | 2 province archives rebuilt from `normalized/` by the committed tippecanoe build (`scripts/build-pmtiles.mjs`, `deploy/pmtiles/`); rewritten under the same key at each rebuild, so every rebuild would pin a 190-day noncurrent copy of multi-GB archives; size of `qc-lots.pmtiles` `unknown` |
| `ops/decommission/20260913/` | **excluded** from the daily copy | frozen 48.94 GB archive of the former Scaleway bucket: copied **once** (below), then only listed |

Excluded objects are listed in each inventory with `state: "excluded"` (or
`backed-up` once a copy exists), so an inventory still describes the whole
source bucket at D.

### One-time copy of the frozen archive

After the seed reports `complete`, run the same Job with the archive prefix
removed from `DOCS_EXCLUDE_PREFIXES`: `workflow_dispatch` of
`bascule-bundle-cd` with `backup_run_now=true` **and**
`backup_include_archive=true` (owner-approved like any dispatch). The CD renders
a Job from the live CronJob and overrides that one variable client-side; the
CronJob is not changed. Repeat until the manifest of the run shows
`docs.pending = 0` (45 378 objects, several 2-hour runs). From then on the
nightly runs keep the exclusion (0 copy of the archive) and the inventories show
the archive objects as `backed-up`.

## Provisioning (k8s lane — done, 11/11 tests reported by the k8s lane)

- Bucket `geo-backup` (OVH BHS): versioning ON, object-lock GOVERNANCE default
  retention 7 days, lifecycle: noncurrent versions expire after **7 days** on
  `pg/`, `docs-inventory/`, `manifests/` and after **190 days** on `docs/`;
  incomplete multipart uploads after 1 day (see [`RETENTION.md`](RETENTION.md)).
- `geo-backup-writer` (keys `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `BACKUP_BUCKET`, `SOURCE_BUCKET`): read `sentropic-geo`; on
  `geo-backup` Put/Get/List/multipart + `DeleteObject` without VersionId
  (delete-marker only). No `DeleteObjectVersion`, no
  `BypassGovernanceRetention`. Used by the CronJob.
- `geo-backup-reader` (keys `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `BACKUP_BUCKET`): read-only on `geo-backup` (GetObject incl.
  versionId, ListBucket, ListBucketVersions). Never mounted by the CronJob; used
  for restores.
- Secret quota of ns `geo`: 12/16 after these two.
- **TODO**: commit the SealedSecrets handed over by the k8s lane, verbatim, as
  `deploy/ci/backup/geo-backup-sealedsecrets.yaml` (two documents). The CD guard
  refuses to apply until this file holds exactly these two SealedSecrets.
- Rotation every 90 days: `../bascule-preprod/CRED_CYCLE.md`.

DB access reuses the RO role secret `geo-db-ro-prod` (bascule bundle, role
`geo_db_ro_prod` = `pg_read_all_data`). Network: the pod carries
`role: pra-backup`, selected by the existing netpols of
`../bascule-preprod/netpol-geo-db-backup.k8s-apply.yaml` (k8s lane):
`allow-geo-db-backup-to-postgis` (ingress postgis:5432) and
`allow-geo-db-backup-egress` (DNS, postgis:5432, S3 BHS `54.39.60.208/32:443`;
`sentropic-geo.` and `geo-backup.s3.bhs.io.cloud.ovh.net` resolve to that
address). **No NetworkPolicy change.** Nothing else is reachable, hence
`PUBLIC_HEALTH_URL=""` (the manifest records `code.servedSha: unknown`).

## How it reaches prod (CD)

`.github/workflows/bascule-bundle-cd.yml`, job **`apply-backup`** — same path and
guards as the bascule bundle: owner gate `approve` (attempt-bound) on dispatch
and re-runs, vault Environment `geo-prod-bundle` (main only), permanent SA
`geo-ci-bascule-prod` (`KUBE_CONFIG_DATA_PROD`), positive PROD apiserver
pre-flight, runner = kubectl only. Steps: guard (the SealedSecrets file) →
selftest (fail-closed before any apply) → apply the SealedSecrets → wait Synced
(tolerant) → render the ConfigMap from `backup-daily.cjs` and apply it → apply
the CronJob and assert the live schedule/suspend/concurrency. Triggered on push
to `main` touching `deploy/ci/backup/**`; independent of `apply-bundle` (no
`needs` between them, own concurrency group). A push under `deploy/ci/backup/**`
also re-runs `apply-bundle` (idempotent), as on immo.

Activation order (once):

1. Commit `geo-backup-sealedsecrets.yaml` (TODO above) — in this PR or a
   follow-up; merging without it is safe (the job is not armed, and the guard
   refuses anyway).
2. Merge (the `apply-backup` job stays skipped: not armed yet).
3. k8s lane re-applies `deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml`
   (install-time, cluster-admin): the SA gains name-scoped get/patch/update on
   `geo-backup-writer`, `geo-backup-reader` (sealedsecrets),
   `geo-backup-daily-script` (configmap), `geo-backup-daily` (cronjob).
4. Set the repo variable `BACKUP_DAILY_CD_ENABLED=true`.
5. `workflow_dispatch` of `bascule-bundle-cd` (owner approval; input
   `backup_run_now=true` also starts a first run), or wait for the next change
   under `deploy/ci/backup/`.

## Verification

Every day (any operator, no cluster write):

1. Last Job of `geo-backup-daily` = `Complete`; its log ends with `VERDICT OK`
   (during the seed: `VERDICT PARTIAL`, `docs.pending` decreasing).
2. `manifests/latest.json` → `date` = today (UTC), `status` = `complete`.
3. Integrity of a date D (reader identity): download `pg/D/geo.dump` and
   `pg/D/geo.dump.sha256`, `sha256sum -c` must print `OK`; the value equals
   `manifests/D.json` `pg.sha256`.
4. `pg_restore --list geo.dump` lists the archive.

Wave 2 (not in this PR, as on immo): an automated restore-test job.

## Knobs (CronJob env)

`COPY_CONCURRENCY` (8), `DOCS_COPY_BUDGET_SECONDS` (7200), `DOCS_EXCLUDE_PREFIXES`
(`ops/decommission/20260913/,pmtiles/`), `COPY_MULTIPART_THRESHOLD_BYTES`
(4 GiB, max 5 GiB), `COPY_PART_BYTES` (512 MiB), `MIN_DUMP_BYTES` (65536),
`MIN_DUMP_RATIO` (0.5 from the second run; 0 disables the relative check — after
a legitimate large data cleanup, set it to 0 by PR for one run, then back),
`RETENTION_*` (see `RETENTION.md`), `PURGE_DRY_RUN` (false).

## Differences from the immo job

| Topic | immo #771 | geo | Why |
| --- | --- | --- | --- |
| Names | `radar-backup-*`, ns `radar-immobilier` | `geo-backup-*`, ns `geo` | tenant |
| DB | `radar-postgres`, secret `radar-db-ro-prod` | `geo-postgis.geo.svc`, secret `geo-db-ro-prod` (role `geo_db_ro_prod`) | same as the geo bascule dump |
| Image of `backup` | radar-api digest, `NODE_PATH=/workspace/node_modules` | geo-api digest of `geo-db-backup-prod`, `NODE_PATH=/app/node_modules` | no new image |
| Network | label `app.kubernetes.io/component: db-backup` (ns without egress policy) | label `role: pra-backup` (default-deny ns, netpols by k8s) | existing geo netpols |
| `PUBLIC_HEALTH_URL` | `https://immo.sent-tech.ca/health` | empty | egress netpol allows DNS/postgis/S3 only |
| Source bucket variable | secret key `SOURCE_DOCS_BUCKET` | secret key `SOURCE_BUCKET` | k8s lane key name; the script accepts both and refuses if both are set and differ |
| `EXPECTED_DATABASE` | default `radar` | **required**; names the dump (`geo.dump`) and the formats (`geo-backup-*/v1`) | tenant-agnostic script (with `EXPECTED_DATABASE=radar` it reproduces the immo names) |
| Dump size floor | 1 MiB | 64 KiB (ratio 0.5 from the 2nd run, same) | geo DB size `unknown` (geo-api prod has no PG variable) |
| DB size | — | `pg.databaseSizeBytes` (`pg_database_size`) | answers the open sizing question at the first run |
| Large source objects | CopyObject only | multipart `UploadPartCopy` above 4 GiB, parts pinned to the listed ETag | CopyObject is capped at 5 GiB; geodata objects may exceed it |
| Copy budget | 5400 s | 7200 s | ~71 000 objects to seed |
| Excluded prefixes | none | `ops/decommission/20260913/`, `pmtiles/` | frozen archive (one-time copy) + rebuildable archives |
| One-time archive copy | — | dispatch input `backup_include_archive` | committed path, no ad-hoc command |
| Schedule | 02:23 UTC | 03:23 UTC | staggered |
| Requests | 100m/128Mi + 50m/192Mi | 50m/128Mi + 50m/192Mi | `tenant-quota` of ns geo counts requests and limits |
| Schema version | drizzle migrations from the dump | same parser, `unknown` on geo (no table) | tenant-agnostic |
| SealedSecrets | two files | one file, two documents | committed verbatim as handed over |
| CD job | armed by `BACKUP_DAILY_CD_ENABLED` | same + geo owner gate (`needs: approve`, attempt-bound), vault `geo-prod-bundle`, own concurrency group, guard on the SealedSecrets file, refuses a manual run while one is active | geo CD conventions |
| Docs history | noncurrent 7 d bucket-wide (at #771 time) | noncurrent **190 d** on `docs/`, 7 d on dated prefixes | provisioned that way by the k8s lane |

## Known limits

- **geo DB content and criticality are `unknown`.** The first manifest gives
  the dump size and `pg.databaseSizeBytes`. A dump under 64 KiB is refused
  (exit 2): then decide the floor by PR.
- **Seed**: several nights of `partial` (the PG part is valid from the first
  night).
- **Read of every existing `sentropic-geo` object by the writer**: objects were
  written by several OVH users; the k8s lane reported 11/11 provisioning tests,
  the object-level coverage is confirmed by the first complete seed
  (`docs.failed = 0`). Same for the reader reading writer objects (first
  restore).
- **Object lock + multipart copy on OVH**: `UploadPartCopy` writes carry no body
  (no Content-MD5 needed); behaviour against the OVH object-lock bucket is
  `unverified` until the first object above 4 GiB (none known outside the
  excluded prefixes).
- **Source rewrite between listing and copy**: a single `CopyObject` copies the
  newest content (the inventory records the copy ETag); a multipart copy fails
  (`CopySourceIfMatch`) and is retried the next night.
- **Inventory size**: about 35 MB of JSON per day for ~120 000 listed objects
  (synthetic benchmark: heap ~112 MiB, RSS ~233 MiB → limit 768 Mi).
- **S3 address pin**: the egress netpol allows `54.39.60.208/32` only; if the
  OVH BHS endpoint moves, runs fail (exit 1) until the k8s lane updates the
  netpol (same constraint as `geo-db-backup-prod`).
- Orphan delete-markers (left once the purged noncurrent versions expire) are
  kept unless the bucket gets an `ExpiredObjectDeleteMarker` rule (optional,
  harmless, see `RETENTION.md`).
