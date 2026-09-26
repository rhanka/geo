# Retention — `geo-backup`

Policy (same as immo): **daily 7 days, weekly 4 weeks, monthly 6 months.**

S3 lifecycle rules filter by prefix/tag and age, not by weekday or day of month,
so the weekly and monthly tiers cannot be expressed by lifecycle alone. The
enforcement is split in two:

| Layer | Owner | What it does |
| --- | --- | --- |
| Object lock GOVERNANCE, default retention 7 days | k8s lane (bucket) | Every object version is undeletable for 7 days after it is written. |
| Lifecycle | k8s lane (bucket) | Noncurrent versions expire 7 days after they become noncurrent on `pg/`, `docs-inventory/`, `manifests/`, and 190 days after on `docs/`; incomplete multipart uploads after 1 day. |
| Dated-folder purge | `geo-backup-daily` (identity `geo-backup-writer`) | After the manifest of the day is written, puts a **delete-marker** (DeleteObject without VersionId) on every dated object outside the policy. |

The job never deletes a version. A purged object becomes a noncurrent version,
stays readable by version id for 7 more days (restore grace), then the lifecycle
removes it (object lock has long ended by then: the lock counts from the write,
the purge happens at the earliest 7 days after the write).

## What is kept

Dated objects: `pg/<D>/*`, `docs-inventory/<D>.json`, `manifests/<D>.json`. A date
is a **backup** when its manifest exists. At each run (today = T, UTC):

| Reason | Kept dates |
| --- | --- |
| daily | every date with `T - D < 7` days (including unfinished days, for diagnosis) |
| weekly | the latest backup of each ISO week (Monday–Sunday), i.e. **the Sunday** when it ran, if `T - D < 28` days |
| monthly | the earliest backup of each month, i.e. **the 1st** when it ran, for the current month and the 5 previous ones |
| min-keep | the 7 newest backups, whatever their age (an outage never shrinks the history to one point) |
| future | dates after T (clock skew) |

Everything else is purged. If a Sunday (or a 1st) had no backup, the latest day
of that week (or the earliest day of that month) takes its place; that day is
still inside the daily window when its week ends, so it is never purged too
early. Steady state: at most 16 visible dated backups (7 daily + 3 older
Sundays + 6 monthly, fewer when they overlap), plus the purged ones during their
7-day grace.

A `partial` day (seed, or objects failed that day) has a manifest, so it counts
as a backup: its PG dump is complete, only some source objects were not yet in
`docs/` that day (listed `pending`/`failed` in its inventory).

Never purged: `docs/` (the mirror), `manifests/latest.json`, any key that does not
match the dated layout, and anything at all when the manifest of today is not
listed (the purge refuses and the run exits 3). If the job stops running,
nothing is purged: the failure mode is accumulation, never loss.

## Timeline of one daily dump

| Day | Event |
| --- | --- |
| D | written (`pg/D/geo.dump`), locked until D+7 |
| D+7 | leaves the daily window → delete-marker (unless Sunday / 1st / min-keep) |
| D+7 … D+14 | noncurrent, readable by version id (reader identity) |
| ≈ D+14 | expired by the lifecycle |

A Sunday is purged at D+28 (expired ≈ D+35); a 1st of month when it becomes
6 months old (expired 7 days later).

## Source objects history (`docs/`)

`docs/` holds the current copy of every copied source object (never purged).
When a source object is rewritten under the same key (typically `normalized/`
restamps), the next run copies it again and the previous backup content becomes
a noncurrent version, kept **190 days** by the `docs/` lifecycle rule — longer
than the 6-month monthly tier, so the content of a rewritten object is
restorable at every retained date. Write-once objects (`raw/` CAS PDFs,
`capture/_runs/` manifests) are copied once. The storage cost of `docs/` grows
with the rewrite rate of the included prefixes (that is why `pmtiles/` is
excluded, see `README.md`); watch the size of `geo-backup` after the first
month.

## Bucket configuration (as provisioned by the k8s lane, S3 terms)

```json
{ "ObjectLockEnabled": "Enabled",
  "Rule": { "DefaultRetention": { "Mode": "GOVERNANCE", "Days": 7 } } }
```

```json
{ "Rules": [
  { "ID": "dated-noncurrent-7d", "Status": "Enabled", "Filter": { "Prefix": "pg/" },
    "NoncurrentVersionExpiration": { "NoncurrentDays": 7 } },
  { "ID": "inventory-noncurrent-7d", "Status": "Enabled", "Filter": { "Prefix": "docs-inventory/" },
    "NoncurrentVersionExpiration": { "NoncurrentDays": 7 } },
  { "ID": "manifests-noncurrent-7d", "Status": "Enabled", "Filter": { "Prefix": "manifests/" },
    "NoncurrentVersionExpiration": { "NoncurrentDays": 7 } },
  { "ID": "docs-noncurrent-190d", "Status": "Enabled", "Filter": { "Prefix": "docs/" },
    "NoncurrentVersionExpiration": { "NoncurrentDays": 190 } },
  { "ID": "abort-incomplete-mpu-1d", "Status": "Enabled", "Filter": {},
    "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 } }
] }
```

(Rule IDs are illustrative; the effect is what the job relies on.) Optional
addition for the k8s lane: an `{ "Expiration": { "ExpiredObjectDeleteMarker": true } }`
rule on the dated prefixes, to drop the delete-markers left once the purged
versions have expired (harmless if absent: a few markers per purged date).

## Knobs (CronJob env, defaults = policy)

`RETENTION_DAILY_DAYS=7`, `RETENTION_WEEKLY_WEEKS=4`, `RETENTION_MONTHLY_MONTHS=6`,
`RETENTION_MIN_KEEP=7`, `PURGE_DRY_RUN=false` (true = compute and log the plan,
put no delete-marker). The algorithm is `planRetention` in `backup-daily.cjs`,
covered by `backup-daily.selftest.mjs` (500-day simulation, missing Sunday,
outage, unfinished days, boundaries).
