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
| `cronjob-backup-daily.yaml` | CronJob `geo-backup-daily` (ns `geo`): `dump` → `backup` (writer) → `purge` (purger) |
| `cronjob-backup-freshness.yaml` | CronJob `geo-backup-freshness` (ns `geo`): daily check of `manifests/latest.json` (reader) |
| `backup-daily.cjs` | Node script, modes `backup` / `purge` / `freshness` (shipped as ConfigMap `geo-backup-daily-script`) |
| `backup-daily.selftest.mjs` | Offline selftest (in-memory versioned S3 fake, per-identity access model, wiring checks), run by CI and by the CD before any apply |
| [`RETENTION.md`](RETENTION.md) | Retention policy and how it is enforced |
| [`RESTORE.md`](RESTORE.md) | Restore a backup of date D (PG + objects) |

No credential is committed here, sealed or not: the three S3 identities live in
the GitHub Environment `geo-prod-bundle` (+ the k8s lane `.env` recovery copy)
and the CD writes them into the cluster — see [Credentials](#credentials).

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
manifests/latest.json        pointer to the newest manifest + latestComplete
                             (newest COMPLETE backup) + partialSince + docsObjects
```

(`docs/` is the mirror prefix required by the bucket lifecycle; the source keys
are kept as they are below it, e.g. `docs/raw/<source>/cas/<sha256>`.)

`manifests/D.json` (format `geo-backup-manifest/v1`) holds: status (`complete` |
`partial` | `incomplete`, below) and verdict (`OK` | `PARTIAL` | `INCOMPLETE`),
`partialReason` (why it is not complete, counts only), start/end times, dump key + sha256 + size + TOC entry count, the
database size (`pg_database_size`), PostgreSQL / PostGIS / pg_dump versions,
globals key + sha256, schema version (`unknown` on geo: no drizzle migrations
table), source counts (objects, bytes, copied, copied by multipart, up to date,
pending, failed, excluded) + inventory key + sha256, and the script sha256 /
image digest that produced it. The DB is dumped first and the source bucket is
listed after, so every object the DB references at dump time is in the
inventory.

| status | meaning | Job |
| --- | --- | --- |
| `complete` | PG + every source object backed up (or excluded), inventory written | Complete, purge runs |
| `partial` | PG complete; source objects still pending (2-hour budget reached, a request past its deadline, SIGTERM) or inventory not written, **no error answer** (resumes next run); `partialReason` says why | Complete (exit 0, verdict `PARTIAL`), purge skipped — after SIGTERM: exit 1, verdict `TERMINATED` |
| `incomplete` | PG complete; source copy **errors** (S3 error answers after the SDK retries, `docs.failed`) or the source step failed as a whole | Failed (exit 4, verdict `INCOMPLETE`), purge skipped |

Same status model and names as the immo job (rhanka/radar-immobilier#779).

## How a run works

Schedule `23 3 * * *` UTC (one hour after the immo backup, off the 04:17 UTC
monthly geo-fetch), `concurrencyPolicy: Forbid`, `activeDeadlineSeconds: 10800`,
`backoffLimit: 1`. One pod, three sequential steps, **three identities**:

1. **initContainer `dump`** — image `postgis/postgis:16-3.4` (the image of the
   postgis StatefulSet). Positive DB assert (`EXPECTED_DATABASE=geo`), DB size,
   `pg_dump -Fc`, `pg_restore --list` (readability: a truncated archive fails
   here), `sha256sum`, globals without passwords (best-effort).
2. **initContainer `backup`** (mode `backup`, identity `geo-backup-writer`,
   **no delete right**) — geo-api image pinned by the **same digest** as
   `geo-db-backup-prod` (Node + `@aws-sdk/client-s3` 3.1068). Guards (bucket
   names, versioning, dump size floor 1 MiB and ≥ 0.5 × the previous dump),
   upload with Content-MD5, **re-read of the whole object and sha256
   comparison**, source guard (refuse on an empty listing or one under 0.5 × the
   previous inventory), source copy (server-side `CopyObject`; multipart
   `UploadPartCopy` above 4 GiB; skip when Size + ETag match or the copy is
   strictly newer than the last source write; concurrency 8; 2-hour budget),
   inventory, manifest, `latest.json`; then, **only when the backup of the day is
   complete**, the retention purge plan (`/work/purge-plan.json`).
3. **container `purge`** (mode `purge`, identity `geo-backup-purger`:
   DeleteObject on `pg/*`, `manifests/*`, `docs-inventory/*` + ListBucket; no
   GET, no PUT, no `docs/`) — re-validates the plan (complete backup, same
   bucket, today's plan, only dated keys of purged dates outside the daily
   window), confirms by LIST that the plan's manifest exists, then puts the
   delete-markers. No plan (backup partial or incomplete) = nothing purged.

Logs are verdict only (counts, backup keys, sha256) — never a source key, a row
or a credential. Last lines: `VERDICT OK|PARTIAL|INCOMPLETE|TERMINATED|OK-PURGE-PLAN-FAILED
date=… status=…` (backup) and `PURGE VERDICT OK|SKIPPED …` (purge).
`OK-PURGE-PLAN-FAILED` is geo-only: geo plans the purge after the manifest (exit 3).

| Exit | Meaning | Retry |
| --- | --- | --- |
| 0 | backup recorded: `complete` (plan written, purge done) **or `partial`** (seed, budget, request deadlines: objects pending, verdict `PARTIAL` in the manifest, no purge) | — (next night resumes) |
| 1 | transient failure before the manifest (DB unreachable, S3 5xx / request deadline, re-read mismatch), or SIGTERM (partial manifest recorded when the PG part was) | once (`backoffLimit: 1`) |
| 2 | refusal: wrong DB/bucket, versioning off, dump size anomaly, source listing anomaly, invalid purge plan — nothing purged | no (`podFailurePolicy`) |
| 3 | purge planning or execution failed after a complete manifest (backup valid) | no |
| 4 | manifest written with `status=incomplete` (source copy errors, or the source step failed as a whole after the PG part was recorded) | no — next night resumes |

`partial` is a recorded state, not a failure: the Job is `Complete`.
**`geo-backup-freshness`** (07:47 UTC, identity `geo-backup-reader`, reads
`manifests/latest.json` only) fails (exit 5, Job `Failed`) when the latest backup
is older than D−1, or when backups have not been `complete` for more than
`FRESHNESS_MAX_PARTIAL_DAYS` (3) days (`partialSince`; `latestComplete` gives
the newest complete one).

### Seed (first runs)

`sentropic-geo` holds ~119 GB / 116 584 objects (k8s lane measurement,
2026-09-26), of which the frozen archive `ops/decommission/20260913/` is
48.94 GB / 45 378 objects (excluded, see below): about **70 GB / 71 000
objects** to seed. The copy is idempotent and resumable: a run that hits the
2-hour budget ends as `partial` (exit 0, verdict `PARTIAL`, no purge) with the
PG backup of the day valid, and the next run copies only what is still pending.
The freshness check tolerates 3 partial days, then fails: if the seed needs
more, add manual runs (below). At the only measured rate (0.41 object/s in series, geo-cond
inventory), 8 workers give ≈ 3.3 objects/s, i.e. ≈ 6 h of copy ≈ 3 nights; the
real server-side rate is `unverified` until the first manifest (`docs.copied`
over the budget). `backup_run_now` (below) adds runs during the day; the CD
refuses it inside the scheduled window (03:13–06:30 UTC) and while another run
is active.

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

## Provisioning (k8s lane — done and tested)

- Bucket `geo-backup` (OVH BHS): versioning ON, object-lock GOVERNANCE default
  retention 7 days, lifecycle: noncurrent versions expire after **7 days** on
  `pg/`, `docs-inventory/`, `manifests/` and after **190 days** on `docs/`;
  incomplete multipart uploads after 1 day (see [`RETENTION.md`](RETENTION.md)).
- `geo-backup-writer` (keys `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `BACKUP_BUCKET`, `SOURCE_BUCKET`): read `sentropic-geo`; on
  `geo-backup` Put/Get/List/multipart. **No delete of any kind** (no
  `DeleteObject`, no `DeleteObjectVersion`, no `BypassGovernanceRetention`).
  Used by the initContainer `backup`.
- `geo-backup-purger` (keys `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `BACKUP_BUCKET`): `DeleteObject` (delete-marker, no
  VersionId) restricted by ARN to `pg/*`, `manifests/*`, `docs-inventory/*`, plus
  ListBucket / GetBucketLocation. No GET, no PUT, no `docs/`. Used by the
  container `purge` only: it decides on the plan handed over by `backup` in the
  same pod and on a LIST, never on a GET.
- `geo-backup-reader` (keys `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `BACKUP_BUCKET`): read-only on `geo-backup` (GetObject incl.
  versionId, ListBucket, ListBucketVersions). Used by `geo-backup-freshness` and
  for restores; never mounted by `geo-backup-daily`.
- The three k8s Secrets above are **pre-created** in ns `geo` by the k8s lane
  (type `Opaque`; mind the ns `geo` Secret quota); their content is written by
  the CD from GitHub (below). No SealedSecret.
- Rotation every 90 days: `../bascule-preprod/CRED_CYCLE.md`.

## Credentials

**Source of truth: the GitHub Environment `geo-prod-bundle` + the `.env`
recovery copy of the k8s lane. No SealedSecret.** `geo-prod-bundle` is the
existing vault of this workflow (deployment branch policy `main` only, no
reviewer; the owner gate stays the `approve` job). The k8s lane fills it;
nothing about these values is committed.

| k8s Secret / key | `geo-backup-writer` | `geo-backup-reader` | `geo-backup-purger` |
| --- | --- | --- | --- |
| `S3_ENDPOINT` | variable `BACKUP_S3_ENDPOINT` (= `https://s3.bhs.io.cloud.ovh.net`) | same | same |
| `S3_REGION` | variable `BACKUP_S3_REGION` (= `bhs`) | same | same |
| `S3_ACCESS_KEY` | secret `GEO_BACKUP_WRITER_ACCESS_KEY` | secret `GEO_BACKUP_READER_ACCESS_KEY` | secret `GEO_BACKUP_PURGER_ACCESS_KEY` |
| `S3_SECRET_KEY` | secret `GEO_BACKUP_WRITER_SECRET_KEY` | secret `GEO_BACKUP_READER_SECRET_KEY` | secret `GEO_BACKUP_PURGER_SECRET_KEY` |
| `BACKUP_BUCKET` | variable `BACKUP_BUCKET` (= `geo-backup`) | same | same |
| `SOURCE_BUCKET` | variable `BACKUP_SOURCE_BUCKET` (= `sentropic-geo`) | — | — |

The step **Write backup Secrets from GitHub** of job `apply-backup` runs at
every CD run, before the ConfigMap and the CronJobs:

1. **Fail-closed guard, before any write**: the 6 secrets and 4 variables are set
   and single-line; access keys match `^[A-Za-z0-9]{16,128}$` and secret keys
   `^[A-Za-z0-9/+=]{16,128}$`; `BACKUP_S3_ENDPOINT` is exactly
   `https://s3.bhs.io.cloud.ovh.net` and `BACKUP_S3_REGION` exactly `bhs` (the
   pinned OVH BHS target); `BACKUP_BUCKET` / `BACKUP_SOURCE_BUCKET` equal the
   `EXPECTED_*` guards of `cronjob-backup-daily.yaml`; the three Secrets exist.
   A failing value is named — never printed — and nothing is applied.
2. For each identity: render the Secret client-side (`kubectl create secret
   generic --dry-run=client`, each value read from a file of a `0700` temp dir —
   never in argv, never echoed; the dir is removed on exit), label it
   `app.kubernetes.io/component: db-backup`. **No partial write**: a
   server-side dry-run of the three PUTs (`kubectl replace --dry-run=server`)
   must pass for all three, then the real `kubectl replace` (GET + PUT) runs.
   The PUT makes the live key set **exactly** the one the CronJobs mount (a stale
   extra key is dropped) and writes no `last-applied-configuration` annotation
   (a client-side `kubectl apply` would copy the credentials into it).
3. The key set returned by the server is compared with the expected one.

Values reach the script through the step `env:` only (never a `${{ }}` inside
`run:`), GitHub masks the secrets, there is no `set -x`; the log carries
names and key names only. The SA `geo-ci-bascule-prod` holds
**get/update on these three Secret names only** — no create, patch, list,
watch or delete on Secrets (`../bascule-preprod/rbac-ci-bascule-prod.yaml`): a
missing Secret is a hard error, never a create.

DB access reuses the RO role secret `geo-db-ro-prod` (bascule bundle, role
`geo_db_ro_prod` = `pg_read_all_data`). Network: the `geo-backup-daily` pod
carries `role: pra-backup`, selected by the existing netpols of
`../bascule-preprod/netpol-geo-db-backup.k8s-apply.yaml` (k8s lane):
`allow-geo-db-backup-to-postgis` (ingress postgis:5432) and
`allow-geo-db-backup-egress` (DNS, postgis:5432, S3 BHS `54.39.60.208/32:443`;
`sentropic-geo.` and `geo-backup.s3.bhs.io.cloud.ovh.net` resolve to that
address). **No NetworkPolicy change.** That egress policy restricts this pod to
those three destinations, hence `PUBLIC_HEALTH_URL=""` (the manifest records
`code.servedSha: unknown`). The namespace default-deny is **ingress only**: the
freshness pod (no `role: pra-backup`, no postgis access) is selected by no
egress policy and reaches S3 as is.

## How it reaches prod (CD)

`.github/workflows/bascule-bundle-cd.yml`, job **`apply-backup`** — same path and
guards as the bascule bundle: owner gate `approve` (attempt-bound) on dispatch
and re-runs, vault Environment `geo-prod-bundle` (main only), permanent SA
`geo-ci-bascule-prod` (`KUBE_CONFIG_DATA_PROD`), positive PROD apiserver
pre-flight, runner = kubectl only. Steps: selftest (fail-closed before any
apply) → write the three Secrets from GitHub ([Credentials](#credentials)) →
render the ConfigMap from `backup-daily.cjs` and apply it → apply both CronJobs
and assert their live schedule/suspend/concurrency.
Triggered on push to `main` touching `deploy/ci/backup/**`; independent of
`apply-bundle` (no `needs` between them, own concurrency group). A push under
`deploy/ci/backup/**` also re-runs `apply-bundle` (idempotent), as on immo. A
`workflow_dispatch` with `backup_run_now=true` **skips `apply-bundle`**, so the
bundle's RO-role Job never competes with the backup pod for CPU (a plain
dispatch or a push touching the bundle still re-applies it; port of
radar-immobilier#773).

Manual runs (`backup_run_now`, optionally `backup_include_archive`) are refused
inside the scheduled window (03:13–06:30 UTC) and while another
`geo-backup-daily` Job is active.

**Capacity during a backup.** Avoid concurrent manual launches during the day
(manual backup runs, one-shot Jobs, bundle re-applies) while a backup runs: on
immo a running backup pod brought the namespace `limits.cpu` to ≈ 2350m / 2500m
and the node to ≈ 97 % of requests. The geo figures during a backup are
`unverified` (not measured). The scheduled 03:23 UTC run is alone by design.

Activation order (once; nothing is committed for the credentials):

1. k8s lane: set the 6 secrets and 4 variables of [Credentials](#credentials)
   in the Environment `geo-prod-bundle` (`gh secret set … --env geo-prod-bundle`,
   `gh variable set … --env geo-prod-bundle`; same values in `.env`).
2. k8s lane: pre-create the three Secrets `geo-backup-writer`,
   `geo-backup-reader`, `geo-backup-purger` in ns `geo` (type `Opaque`, any
   placeholder content — the CD replaces it). If SealedSecret objects of these
   names were ever applied in-cluster, delete them with `--cascade=orphan`
   first, or their owned Secrets are garbage-collected.
3. k8s lane re-applies `deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml`
   (install-time, cluster-admin): the SA gains name-scoped get/update on
   the Secrets `geo-backup-writer`, `geo-backup-reader`, `geo-backup-purger`,
   the ConfigMap `geo-backup-daily-script`, the CronJobs `geo-backup-daily`,
   `geo-backup-freshness`.
4. Set the repo variable `BACKUP_DAILY_CD_ENABLED=true`.
5. `workflow_dispatch` of `bascule-bundle-cd` (owner approval) **without**
   `backup_run_now`: `apply-backup` writes the three Secrets and applies the
   ConfigMap and the CronJobs; its log shows `secret/geo-backup-<id> replaced
   from GitHub — keys: …` for the three. A dispatch with `backup_run_now=true`
   also starts a first run (outside 03:13–06:30 UTC). A freshness run before the
   first backup fails once (no `latest.json` yet): expected.

## Verification

Every day (any operator, no cluster write):

1. Last Job of `geo-backup-freshness` = `Complete` (log `FRESHNESS OK`).
2. Last Job of `geo-backup-daily` = `Complete`; `backup` log ends with
   `VERDICT OK` (during the seed: `VERDICT PARTIAL`, `docs.pending` decreasing)
   and `purge` with `PURGE VERDICT OK` (or `SKIPPED` on a partial day).
3. `manifests/latest.json` → `date` = today (UTC), `status` = `complete`,
   `latestComplete.date` = today.
4. Integrity of a date D (reader identity): download `pg/D/geo.dump` and
   `pg/D/geo.dump.sha256`, `sha256sum -c` must print `OK`; the value equals
   `manifests/D.json` `pg.sha256`; `pg_restore --list geo.dump` lists the archive.

Wave 2 (not in this PR, as on immo): an automated restore-test job.

## Knobs (CronJob env)

`backup`: `COPY_CONCURRENCY` (8), `DOCS_COPY_BUDGET_SECONDS` (7200),
`DOCS_EXCLUDE_PREFIXES` (`ops/decommission/20260913/,pmtiles/`),
`COPY_MULTIPART_THRESHOLD_BYTES` (4 GiB, max 5 GiB), `COPY_PART_BYTES` (512 MiB),
`MIN_DUMP_BYTES` (1 MiB — the prod dump measured 19.4 MB in the logs of
`geo-db-backup-prod-29839615`), `MIN_DUMP_RATIO` (0.5 from the second run),
`MIN_SOURCE_RATIO` (0.5; an empty listing is always refused), `RETENTION_*` (see
`RETENTION.md`). A ratio set to 0 disables its relative check — after a
legitimate large cleanup, set it to 0 by PR for one run, then back.
`purge`: `RETENTION_DAILY_DAYS` (7, re-validation), `PURGE_DRY_RUN` (false).
`freshness`: `FRESHNESS_MAX_AGE_DAYS` (1), `FRESHNESS_MAX_PARTIAL_DAYS` (3).
S3 deadlines (all three modes, set explicitly on `backup`, defaults elsewhere):
`S3_CONNECT_TIMEOUT_MS` (10 000), `S3_REQUEST_TIMEOUT_MS` (120 000),
`S3_META_TIMEOUT_MS` (30 000), `S3_MIN_THROUGHPUT_BYTES_PER_SEC` (8 MiB/s);
`backup` only: `TERMINATION_GRACE_SECONDS` (120, = the pod
`terminationGracePeriodSeconds`). See "S3 request timeouts" below.

## Incident 2026-09-26 — a CopyObject that never answered

Manual run `geo-backup-manual-20260926123119`: last log `docs progress
70000/70440` at 13:58:40Z, then nothing (0 CPU, one TCP connection open to S3).
One server-side `CopyObject` out of 70 440 never answered; the SDK had no
request timeout, so the worker awaited it forever. The 7200 s budget was only
checked **between** two copies, so it could not cut; `activeDeadlineSeconds`
(10 800 s) then killed the Job → `Failed`, **no manifest, no inventory, no
`latest.json` (404), no purge**. The PG dump itself was valid. Root causes:
(1) no per-request deadline, (2) a budget that does not abort in-flight
copies, (3) no handling of SIGTERM, so the kill left nothing recorded.

## S3 request timeouts, budget and SIGTERM

- **Every S3 call has a wall-clock deadline** (`s3send()` in the script),
  retries of the SDK (`maxAttempts` 5) included: `S3_META_TIMEOUT_MS` for
  HEAD / LIST / versioning / delete / small GET; for a copy, a write or a body
  transfer of N bytes, `max(S3_REQUEST_TIMEOUT_MS, N / S3_MIN_THROUGHPUT_BYTES_PER_SEC)`
  (120 s for a small object, 512 s for a 4 GiB copy or part). The deadline is
  enforced twice: an `AbortSignal` handed to the SDK (`send(cmd, { abortSignal })`,
  which aborts the HTTP request and stops the retries) **and** a race on that
  signal, so the run never waits on a request that never answers, whatever
  the SDK version does with the signal.
- **Transport bounds**: when `@smithy/node-http-handler` resolves from
  `NODE_PATH=/app/node_modules` (it is a dependency of `@aws-sdk/client-s3`,
  hoisted by `npm ci` in the geo-api image), the client gets a `NodeHttpHandler`
  with `connectionTimeout` = `S3_CONNECT_TIMEOUT_MS` and `socketTimeout` (idle
  socket) = `S3_REQUEST_TIMEOUT_MS`. Only these two options are used: both are
  honoured by the 2.x–4.x handlers, neither logs a URL (4.x `requestTimeout`
  only warns unless `throwOnRequestTimeout`, and older versions read it as an
  idle timeout). When the module does not resolve, the script logs
  `handler=abort-signal-only` and the per-request deadline above still applies.
  The first log line of each mode states the values and the handler mode.
- **A copy past its deadline** stays `pending` (counted in `docs.timedOut`,
  `partialReason` "N object(s) pending (T timed out)") → `partial`, exit 0,
  retried the next night: no answer is not an error answer. **A copy answered
  by an S3 error** (after the SDK retries) is `failed` (`docs.failed`, inventory
  `state: failed`) → `incomplete`, exit 4. Either way only that object is
  affected; the other workers go on. Same rule as immo #779.
- **The budget really cuts**: at `DOCS_COPY_BUDGET_SECONDS` a timer aborts every
  copy in flight and no worker starts a new one. Interrupted copies stay
  `pending` (`docs.interrupted`), `docs.stopReason: budget`. The run then writes
  the inventory, the manifest (`partial`, `partialReason`), `latest.json`
  (`partialSince`, `latestComplete` unchanged, `partialReason`) and the
  verdict, and exits 0 (no purge).
- **SIGTERM** (kubelet on `activeDeadlineSeconds` or a node drain; SIGKILL
  follows after `terminationGracePeriodSeconds`, 120 s): during the copy, same
  as the budget with `docs.stopReason: terminated`, verdict `TERMINATED`,
  exit 1; each final write is capped to the grace left (minus 10 s). An
  inventory of 116 000 objects is ~26 MiB, built in < 1 s and uploaded in ~3 s at
  the 8 MiB/s floor (selftest measure). The real duration is logged by every
  run: `final writes ms=… inventory.bytes=…`. SIGTERM before the PG part is
  recorded aborts the run (exit 1, nothing written: there is no valid backup to
  record).
- **Never `complete` with an object missing**: `complete` needs 0 pending, 0
  failed, every listed object backed up or excluded, and the inventory written.
  A final write that fails (inventory) leaves the backup `partial`
  (`inventory not written (...)`).
- **Budget vs deadline** (selftest, static check): 1800 s (dump + PG upload
  margin) + 7200 s budget + 512 s (longest request in flight) + 3 × 120 s (final
  writes) + 120 s grace = 9992 s < `activeDeadlineSeconds` 10 800 s. The normal
  end is the budget, never the kill.

## Differences from the immo job

| Topic | immo #771 | geo | Why |
| --- | --- | --- | --- |
| Names | `radar-backup-*`, ns `radar-immobilier` | `geo-backup-*`, ns `geo` | tenant |
| DB | `radar-postgres`, secret `radar-db-ro-prod` | `geo-postgis.geo.svc`, secret `geo-db-ro-prod` (role `geo_db_ro_prod`) | same as the geo bascule dump |
| Image of `backup` | radar-api digest, `NODE_PATH=/workspace/node_modules` | geo-api digest of `geo-db-backup-prod`, `NODE_PATH=/app/node_modules` | no new image |
| Network | label `app.kubernetes.io/component: db-backup` (ns without egress policy) | label `role: pra-backup` (ns default-deny ingress; egress policy of these netpols) | existing geo netpols |
| `PUBLIC_HEALTH_URL` | `https://immo.sent-tech.ca/health` | empty | the egress policy allows DNS/postgis/S3 only |
| Source bucket variable | secret key `SOURCE_DOCS_BUCKET` | secret key `SOURCE_BUCKET` | k8s lane key name; the script accepts both and refuses if both are set and differ |
| `EXPECTED_DATABASE` | default `radar` | **required**; names the dump (`geo.dump`) and the formats (`geo-backup-*/v1`) | tenant-agnostic script (with `EXPECTED_DATABASE=radar` it reproduces the immo names) |
| DB size | — | `pg.databaseSizeBytes` (`pg_database_size`) | recorded at each run |
| Large source objects | CopyObject only | multipart `UploadPartCopy` above 4 GiB, parts pinned to the listed ETag | CopyObject is capped at 5 GiB; geodata objects may exceed it |
| Copy budget | 5400 s | 7200 s | ~71 000 objects to seed |
| Excluded prefixes | none | `ops/decommission/20260913/`, `pmtiles/` | frozen archive (one-time copy) + rebuildable archives |
| One-time archive copy | — | dispatch input `backup_include_archive` | committed path, no ad-hoc command |
| Schedule | 02:23 UTC | 03:23 UTC | staggered |
| Requests | 100m/128Mi + 50m/192Mi | 50m/128Mi + 50m/192Mi | `tenant-quota` of ns geo counts requests and limits |
| Schema version | drizzle migrations from the dump | same parser, `unknown` on geo (no table) | tenant-agnostic |
| Credentials | GitHub Environment `radar-backup-prod` → Secrets written by the CD | GitHub Environment `geo-prod-bundle` (the existing vault) → Secrets written by the CD | owner rule: no SealedSecret committed; geo already had a main-only vault for this job |
| CD job | armed by `BACKUP_DAILY_CD_ENABLED` | same + geo owner gate (`needs: approve`, attempt-bound), vault `geo-prod-bundle`, own concurrency group, manual run refused in the 03:13–06:30 window or while one is active | geo CD conventions |
| Docs history | noncurrent 7 d bucket-wide (at #771 time) | noncurrent **190 d** on `docs/`, 7 d on dated prefixes | provisioned that way by the k8s lane |

The geo-cond review items (writer without delete + separate purger, `partial` =
exit 0 + freshness check + `latestComplete`, source listing guard, 1 MiB dump
floor, strict `upToDate`) are applied here and mirrored on immo #771.

## Known limits

- **geo DB content and criticality**: the prod dump measured 19.4 MB
  (`geo-db-backup-prod-29839615`); each manifest records the dump size and
  `pg.databaseSizeBytes`.
- **Seed**: several nights of `partial` (the PG part is valid from the first
  night, nothing is purged meanwhile); the freshness check fails after 3 partial
  days — add manual runs if the seed needs more.
- **Read of every existing `sentropic-geo` object by the writer**: objects were
  written by several OVH users; the object-level coverage is confirmed by the
  first complete seed (`docs.failed = 0`). Same for the reader reading writer
  objects (first restore).
- **Object lock + multipart copy on OVH**: `UploadPartCopy` writes carry no body
  (no Content-MD5 needed); behaviour against the OVH object-lock bucket is
  `unverified` until the first object above 4 GiB (none known outside the
  excluded prefixes).
- **Source rewrite between listing and copy**: a single `CopyObject` copies the
  newest content (the inventory records the copy ETag); a multipart copy fails
  (`CopySourceIfMatch`) and is retried the next night.
- **Purge trust**: the purger cannot read objects; it relies on the plan written
  by `backup` in the same pod (re-validated) and on a LIST of the plan's
  manifest. Its ARN scope keeps `docs/` out of reach whatever the plan says;
  `manifests/latest.json` is excluded by the plan validation (not by the ARN).
- **Inventory size**: about 35 MB of JSON per day for ~120 000 listed objects
  (synthetic benchmark: heap ~112 MiB, RSS ~233 MiB → limit 768 Mi).
- **S3 address pin**: the egress netpol allows `54.39.60.208/32` only; if the
  OVH BHS endpoint moves, runs fail (exit 1) until the k8s lane updates the
  netpol (same constraint as `geo-db-backup-prod`).
- Orphan delete-markers (left once the purged noncurrent versions expire) are
  kept unless the bucket gets an `ExpiredObjectDeleteMarker` rule (optional,
  harmless, see `RETENTION.md`).
