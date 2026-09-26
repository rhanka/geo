# Restore a backup of date D

All reads use the **reader** identity `geo-backup-reader` (keys `S3_ENDPOINT`,
`S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `BACKUP_BUCKET`): GetObject (also
with a version id), ListBucket, ListBucketVersions. It cannot write or delete.
Never restore in place over production: restore into an empty database / an
empty bucket or prefix, verify, then switch.

Examples use `s5cmd` (>= 2.2, native binary of the validated stack) on an
operator workstation. Any S3 client works; do not add Python tooling to jobs.

```sh
export AWS_ACCESS_KEY_ID=<reader S3_ACCESS_KEY> AWS_SECRET_ACCESS_KEY=<reader S3_SECRET_KEY> AWS_REGION=bhs
S5="s5cmd --endpoint-url https://s3.bhs.io.cloud.ovh.net"
B=s3://geo-backup
$S5 cat $B/manifests/latest.json      # newest backup: date, status, manifestKey, pgSha256,
                                      # latestComplete (newest COMPLETE backup), partialSince
D=2026-09-27
```

## 0. Pick and check the manifest

```sh
$S5 cp $B/manifests/$D.json manifest.json
```

Use a manifest with `status: "complete"` (`latest.json` `latestComplete` points
to the newest one). `status: "partial"` (verdict `PARTIAL`) or `"incomplete"`
(verdict `INCOMPLETE`) means the PG part is valid but some source objects were
not in the backup that day (`docs.pending` > 0 — expected during the seed — or
`docs.failed` > 0; `partialReason` says why). The manifest
gives the dump key + sha256, the database size, the PostgreSQL / PostGIS
versions and the inventory key.

A date purged by the retention less than 7 days ago is still readable by version
id: `$S5 ls --all-versions "$B/pg/$D/*"` then `$S5 cp --version-id <v> …`.

## 1. PostgreSQL

```sh
$S5 cp $B/pg/$D/geo.dump geo.dump
$S5 cp $B/pg/$D/geo.dump.sha256 geo.dump.sha256
sha256sum -c geo.dump.sha256            # must print: geo.dump: OK (and equal manifest pg.sha256)
pg_restore --list geo.dump | head       # pg_restore >= 16 (dump made by pg_dump 16)
```

Restore into an EMPTY database on a PostgreSQL 16 + PostGIS server (same major
versions as `pg.serverVersion` / `pg.postgisVersion`; `postgis/postgis:16-3.4`):

```sh
createdb -h <host> -U <admin> geo_restore
pg_restore -h <host> -U <admin> -d geo_restore --no-owner --no-privileges --exit-on-error geo.dump
```

The dump carries `CREATE EXTENSION IF NOT EXISTS postgis`; ownership and grants
come from the platform bootstrap, not from the dump (`--no-owner
--no-privileges`). `pg/$D/globals.sql` (roles, memberships, tablespaces, **no
passwords**) documents the roles that existed at D; set passwords from the
current secrets if roles must be recreated. The RO role `geo_db_ro_prod` is
re-created by the bascule bundle Job `geo-db-ro-role-provision`.

Verify: `select pg_database_size(current_database())` is of the order of
`pg.databaseSizeBytes` (not byte-equal: physical size), and table row counts
match the source when it is still available.

## 2. Source objects (state of `sentropic-geo` at D)

`docs-inventory/$D.json` lists every source object at D: `key`, `size`, source
`etag`, `lastModified`, and for `state: "backed-up"` the `backupEtag` and, when
known, the `versionId` of the backup copy (`docs/<key>`). Objects in state
`pending`, `failed` or `excluded` are not in the backup of D (`excluded` =
`pmtiles/`, rebuilt from `normalized/`, or the archive before its one-time
copy).

For each `backed-up` entry:

1. Version to read: `versionId` when present; otherwise
   `$S5 ls --all-versions --etag "$B/docs/<key>"` and take the newest version
   whose ETag equals `backupEtag` and whose date is not after the inventory
   `createdAt`.
2. `$S5 cp --version-id <v> "$B/docs/<key>" <local>` and write it to the target
   bucket under `<key>` (with the target's own writer identity).
3. Check the size equals `size`.

Restore into an empty bucket (or prefix): objects created after D are then
naturally absent. The previous content of a key rewritten after D (e.g. a
`normalized/` restamp) is kept 190 days as a noncurrent version of
`docs/<key>` (see `RETENTION.md`).

## 3. After a restore

Record the restored date, the manifest sha256 (`manifests/latest.json`
`manifestSha256` when D is the latest) and the verification results in the
incident / track entry.
