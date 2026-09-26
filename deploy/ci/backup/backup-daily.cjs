#!/usr/bin/env node
'use strict';
// =============================================================================
// backup-daily.cjs — DAILY PROD BACKUP of geo (PostgreSQL + source bucket S3).
//
// Port of the immo script (rhanka/radar-immobilier#771,
// deploy/ci/backup/backup-daily.cjs): same flow, same layout, same retention.
// Tenant constants are lifted into env so the file is tenant-agnostic (see
// README.md "Differences from the immo job"): EXPECTED_DATABASE (required)
// names the dump (`<db>.dump`) and the record formats (`<db>-backup-*/v1`).
//
// THREE MODES (argv[2]), three identities, mounted from the ConfigMap
// `geo-backup-daily-script` that the CD renders from THIS file. Image = geo-api
// (Node + @aws-sdk/client-s3), the digest already pinned by the bascule dump
// CronJob geo-db-backup-prod: 0 python, 0 new image.
//   backup     initContainer `backup` of CronJob geo-backup-daily, identity
//              geo-backup-writer (NO delete right). Uploads, copies, writes the
//              manifest; when (and only when) the backup of the day is complete,
//              writes the retention purge plan to WORK_DIR/purge-plan.json.
//   purge      container `purge` of the same pod (runs after `backup` succeeded),
//              identity geo-backup-purger (DeleteObject on the dated prefixes +
//              ListBucket, no GET/PUT). Re-validates the plan, confirms by LIST
//              that its manifest exists, puts the delete-markers. No plan =
//              nothing to do.
//   freshness  CronJob geo-backup-freshness, identity geo-backup-reader: reads
//              manifests/latest.json, fails when the backup is stale or not
//              complete for too long.
//
// The `dump` initContainer (postgis image: pg_dump / pg_restore / pg_dumpall)
// ran first and left in WORK_DIR (<db> = EXPECTED_DATABASE):
//   <db>.dump             pg_dump -Fc of the prod DB (RO role)
//   <db>.dump.sha256      `sha256sum` line of the dump (coreutils)
//   dump.env              KEY=VALUE facts (DATE, versions, DB size, TOC count, globals)
//   migrations.sql        pg_restore -a of drizzle.__drizzle_migrations (from the
//                         dump; empty when the DB has no such table)
//   globals.sql(.sha256)  pg_dumpall --globals-only --no-role-passwords (best-effort)
//
// One run = one coherent backup of day D (UTC) in s3://$BACKUP_BUCKET:
//   pg/D/<db>.dump (+ .sha256)           dump, re-read after upload (sha256)
//   pg/D/globals.sql (+ .sha256)         roles/tablespaces, no passwords
//   docs/<key>                           incremental server-side mirror of
//                                        $SOURCE_BUCKET (bucket versioning
//                                        keeps prior contents)
//   docs-inventory/D.json                source state at D (key, size, ETag) +
//                                        the backup ETag/version that holds it
//   manifests/D.json                     THE backup record of day D
//   manifests/latest.json                pointer to the newest manifest (+ the
//                                        latest COMPLETE one, partialSince)
// then the retention purge (RETENTION.md, mode `purge`): delete-markers ONLY
// (DeleteObject without VersionId) on dated objects outside the
// daily/weekly/monthly policy, only after a COMPLETE backup of the day.
//
// Order = DB first, source objects second: every object the DB references at
// dump time is already listed when the docs step runs.
//
// LOGS = verdict only: counts, backup keys, sha256. Never a source key, never a
// row, never a credential. SDK errors are reported as name/http-status.
//
// EXIT CODES (podFailurePolicy in the CronJob maps 2/3/4 to FailJob, no retry):
//   0 backup recorded: status=complete (purge plan written) OR status=partial
//     (seed / objects pending or failed: verdict PARTIAL in the manifest, no
//     purge). `partial` is not a failure; geo-backup-freshness watches it.
//   1 retryable failure before the manifest (network, S3 5xx, re-read mismatch)
//   2 integrity/config refusal (bucket guard, versioning off, dump size anomaly,
//     source listing anomaly, invalid purge plan) — nothing purged
//   3 purge planning/execution failed AFTER a complete manifest (backup valid)
//   4 source step failed as a whole (listing / unexpected error) after the PG
//     part was recorded (manifest status=partial, docs.status=failed)
//   5 (freshness) latest backup stale or not complete for too long
// =============================================================================

// CommonJS on purpose: the SDK is resolved through NODE_PATH (/app/node_modules
// of the geo-api image), which only require() honours (ESM import ignores NODE_PATH).
// (The immo copy carries two ESLint directives for its typescript-eslint config; geo
// lints this file with the plain recommended rules, where they would be errors.)
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const process = require('node:process');
const console = require('node:console');
const { Buffer } = require('node:buffer');

const EXIT = Object.freeze({ OK: 0, RETRYABLE: 1, INTEGRITY: 2, PURGE_FAILED: 3, DOCS_FAILED: 4, NOT_FRESH: 5 });
// Written by mode `backup` (writer) in the shared emptyDir, read by mode `purge`.
const PURGE_PLAN_FILE = 'purge-plan.json';

class BackupError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = 'BackupError';
    this.exitCode = exitCode;
  }
}

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const DAY_MS = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// EXPECTED_DATABASE is also a file/key name: PostgreSQL identifier charset only.
const DB_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;

const LAYOUT = Object.freeze({
  docsPrefix: 'docs/',
  datedPrefixes: Object.freeze(['pg/', 'docs-inventory/', 'manifests/']),
  latestKey: 'manifests/latest.json',
});

// ── dates ────────────────────────────────────────────────────────────────────
function dayNumber(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw new Error('invalid date');
  const ms = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new Error('invalid date');
  return Math.round(ms / DAY_MS);
}
function isValidDate(date) {
  try { dayNumber(date); return true; } catch { return false; }
}
// ISO week (Monday..Sunday). Day 0 = 1970-01-01, a Thursday.
function isoWeekIndex(date) { return Math.floor((dayNumber(date) + 3) / 7); }
function monthIndex(date) { dayNumber(date); return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1; }
function weekdayUtc(date) { return new Date(dayNumber(date) * DAY_MS).getUTCDay(); } // 0 = Sunday

// ── key layout ───────────────────────────────────────────────────────────────
function keysFor(date, db) {
  if (!DB_NAME_RE.test(String(db || ''))) throw new Error('invalid database name');
  return {
    dump: `pg/${date}/${db}.dump`,
    dumpSha: `pg/${date}/${db}.dump.sha256`,
    globals: `pg/${date}/globals.sql`,
    globalsSha: `pg/${date}/globals.sql.sha256`,
    inventory: `docs-inventory/${date}.json`,
    manifest: `manifests/${date}.json`,
  };
}
// Dated backup objects the retention purge may touch. Anything else (docs/,
// manifests/latest.json, unknown names) → null → never purged.
function classifyKey(key) {
  let m = /^pg\/(\d{4}-\d{2}-\d{2})\/[^/]+$/.exec(key);
  if (m && isValidDate(m[1])) return { kind: 'pg', date: m[1] };
  m = /^docs-inventory\/(\d{4}-\d{2}-\d{2})\.json$/.exec(key);
  if (m && isValidDate(m[1])) return { kind: 'inventory', date: m[1] };
  m = /^manifests\/(\d{4}-\d{2}-\d{2})\.json$/.exec(key);
  if (m && isValidDate(m[1])) return { kind: 'manifest', date: m[1] };
  return null;
}

// ── retention (see RETENTION.md) ─────────────────────────────────────────────
// dates         every date that still has a dated object (complete or not)
// completeDates dates that have a manifest (= a recorded backup)
// Kept:
//   daily    every date younger than dailyDays (incl. unfinished days, for diagnosis)
//   weekly   the LATEST complete backup of each ISO week (= the Sunday when it
//            ran) younger than weeklyWeeks*7 days
//   monthly  the EARLIEST complete backup of each month (= the 1st when it ran)
//            for the current month and the monthlyMonths-1 previous ones
//   min-keep the minKeep newest complete backups whatever their age (an outage
//            never shrinks the history to a single point)
//   future   dates after today (clock skew) are never purged
function planRetention({ today, dates, completeDates, dailyDays = 7, weeklyWeeks = 4, monthlyMonths = 6, minKeep = 7 }) {
  const t = dayNumber(today);
  const complete = [...new Set(completeDates || [])].filter(isValidDate).sort();
  const all = [...new Set([...(dates || []), ...complete])].filter(isValidDate).sort();
  const reasons = new Map();
  const add = (d, r) => { if (!reasons.has(d)) reasons.set(d, []); if (!reasons.get(d).includes(r)) reasons.get(d).push(r); };
  for (const d of all) {
    const age = t - dayNumber(d);
    if (age < 0) add(d, 'future');
    else if (age < dailyDays) add(d, 'daily');
  }
  const latestOfWeek = new Map();
  for (const d of complete) latestOfWeek.set(isoWeekIndex(d), d); // ascending → last write = latest
  for (const d of latestOfWeek.values()) {
    const age = t - dayNumber(d);
    if (age >= 0 && age < weeklyWeeks * 7) add(d, 'weekly');
  }
  const earliestOfMonth = new Map();
  for (const d of complete) if (!earliestOfMonth.has(monthIndex(d))) earliestOfMonth.set(monthIndex(d), d);
  const tm = monthIndex(today);
  for (const d of earliestOfMonth.values()) {
    const dm = tm - monthIndex(d);
    if (dm >= 0 && dm < monthlyMonths) add(d, 'monthly');
  }
  for (const d of complete.slice(-Math.max(0, minKeep))) add(d, 'min-keep');
  const keep = all.filter((d) => reasons.has(d));
  const purge = all.filter((d) => !reasons.has(d));
  return { keep, purge, reasons: Object.fromEntries([...reasons.entries()].sort()) };
}

// ── small parsers ────────────────────────────────────────────────────────────
function parseEnvFile(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.replace(/\r$/, ''));
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
function parseSha256Line(text) {
  const m = /^([0-9a-f]{64})\s+\*?(\S.*)$/.exec(String(text || '').trim());
  return m ? { sha256: m[1], name: m[2].trim() } : null;
}
// Rows of drizzle.__drizzle_migrations as emitted by `pg_restore --data-only`
// (COPY ... FROM stdin; block). Returns null when the table is absent.
function parseMigrationsCopy(text) {
  const lines = String(text || '').split('\n');
  const start = lines.findIndex((l) => /^COPY\s+"?drizzle"?\."?__drizzle_migrations"?\s*\(/.test(l));
  if (start < 0) return null;
  const cols = /\(([^)]*)\)/.exec(lines[start])[1].split(',').map((c) => c.trim().replace(/"/g, ''));
  const rows = [];
  for (let i = start + 1; i < lines.length && lines[i] !== '\\.'; i++) {
    if (!lines[i]) continue;
    const vals = lines[i].split('\t');
    const row = {};
    cols.forEach((c, j) => { row[c] = vals[j] === undefined || vals[j] === '\\N' ? null : vals[j]; });
    rows.push(row);
  }
  let last = null;
  for (const r of rows) if (!last || Number(r.id) > Number(last.id)) last = r;
  return {
    migrationsApplied: rows.length,
    lastMigration: last ? { id: Number(last.id), hash: last.hash, createdAt: last.created_at } : null,
  };
}
function resolveMigrationTag(createdAt, journal) {
  if (createdAt === null || createdAt === undefined || !journal || !Array.isArray(journal.entries)) return null;
  const e = journal.entries.find((x) => String(x.when) === String(createdAt));
  return e && typeof e.tag === 'string' ? e.tag : null;
}
function parsePrefixes(csv) {
  return String(csv || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function withScheme(endpoint) {
  const e = String(endpoint || '').trim();
  if (!e) return '';
  return /^https?:\/\//i.test(e) ? e : 'https://' + e;
}
function encodeKey(k) { return encodeURIComponent(k).replace(/%2F/g, '/'); }
function errName(e) {
  const status = e && e.$metadata && e.$metadata.httpStatusCode;
  return `${(e && (e.name || e.Code || e.code)) || 'Error'}${status ? '/' + status : ''}`;
}
function isAccessDenied(e) {
  const status = e && e.$metadata && e.$metadata.httpStatusCode;
  return status === 403 || (e && (e.name === 'AccessDenied' || e.Code === 'AccessDenied'));
}
function isNotFound(e) {
  const status = e && e.$metadata && e.$metadata.httpStatusCode;
  return status === 404 || (e && ['NoSuchKey', 'NotFound'].includes(e.name));
}

// Absolute floor + relative drop versus the previous backup. Both refuse (exit 2).
function checkDumpSize({ size, previousSize, minBytes, minRatio }) {
  if (!(size >= minBytes)) return { ok: false, reason: `dump size ${size} < MIN_DUMP_BYTES ${minBytes}` };
  if (minRatio > 0 && Number(previousSize) > 0 && size < previousSize * minRatio) {
    return { ok: false, reason: `dump size ${size} < ${minRatio} x previous ${previousSize}` };
  }
  return { ok: true, reason: null };
}
// Source listing guard (same idea as the dump size guard): an empty listing, or
// one that dropped under minRatio x the previous inventory, is refused (exit 2)
// before any copy, manifest or purge — a wrong/emptied bucket never becomes
// "the backup of the day".
function checkSourceCount({ count, previousCount, minRatio }) {
  if (!(count > 0)) return { ok: false, reason: 'source listing is empty' };
  if (minRatio > 0 && Number(previousCount) > 0 && count < previousCount * minRatio) {
    return { ok: false, reason: `source objects ${count} < ${minRatio} x previous inventory ${previousCount}` };
  }
  return { ok: true, reason: null };
}

// ── docs planning ────────────────────────────────────────────────────────────
// Up to date in the backup = same Size AND (same ETag OR backup copy written
// strictly after the last source write). ETag alone is not enough: a server-side
// copy of a multipart source gets a different ETag. LastModified catches a source
// object rewritten under the same name (its LastModified moves past the copy);
// strict `>` because LastModified has a 1-second granularity: a rewrite in the
// same second as the copy is recopied rather than assumed identical.
function upToDate(src, dst) {
  return !!dst && Number(dst.Size) === Number(src.Size) &&
    (dst.ETag === src.ETag ||
      (!!dst.LastModified && !!src.LastModified && new Date(dst.LastModified).getTime() > new Date(src.LastModified).getTime()));
}
function planDocs(srcObjs, dstIndex, excludePrefixes) {
  const fresh = []; const todo = []; const excluded = [];
  for (const o of srcObjs) {
    if (upToDate(o, dstIndex.get(o.Key))) fresh.push(o);
    else if (excludePrefixes.some((p) => o.Key.startsWith(p))) excluded.push(o);
    else todo.push(o);
  }
  return { fresh, todo, excluded };
}
// Record formats are named after the tenant database: `<db>-backup-<kind>/v1`
// (radar-backup-manifest/v1 on immo, geo-backup-manifest/v1 here).
function formatId(db, kind) { return `${db}-backup-${kind}/v1`; }
function buildInventory({ db, date, createdAt, sourceBucket, backupBucket, excludePrefixes, versionIds, srcObjs, dstIndex, copied, failed }) {
  const objects = [...srcObjs].sort((a, b) => (a.Key < b.Key ? -1 : a.Key > b.Key ? 1 : 0)).map((o) => {
    const base = {
      key: o.Key,
      size: Number(o.Size),
      etag: o.ETag || null,
      lastModified: o.LastModified ? new Date(o.LastModified).toISOString() : null,
    };
    const c = copied.get(o.Key);
    if (c) return { ...base, state: 'backed-up', backupEtag: c.etag, versionId: c.versionId };
    const d = dstIndex.get(o.Key);
    if (upToDate(o, d)) return { ...base, state: 'backed-up', backupEtag: d.ETag || null, versionId: d.VersionId || null };
    const state = failed.has(o.Key) ? 'failed' : excludePrefixes.some((p) => o.Key.startsWith(p)) ? 'excluded' : 'pending';
    return { ...base, state, backupEtag: null, versionId: null };
  });
  const counts = { objects: objects.length, totalBytes: 0, backedUp: 0, pending: 0, failed: 0, excluded: 0 };
  for (const o of objects) {
    counts.totalBytes += o.size;
    if (o.state === 'backed-up') counts.backedUp += 1;
    else counts[o.state] += 1;
  }
  return {
    format: formatId(db, 'docs-inventory'),
    date,
    createdAt,
    sourceBucket,
    backupBucket,
    backupPrefix: LAYOUT.docsPrefix,
    excludedPrefixes: excludePrefixes,
    versionIds,
    counts,
    objects,
  };
}

// ── config ───────────────────────────────────────────────────────────────────
function envReaders(env) {
  const req = (name) => {
    const v = String(env[name] || '').trim();
    if (!v) throw new BackupError(EXIT.INTEGRITY, `missing ${name}`);
    return v;
  };
  const num = (name, def, { min = 0, integer = true } = {}) => {
    const raw = env[name];
    if (raw === undefined || String(raw).trim() === '') return def;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < min || (integer && !Number.isInteger(v))) throw new BackupError(EXIT.INTEGRITY, `invalid ${name}`);
    return v;
  };
  return { req, num };
}
// S3 access common to the three identities (writer, purger, reader).
function readS3Config(env) {
  const { req } = envReaders(env);
  return {
    endpoint: withScheme(req('S3_ENDPOINT')),
    region: req('S3_REGION'),
    forcePathStyle: String(env.S3_FORCE_PATH_STYLE || 'false').trim() === 'true',
    accessKeyId: req('S3_ACCESS_KEY'),
    secretAccessKey: req('S3_SECRET_KEY'),
    backupBucket: req('BACKUP_BUCKET'),
    expectedBackupBucket: String(env.EXPECTED_BACKUP_BUCKET || '').trim(),
  };
}
function assertBackupBucket(cfg) {
  if (cfg.expectedBackupBucket && cfg.backupBucket !== cfg.expectedBackupBucket) {
    throw new BackupError(EXIT.INTEGRITY, 'BACKUP_BUCKET differs from EXPECTED_BACKUP_BUCKET');
  }
}
// Mode `purge` (identity geo-backup-purger, DeleteObject only).
function readPurgeConfig(env) {
  const { num } = envReaders(env);
  return {
    ...readS3Config(env),
    workDir: String(env.WORK_DIR || '/work'),
    dailyDays: num('RETENTION_DAILY_DAYS', 7, { min: 1 }),
    purgeDryRun: String(env.PURGE_DRY_RUN || 'false').trim() === 'true',
  };
}
// Mode `freshness` (identity geo-backup-reader).
function readFreshnessConfig(env) {
  const { num } = envReaders(env);
  return {
    ...readS3Config(env),
    maxAgeDays: num('FRESHNESS_MAX_AGE_DAYS', 1, { min: 0 }),
    maxPartialDays: num('FRESHNESS_MAX_PARTIAL_DAYS', 3, { min: 0 }),
  };
}
// Mode `backup` (identity geo-backup-writer, no delete right).
function readConfig(env) {
  const { req, num } = envReaders(env);
  // Source bucket: SOURCE_BUCKET (geo secret key) or SOURCE_DOCS_BUCKET (immo
  // secret key). Both set and different = a mis-wired pod → refuse.
  const alias = (name, legacy) => {
    const a = String(env[name] || '').trim();
    const b = String(env[legacy] || '').trim();
    if (a && b && a !== b) throw new BackupError(EXIT.INTEGRITY, `${name} and ${legacy} disagree`);
    return a || b;
  };
  const sourceBucket = alias('SOURCE_BUCKET', 'SOURCE_DOCS_BUCKET');
  if (!sourceBucket) throw new BackupError(EXIT.INTEGRITY, 'missing SOURCE_BUCKET');
  const expectedDatabase = req('EXPECTED_DATABASE');
  if (!DB_NAME_RE.test(expectedDatabase)) throw new BackupError(EXIT.INTEGRITY, 'invalid EXPECTED_DATABASE');
  const cfg = {
    ...readS3Config(env),
    sourceBucket,
    expectedSourceBucket: alias('EXPECTED_SOURCE_BUCKET', 'EXPECTED_SOURCE_DOCS_BUCKET'),
    expectedDatabase,
    workDir: String(env.WORK_DIR || '/work'),
    publicHealthUrl: String(env.PUBLIC_HEALTH_URL || '').trim(),
    drizzleJournal: String(env.DRIZZLE_JOURNAL || '').trim(),
    backupImage: String(env.BACKUP_IMAGE || 'unknown').trim(),
    copyConcurrency: Math.min(32, num('COPY_CONCURRENCY', 8, { min: 1 })),
    docsBudgetSeconds: num('DOCS_COPY_BUDGET_SECONDS', 5400, { min: 1 }),
    excludePrefixes: parsePrefixes(env.DOCS_EXCLUDE_PREFIXES),
    minDumpBytes: num('MIN_DUMP_BYTES', MIB, { min: 1 }),
    minDumpRatio: num('MIN_DUMP_RATIO', 0.5, { min: 0, integer: false }),
    minSourceRatio: num('MIN_SOURCE_RATIO', 0.5, { min: 0, integer: false }),
    multipartThreshold: num('MULTIPART_THRESHOLD_BYTES', 4096 * MIB, { min: 5 * MIB }),
    partSize: num('MULTIPART_PART_BYTES', 64 * MIB, { min: 5 * MIB }),
    // Server-side copy of a source object: one CopyObject up to the threshold
    // (S3 caps CopyObject at 5 GiB), UploadPartCopy parts above it.
    copyMultipartThreshold: num('COPY_MULTIPART_THRESHOLD_BYTES', 4 * GIB, { min: 5 * MIB }),
    copyPartSize: num('COPY_PART_BYTES', 512 * MIB, { min: 5 * MIB }),
    retention: {
      dailyDays: num('RETENTION_DAILY_DAYS', 7, { min: 1 }),
      weeklyWeeks: num('RETENTION_WEEKLY_WEEKS', 4, { min: 0 }),
      monthlyMonths: num('RETENTION_MONTHLY_MONTHS', 6, { min: 0 }),
      minKeep: num('RETENTION_MIN_KEEP', 7, { min: 1 }),
    },
  };
  if (cfg.minDumpRatio >= 1) throw new BackupError(EXIT.INTEGRITY, 'invalid MIN_DUMP_RATIO (must be < 1)');
  if (cfg.minSourceRatio >= 1) throw new BackupError(EXIT.INTEGRITY, 'invalid MIN_SOURCE_RATIO (must be < 1)');
  if (cfg.copyMultipartThreshold > 5 * GIB) throw new BackupError(EXIT.INTEGRITY, 'invalid COPY_MULTIPART_THRESHOLD_BYTES (CopyObject max 5 GiB)');
  if (cfg.copyPartSize > 5 * GIB) throw new BackupError(EXIT.INTEGRITY, 'invalid COPY_PART_BYTES (part max 5 GiB)');
  return cfg;
}
// Positive bucket guard (same idea as EXPECTED_DATABASE): a misconfigured secret
// must never make this job write into the source bucket or read the wrong one.
function assertBuckets(cfg) {
  if (cfg.backupBucket === cfg.sourceBucket) throw new BackupError(EXIT.INTEGRITY, 'BACKUP_BUCKET equals SOURCE_BUCKET');
  assertBackupBucket(cfg);
  if (cfg.expectedSourceBucket && cfg.sourceBucket !== cfg.expectedSourceBucket) {
    throw new BackupError(EXIT.INTEGRITY, 'SOURCE_BUCKET differs from EXPECTED_SOURCE_BUCKET');
  }
}

// ── manifest ─────────────────────────────────────────────────────────────────
function buildManifest({ date, startedAt, completedAt, cfg, pg, schema, code, docs, tool }) {
  const docsOk = docs.status === 'complete';
  return {
    format: formatId(cfg.expectedDatabase, 'manifest'),
    date,
    status: docsOk ? 'complete' : 'partial',
    // PARTIAL is a recorded state (seed, objects pending/failed), not a job failure.
    verdict: docsOk ? 'OK' : 'PARTIAL',
    startedAt,
    completedAt,
    backupBucket: cfg.backupBucket,
    pg,
    schema,
    code,
    docs,
    retention: { ...cfg.retention, mechanism: 'delete-marker purge of dated folders + bucket lifecycle (RETENTION.md)' },
    tool,
  };
}
// `previous` = the pointer read at the start of the run (null on the first run).
//   latestComplete  the newest COMPLETE backup (this one, or carried over)
//   partialSince    first date of the current run of non-complete backups
//                   (null when this one is complete) — read by `freshness`
//   docsObjects     source objects listed (the next run's source guard)
function buildLatestPointer(manifest, manifestKey, manifestSha256, previous = null) {
  const complete = manifest.status === 'complete';
  let latestComplete = null;
  if (complete) latestComplete = { date: manifest.date, manifestKey, manifestSha256 };
  else if (previous && previous.latestComplete && isValidDate(previous.latestComplete.date)) latestComplete = previous.latestComplete;
  else if (previous && previous.status === 'complete' && isValidDate(previous.date)) {
    latestComplete = { date: previous.date, manifestKey: previous.manifestKey || null, manifestSha256: previous.manifestSha256 || null };
  }
  let partialSince = null;
  if (!complete) {
    const carried = previous && previous.status && previous.status !== 'complete' &&
      (isValidDate(previous.partialSince) ? previous.partialSince : isValidDate(previous.date) ? previous.date : null);
    partialSince = carried && carried <= manifest.date ? carried : manifest.date;
  }
  return {
    format: formatId(manifest.pg.database, 'latest'),
    date: manifest.date,
    status: manifest.status,
    verdict: manifest.verdict,
    manifestKey,
    manifestSha256,
    pgKey: manifest.pg.key,
    pgSha256: manifest.pg.sha256,
    pgSizeBytes: manifest.pg.sizeBytes,
    inventoryKey: manifest.docs.inventoryKey || null,
    docsObjects: Number.isFinite(manifest.docs.objects) ? manifest.docs.objects : null,
    latestComplete,
    partialSince,
    updatedAt: manifest.completedAt,
  };
}
// Mode `freshness`: T = today (UTC). Not fresh when the latest backup is older
// than maxAgeDays (default 1: date < T-1), or when backups have not been
// complete for more than maxPartialDays (default 3) days.
function checkFreshness(pointer, today, { maxAgeDays = 1, maxPartialDays = 3 } = {}) {
  if (!pointer || !isValidDate(pointer.date)) return { ok: false, reason: 'no valid manifests/latest.json' };
  const t = dayNumber(today);
  const age = t - dayNumber(pointer.date);
  if (age > maxAgeDays) return { ok: false, reason: `latest backup ${pointer.date} is ${age} day(s) old (max ${maxAgeDays})` };
  if (pointer.status !== 'complete') {
    const since = isValidDate(pointer.partialSince) ? pointer.partialSince : pointer.date;
    const d = t - dayNumber(since);
    if (d > maxPartialDays) return { ok: false, reason: `backups not complete since ${since} (${d} days, max ${maxPartialDays})` };
  }
  return { ok: true, reason: null };
}

// ── S3 helpers (client + sdk injected: the selftest passes an in-memory fake) ─
async function hashFile(file) {
  const sha = crypto.createHash('sha256');
  const md5 = crypto.createHash('md5');
  let size = 0;
  for await (const chunk of fs.createReadStream(file)) { sha.update(chunk); md5.update(chunk); size += chunk.length; }
  return { sha256: sha.digest('hex'), md5: md5.digest('base64'), size };
}
async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  const chunks = [];
  for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}
async function listAll(ctx, Bucket, Prefix) {
  const all = [];
  let ContinuationToken;
  do {
    const out = await ctx.s3.send(new ctx.sdk.ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
    for (const o of out.Contents || []) all.push(o);
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return all;
}
// Latest version per key (needs s3:ListBucketVersions). A delete-marker as
// latest means "absent". Throws on AccessDenied; the caller falls back.
async function listLatestVersions(ctx, Bucket, Prefix) {
  const latest = new Map();
  let KeyMarker; let VersionIdMarker;
  do {
    const out = await ctx.s3.send(new ctx.sdk.ListObjectVersionsCommand({ Bucket, Prefix, KeyMarker, VersionIdMarker }));
    for (const v of out.Versions || []) if (v.IsLatest) latest.set(v.Key, v);
    for (const m of out.DeleteMarkers || []) if (m.IsLatest) latest.delete(m.Key);
    const more = out.IsTruncated;
    KeyMarker = more ? out.NextKeyMarker : undefined;
    VersionIdMarker = more ? out.NextVersionIdMarker : undefined;
  } while (KeyMarker);
  return latest;
}
async function putBuffer(ctx, Key, body, ContentType) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const out = await ctx.s3.send(new ctx.sdk.PutObjectCommand({
    Bucket: ctx.cfg.backupBucket, Key, Body: buf, ContentLength: buf.length,
    ContentMD5: crypto.createHash('md5').update(buf).digest('base64'), ContentType,
  }));
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length, versionId: out.VersionId || null };
}
// Single PUT up to the threshold, multipart above. Content-MD5 on every body
// (object-lock buckets require an integrity header on writes).
async function putFile(ctx, Key, file, info) {
  const Bucket = ctx.cfg.backupBucket;
  if (info.size <= ctx.cfg.multipartThreshold) {
    const out = await ctx.s3.send(new ctx.sdk.PutObjectCommand({
      Bucket, Key, Body: fs.createReadStream(file), ContentLength: info.size, ContentMD5: info.md5,
      ContentType: 'application/octet-stream',
    }));
    return { multipart: false, parts: 1, versionId: out.VersionId || null };
  }
  const { UploadId } = await ctx.s3.send(new ctx.sdk.CreateMultipartUploadCommand({ Bucket, Key, ContentType: 'application/octet-stream' }));
  try {
    const parts = [];
    const fh = await fsp.open(file, 'r');
    try {
      for (let n = 1, pos = 0; pos < info.size; n += 1, pos += ctx.cfg.partSize) {
        const len = Math.min(ctx.cfg.partSize, info.size - pos);
        const buf = Buffer.alloc(len);
        let off = 0;
        while (off < len) {
          const { bytesRead } = await fh.read(buf, off, len - off, pos + off);
          if (!bytesRead) throw new BackupError(EXIT.RETRYABLE, 'short read on dump file');
          off += bytesRead;
        }
        const out = await ctx.s3.send(new ctx.sdk.UploadPartCommand({
          Bucket, Key, UploadId, PartNumber: n, Body: buf, ContentLength: len,
          ContentMD5: crypto.createHash('md5').update(buf).digest('base64'),
        }));
        parts.push({ PartNumber: n, ETag: out.ETag });
      }
    } finally {
      await fh.close();
    }
    const done = await ctx.s3.send(new ctx.sdk.CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: parts } }));
    return { multipart: true, parts: parts.length, versionId: done.VersionId || null };
  } catch (e) {
    await ctx.s3.send(new ctx.sdk.AbortMultipartUploadCommand({ Bucket, Key, UploadId })).catch(() => {});
    throw e;
  }
}
// Re-read AFTER upload: HEAD size + full GET re-hash. Mismatch = retryable failure.
async function verifyObject(ctx, Key, expected) {
  const Bucket = ctx.cfg.backupBucket;
  const head = await ctx.s3.send(new ctx.sdk.HeadObjectCommand({ Bucket, Key }));
  if (Number(head.ContentLength) !== expected.size) throw new BackupError(EXIT.RETRYABLE, `size mismatch after upload key=${Key}`);
  const got = await ctx.s3.send(new ctx.sdk.GetObjectCommand({ Bucket, Key }));
  const h = crypto.createHash('sha256');
  let n = 0;
  for await (const chunk of got.Body) { h.update(chunk); n += chunk.length; }
  const sha256 = h.digest('hex');
  if (sha256 !== expected.sha256 || n !== expected.size) throw new BackupError(EXIT.RETRYABLE, `sha256 mismatch after upload key=${Key}`);
  return { sha256, versionId: head.VersionId || got.VersionId || null };
}
// null when absent (first run) or unparsable (a corrupt pointer must not block
// every later backup; the relative size check is then skipped for one run).
async function getJsonOrNull(ctx, Key) {
  let text;
  try {
    const got = await ctx.s3.send(new ctx.sdk.GetObjectCommand({ Bucket: ctx.cfg.backupBucket, Key }));
    text = (await bodyToBuffer(got.Body)).toString('utf8');
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch {
    ctx.log(`WARN ${Key} is not valid JSON; relative size check skipped for this run`);
    return null;
  }
}

async function checkVersioning(ctx) {
  try {
    const out = await ctx.s3.send(new ctx.sdk.GetBucketVersioningCommand({ Bucket: ctx.cfg.backupBucket }));
    if (out.Status !== 'Enabled') {
      throw new BackupError(EXIT.INTEGRITY, `backup bucket versioning is ${out.Status || 'off'} (must be Enabled)`);
    }
    return 'enabled';
  } catch (e) {
    if (e instanceof BackupError) throw e;
    if (isAccessDenied(e)) return 'unverified (no s3:GetBucketVersioning)';
    throw e;
  }
}

async function fetchServedSha(fetchImpl, url) {
  if (!url || typeof fetchImpl !== 'function') return 'unknown';
  try {
    const r = await fetchImpl(url, { signal: globalThis.AbortSignal.timeout(10000) });
    const j = await r.json();
    const sha = j && typeof j.sha === 'string' ? j.sha.trim() : '';
    return /^[0-9a-f]{7,40}$/.test(sha) ? sha : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function readOptional(file) {
  try { return await fsp.readFile(file, 'utf8'); } catch { return null; }
}

// ── docs step ────────────────────────────────────────────────────────────────
// Server-side copy of one source object to docs/<key>. Up to
// copyMultipartThreshold: one CopyObject (immo path). Above it (CopyObject is
// capped at 5 GiB): multipart UploadPartCopy, every part pinned to the listed
// source ETag (CopySourceIfMatch) so a source rewritten mid-copy fails the copy
// (retried next run) instead of mixing two contents. Content-Type and user
// metadata are carried over from a HEAD of the source (same ETag pin).
async function copySourceObject(ctx, o) {
  const { cfg } = ctx;
  const Key = LAYOUT.docsPrefix + o.Key;
  const CopySource = '/' + cfg.sourceBucket + '/' + encodeKey(o.Key);
  const size = Number(o.Size);
  if (!(size > cfg.copyMultipartThreshold)) {
    const out = await ctx.s3.send(new ctx.sdk.CopyObjectCommand({ Bucket: cfg.backupBucket, Key, CopySource, MetadataDirective: 'COPY' }));
    return { etag: (out.CopyObjectResult && out.CopyObjectResult.ETag) || null, versionId: out.VersionId || null, multipart: false };
  }
  const head = await ctx.s3.send(new ctx.sdk.HeadObjectCommand({ Bucket: cfg.sourceBucket, Key: o.Key, IfMatch: o.ETag }));
  const { UploadId } = await ctx.s3.send(new ctx.sdk.CreateMultipartUploadCommand({
    Bucket: cfg.backupBucket, Key, ContentType: head.ContentType, Metadata: head.Metadata,
  }));
  try {
    const parts = [];
    for (let n = 1, pos = 0; pos < size; n += 1, pos += cfg.copyPartSize) {
      const end = Math.min(pos + cfg.copyPartSize, size) - 1;
      const out = await ctx.s3.send(new ctx.sdk.UploadPartCopyCommand({
        Bucket: cfg.backupBucket, Key, UploadId, PartNumber: n, CopySource,
        CopySourceRange: `bytes=${pos}-${end}`, CopySourceIfMatch: o.ETag,
      }));
      parts.push({ PartNumber: n, ETag: out.CopyPartResult && out.CopyPartResult.ETag });
    }
    const done = await ctx.s3.send(new ctx.sdk.CompleteMultipartUploadCommand({ Bucket: cfg.backupBucket, Key, UploadId, MultipartUpload: { Parts: parts } }));
    return { etag: done.ETag || null, versionId: done.VersionId || null, multipart: true };
  } catch (e) {
    await ctx.s3.send(new ctx.sdk.AbortMultipartUploadCommand({ Bucket: cfg.backupBucket, Key, UploadId })).catch(() => {});
    throw e;
  }
}
async function backupDocs(ctx, date, previousCount) {
  const { cfg, log } = ctx;
  const srcObjs = await listAll(ctx, cfg.sourceBucket, undefined);
  const guard = checkSourceCount({ count: srcObjs.length, previousCount, minRatio: cfg.minSourceRatio });
  if (!guard.ok) throw new BackupError(EXIT.INTEGRITY, `source listing anomaly: ${guard.reason}`);
  let dstIndex = new Map();
  let versionIds = 'list-versions';
  try {
    const latest = await listLatestVersions(ctx, cfg.backupBucket, LAYOUT.docsPrefix);
    for (const [k, v] of latest) dstIndex.set(k.slice(LAYOUT.docsPrefix.length), v);
  } catch (e) {
    if (!isAccessDenied(e)) throw e;
    versionIds = 'copy-only';
    dstIndex = new Map();
    for (const d of await listAll(ctx, cfg.backupBucket, LAYOUT.docsPrefix)) dstIndex.set(d.Key.slice(LAYOUT.docsPrefix.length), d);
  }
  const plan = planDocs(srcObjs, dstIndex, cfg.excludePrefixes);
  log(`docs source=${srcObjs.length} up_to_date=${plan.fresh.length} to_copy=${plan.todo.length} excluded=${plan.excluded.length} concurrency=${cfg.copyConcurrency} version_ids=${versionIds}`);
  const deadline = ctx.now() + cfg.docsBudgetSeconds * 1000;
  const copied = new Map();
  const failed = new Set();
  let next = 0; let budgetHit = false; let errorsLogged = 0;
  const worker = async () => {
    while (next < plan.todo.length) {
      if (ctx.now() >= deadline) { budgetHit = true; return; }
      const o = plan.todo[next++];
      try {
        copied.set(o.Key, await copySourceObject(ctx, o));
      } catch (e) {
        failed.add(o.Key);
        if (errorsLogged < 5) { errorsLogged += 1; log(`docs copy error ${errName(e)} (object key not logged)`); }
      }
      const doneCount = copied.size + failed.size;
      if (doneCount % 500 === 0) log(`docs progress ${doneCount}/${plan.todo.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(cfg.copyConcurrency, plan.todo.length) }, () => worker()));
  const inventory = buildInventory({
    db: cfg.expectedDatabase, date, createdAt: new Date(ctx.now()).toISOString(), sourceBucket: cfg.sourceBucket, backupBucket: cfg.backupBucket,
    excludePrefixes: cfg.excludePrefixes, versionIds, srcObjs, dstIndex, copied, failed,
  });
  let copiedMultipart = 0;
  for (const c of copied.values()) if (c.multipart) copiedMultipart += 1;
  return { inventory, copied: copied.size, copiedMultipart, alreadyUpToDate: plan.fresh.length, budgetHit, versionIds };
}

// ── purge (two identities: the writer PLANS, the purger DELETES) ─────────────
// Mode `backup` (writer: List, no delete): after a COMPLETE manifest, list the
// dated prefixes and compute the keys to purge. Written to WORK_DIR/purge-plan.json.
async function planPurge(ctx, today) {
  const { cfg } = ctx;
  const byDate = new Map();
  const complete = new Set();
  for (const prefix of LAYOUT.datedPrefixes) {
    for (const o of await listAll(ctx, cfg.backupBucket, prefix)) {
      const c = classifyKey(o.Key);
      if (!c) continue;
      if (!byDate.has(c.date)) byDate.set(c.date, []);
      byDate.get(c.date).push(o.Key);
      if (c.kind === 'manifest') complete.add(c.date);
    }
  }
  if (!complete.has(today)) throw new BackupError(EXIT.PURGE_FAILED, 'purge refused: manifest of today is not listed');
  const plan = planRetention({ today, dates: [...byDate.keys()], completeDates: [...complete], ...cfg.retention });
  const t = dayNumber(today);
  for (const d of plan.purge) {
    if (t - dayNumber(d) < cfg.retention.dailyDays) throw new BackupError(EXIT.PURGE_FAILED, `purge refused: ${d} is inside the daily window`);
  }
  const keys = [];
  for (const d of plan.purge) keys.push(...byDate.get(d).sort());
  return { keptDates: plan.keep.length, purgeDates: plan.purge, keys };
}
// Mode `purge` (purger: DeleteObject on the dated prefixes + ListBucket, no GET/PUT): the plan comes from the
// writer in the same pod; re-validate it before any delete (exit 2 when invalid):
// complete backup, same bucket, plan of today (or yesterday: a run may cross
// midnight), every key a dated backup object of a purged date outside the daily
// window — never docs/, never manifests/latest.json, never today.
function validatePurgePlan(plan, { today, backupBucket, dailyDays }) {
  const bad = (why) => { throw new BackupError(EXIT.INTEGRITY, `purge plan refused: ${why}`); };
  if (!plan || typeof plan !== 'object') bad('not an object');
  if (typeof plan.format !== 'string' || !/^[a-z_][a-z0-9_]*-backup-purge-plan\/v1$/.test(plan.format)) bad('unknown format');
  if (plan.status !== 'complete') bad('backup of the day is not complete');
  if (plan.backupBucket !== backupBucket) bad('bucket differs');
  if (!isValidDate(plan.date)) bad('invalid date');
  if (plan.manifestKey !== `manifests/${plan.date}.json`) bad('manifest key is not the manifest of the plan date');
  const age = dayNumber(today) - dayNumber(plan.date);
  if (age < 0 || age > 1) bad('plan is not from this run');
  if (!Array.isArray(plan.purgeDates) || !Array.isArray(plan.keys)) bad('missing purgeDates/keys');
  const t = dayNumber(plan.date);
  const dates = new Set();
  for (const d of plan.purgeDates) {
    if (!isValidDate(d) || t - dayNumber(d) < dailyDays) bad('a purge date is inside the daily window');
    dates.add(d);
  }
  for (const k of plan.keys) {
    const c = typeof k === 'string' ? classifyKey(k) : null;
    if (!c || !dates.has(c.date)) bad('a key is not a dated backup object of a purged date');
  }
  return plan;
}
async function executePurge(ctx, plan) {
  const { cfg } = ctx;
  let deleteMarkers = 0;
  for (const Key of plan.keys) {
    // NO VersionId: a delete-marker; the locked version stays until lifecycle expiry.
    if (!cfg.purgeDryRun) {
      try {
        await ctx.s3.send(new ctx.sdk.DeleteObjectCommand({ Bucket: cfg.backupBucket, Key }));
      } catch (e) {
        throw new BackupError(EXIT.PURGE_FAILED, `delete-marker failed ${errName(e)} after ${deleteMarkers}/${plan.keys.length}`);
      }
    }
    deleteMarkers += 1;
  }
  return { purgedDates: plan.purgeDates, deleteMarkers, dryRun: cfg.purgeDryRun };
}
function utcDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
async function runPurge({ env, sdk, s3, now = Date.now, log = console.log }) {
  const cfg = readPurgeConfig(env);
  assertBackupBucket(cfg);
  const text = await readOptional(path.join(cfg.workDir, PURGE_PLAN_FILE));
  if (text === null) {
    log('PURGE VERDICT SKIPPED no purge plan (the backup of the day is not complete: nothing is purged)');
    return { exitCode: EXIT.OK, skipped: true };
  }
  let plan;
  try { plan = JSON.parse(text); } catch { throw new BackupError(EXIT.INTEGRITY, 'purge plan refused: not JSON'); }
  validatePurgePlan(plan, { today: utcDate(now()), backupBucket: cfg.backupBucket, dailyDays: cfg.dailyDays });
  const ctx = { cfg, sdk, s3, now, log };
  // The purger cannot GET: it confirms by LIST (ListBucket) that the manifest of the
  // plan exists in the bucket before any delete-marker.
  const listed = await listAll(ctx, cfg.backupBucket, plan.manifestKey);
  if (!listed.some((o) => o.Key === plan.manifestKey)) throw new BackupError(EXIT.INTEGRITY, 'purge plan refused: its manifest is not listed in the bucket');
  const r = await executePurge(ctx, plan);
  log(`PURGE VERDICT OK date=${plan.date} manifest=${plan.manifestKey || 'unknown'} purge.dates=${r.purgedDates.length}` +
    `${r.purgedDates.length ? '[' + r.purgedDates.join(',') + ']' : ''} purge.delete_markers=${r.deleteMarkers}${r.dryRun ? ' purge.dry_run=true' : ''}`);
  return { exitCode: EXIT.OK, skipped: false, ...r };
}
// Mode `freshness` (reader): read manifests/latest.json only.
async function runFreshness({ env, sdk, s3, now = Date.now, log = console.log }) {
  const cfg = readFreshnessConfig(env);
  assertBackupBucket(cfg);
  const ctx = { cfg, sdk, s3, now, log };
  const pointer = await getJsonOrNull(ctx, LAYOUT.latestKey);
  const today = utcDate(now());
  const f = checkFreshness(pointer, today, cfg);
  const lc = pointer && pointer.latestComplete && pointer.latestComplete.date;
  log(`FRESHNESS ${f.ok ? 'OK' : 'STALE'} today=${today} latest=${(pointer && pointer.date) || 'none'} status=${(pointer && pointer.status) || 'none'} ` +
    `latest_complete=${lc || 'none'} partial_since=${(pointer && pointer.partialSince) || 'none'}${f.ok ? '' : ` reason="${f.reason}"`}`);
  return { exitCode: f.ok ? EXIT.OK : EXIT.NOT_FRESH, ...f };
}

// ── main flow ────────────────────────────────────────────────────────────────
async function runBackup({ env, sdk, s3, fetchImpl, now = Date.now, log = console.log, overrides = {} }) {
  const cfg = { ...readConfig(env), ...overrides };
  assertBuckets(cfg);
  const ctx = { cfg, sdk, s3, now, log };
  const W = cfg.workDir;
  // A plan is only ever the product of THIS run's complete backup.
  await fsp.rm(path.join(W, PURGE_PLAN_FILE), { force: true });

  // 1) facts left by the dump initContainer
  const facts = parseEnvFile(await readOptional(path.join(W, 'dump.env')));
  const date = facts.DATE;
  if (!isValidDate(date)) throw new BackupError(EXIT.INTEGRITY, 'dump.env has no valid DATE');
  if (facts.DATABASE && facts.DATABASE !== cfg.expectedDatabase) throw new BackupError(EXIT.INTEGRITY, 'dump.env DATABASE differs from EXPECTED_DATABASE');
  const db = cfg.expectedDatabase;
  const keys = keysFor(date, db);
  const dumpName = `${db}.dump`;
  const dumpFile = path.join(W, dumpName);
  const shaLine = parseSha256Line(await readOptional(path.join(W, `${dumpName}.sha256`)));
  if (!shaLine) throw new BackupError(EXIT.RETRYABLE, `${dumpName}.sha256 missing or unreadable`);
  let info;
  try { info = await hashFile(dumpFile); } catch { throw new BackupError(EXIT.RETRYABLE, `${dumpName} missing or unreadable`); }
  if (info.sha256 !== shaLine.sha256) throw new BackupError(EXIT.RETRYABLE, 'local sha256 disagrees with sha256sum of the dump');
  log(`pg dump date=${date} bytes=${info.size} sha256=${info.sha256} toc_entries=${facts.TOC_ENTRIES || 'unknown'} db_size_bytes=${facts.DB_SIZE_BYTES || 'unknown'}`);

  // 2) bucket + size guards BEFORE any write
  const versioning = await checkVersioning(ctx);
  const previous = await getJsonOrNull(ctx, LAYOUT.latestKey);
  const size = checkDumpSize({ size: info.size, previousSize: previous && previous.pgSizeBytes, minBytes: cfg.minDumpBytes, minRatio: cfg.minDumpRatio });
  if (!size.ok) throw new BackupError(EXIT.INTEGRITY, `dump size anomaly: ${size.reason}`);
  // Previous source count for the source guard: pointer field, else the previous manifest.
  let previousDocsObjects = previous && Number.isFinite(previous.docsObjects) ? previous.docsObjects : null;
  if (previousDocsObjects === null && previous && typeof previous.manifestKey === 'string' && classifyKey(previous.manifestKey)) {
    const pm = await getJsonOrNull(ctx, previous.manifestKey);
    if (pm && pm.docs && Number.isFinite(pm.docs.objects)) previousDocsObjects = pm.docs.objects;
  }

  // 3) PG upload + re-read
  const up = await putFile(ctx, keys.dump, dumpFile, info);
  const reread = await verifyObject(ctx, keys.dump, info);
  const shaText = `${info.sha256}  ${dumpName}\n`;
  const shaObj = await putBuffer(ctx, keys.dumpSha, shaText, 'text/plain');
  await verifyObject(ctx, keys.dumpSha, shaObj);
  log(`pg uploaded key=${keys.dump} multipart=${up.multipart} parts=${up.parts} reread_sha256=ok`);

  let globals = { status: facts.GLOBALS_STATUS === 'ok' ? 'ok' : 'failed' };
  const globalsText = globals.status === 'ok' ? await readOptional(path.join(W, 'globals.sql')) : null;
  if (globalsText !== null && globals.status === 'ok') {
    const g = await putBuffer(ctx, keys.globals, globalsText, 'application/sql');
    await verifyObject(ctx, keys.globals, g);
    const gs = await putBuffer(ctx, keys.globalsSha, `${g.sha256}  globals.sql\n`, 'text/plain');
    await verifyObject(ctx, keys.globalsSha, gs);
    globals = { status: 'ok', key: keys.globals, sha256Key: keys.globalsSha, sha256: g.sha256, sizeBytes: g.size, rolePasswords: 'excluded' };
  } else {
    globals = { status: 'failed' };
  }

  // 4) schema version (from the dump itself) + served code sha
  const migrations = parseMigrationsCopy(await readOptional(path.join(W, 'migrations.sql')));
  let journal = null;
  if (cfg.drizzleJournal) { try { journal = JSON.parse(await fsp.readFile(cfg.drizzleJournal, 'utf8')); } catch { journal = null; } }
  const schema = migrations
    ? {
        status: 'ok',
        source: 'dump: drizzle.__drizzle_migrations',
        migrationsApplied: migrations.migrationsApplied,
        lastMigration: migrations.lastMigration
          ? { ...migrations.lastMigration, tag: resolveMigrationTag(migrations.lastMigration.createdAt, journal) }
          : null,
      }
    : { status: 'unknown', source: 'dump: drizzle.__drizzle_migrations' };
  const servedSha = await fetchServedSha(fetchImpl, cfg.publicHealthUrl);

  // 5) docs. A source listing anomaly is a refusal (exit 2, no manifest, no
  // purge). Any other failure of the whole step still records the PG backup
  // (status=partial, docs.status=failed, exit 4).
  let docs;
  try {
    const d = await backupDocs(ctx, date, previousDocsObjects);
    const inv = await putBuffer(ctx, keys.inventory, JSON.stringify(d.inventory), 'application/json');
    const c = d.inventory.counts;
    docs = {
      status: c.pending === 0 && c.failed === 0 ? 'complete' : 'partial',
      sourceBucket: cfg.sourceBucket,
      backupPrefix: LAYOUT.docsPrefix,
      objects: c.objects,
      totalBytes: c.totalBytes,
      backedUp: c.backedUp,
      copied: d.copied,
      copiedMultipart: d.copiedMultipart,
      alreadyUpToDate: d.alreadyUpToDate,
      pending: c.pending,
      failed: c.failed,
      excluded: c.excluded,
      excludedPrefixes: cfg.excludePrefixes,
      budgetExhausted: d.budgetHit,
      versionIds: d.versionIds,
      inventoryKey: keys.inventory,
      inventorySha256: inv.sha256,
    };
  } catch (e) {
    if (e instanceof BackupError) throw e;
    log(`docs step failed ${errName(e)}`);
    docs = { status: 'failed', sourceBucket: cfg.sourceBucket, backupPrefix: LAYOUT.docsPrefix, error: errName(e), inventoryKey: null };
  }

  // 6) manifest + latest pointer
  const completedAt = new Date(now()).toISOString();
  const scriptSha256 = crypto.createHash('sha256').update(await fsp.readFile(__filename)).digest('hex');
  const manifest = buildManifest({
    date,
    startedAt: facts.STARTED_AT || null,
    completedAt,
    cfg,
    pg: {
      database: facts.DATABASE || cfg.expectedDatabase,
      format: 'pg_dump custom (-Fc), --no-owner --no-privileges',
      key: keys.dump,
      sha256Key: keys.dumpSha,
      sha256: info.sha256,
      sizeBytes: info.size,
      multipart: up.multipart,
      versionId: up.versionId || reread.versionId || null,
      tocEntries: facts.TOC_ENTRIES ? Number(facts.TOC_ENTRIES) : null,
      databaseSizeBytes: /^\d+$/.test(facts.DB_SIZE_BYTES || '') ? Number(facts.DB_SIZE_BYTES) : null,
      dumpStartedAt: facts.STARTED_AT || null,
      dumpFinishedAt: facts.FINISHED_AT || null,
      serverVersion: facts.SERVER_VERSION || null,
      postgisVersion: facts.POSTGIS_VERSION || null,
      pgDumpVersion: facts.PG_DUMP_VERSION || null,
      checks: {
        tocListedBeforeUpload: Number(facts.TOC_ENTRIES) > 0,
        sha256RereadAfterUpload: true,
        sizeFloorBytes: cfg.minDumpBytes,
        sizeRatioVsPrevious: cfg.minDumpRatio,
        previousSizeBytes: (previous && previous.pgSizeBytes) || null,
      },
      globals,
    },
    schema,
    code: { servedSha, source: cfg.publicHealthUrl || null },
    docs,
    tool: { script: 'deploy/ci/backup/backup-daily.cjs', scriptSha256, image: cfg.backupImage, bucketVersioning: versioning },
  });
  const man = await putBuffer(ctx, keys.manifest, JSON.stringify(manifest, null, 2), 'application/json');
  const pointer = buildLatestPointer(manifest, keys.manifest, man.sha256, previous);
  await putBuffer(ctx, LAYOUT.latestKey, JSON.stringify(pointer, null, 2), 'application/json');

  // 7) retention purge PLAN, only after a COMPLETE backup of the day. The writer
  // cannot delete: the `purge` container (identity geo-backup-purger) executes it.
  let purge = null; let purgeError = null;
  if (manifest.status === 'complete') {
    try {
      purge = await planPurge(ctx, date);
      const plan = {
        format: formatId(db, 'purge-plan'), date, status: manifest.status, backupBucket: cfg.backupBucket,
        manifestKey: keys.manifest, manifestSha256: man.sha256, retention: cfg.retention, purgeDates: purge.purgeDates, keys: purge.keys,
      };
      await fsp.writeFile(path.join(W, PURGE_PLAN_FILE), JSON.stringify(plan));
    } catch (e) { purgeError = e instanceof BackupError ? e.message : errName(e); }
  }

  const verdict = docs.status === 'failed' ? 'DOCS-FAILED' : manifest.status !== 'complete' ? 'PARTIAL' : purgeError ? 'OK-PURGE-PLAN-FAILED' : 'OK';
  const purgeText = manifest.status !== 'complete'
    ? 'purge=skipped(backup not complete)'
    : purgeError
      ? `purge=failed(${purgeError})`
      : `purge=planned purge.kept_dates=${purge.keptDates} purge.dates=${purge.purgeDates.length}${purge.purgeDates.length ? '[' + purge.purgeDates.join(',') + ']' : ''} purge.keys=${purge.keys.length}`;
  log(`VERDICT ${verdict} date=${date} status=${manifest.status} pg.bytes=${info.size} pg.sha256=${info.sha256} ` +
    `schema.migrations=${schema.migrationsApplied === undefined ? 'unknown' : schema.migrationsApplied} code.sha=${servedSha} ` +
    `docs.status=${docs.status} docs.objects=${docs.objects === undefined ? 'n/a' : docs.objects} docs.copied=${docs.copied === undefined ? 'n/a' : docs.copied} ` +
    `docs.pending=${docs.pending === undefined ? 'n/a' : docs.pending} manifest=${keys.manifest} manifest.sha256=${man.sha256} ` +
    `latest_complete=${(pointer.latestComplete && pointer.latestComplete.date) || 'none'} ${purgeText}`);
  const exitCode = docs.status === 'failed' ? EXIT.DOCS_FAILED : purgeError ? EXIT.PURGE_FAILED : EXIT.OK;
  return { exitCode, verdict, manifest, pointer, purge, purgeError };
}

// ── termination message (kubectl-readable verdict, no S3 credential) ─────────
// The pre-MEP gate of cd-prod (deploy/ci/backup/premep-backup-gate.mjs) is
// kubectl-only: it cannot read s3://geo-backup. Exit 0 covers BOTH `complete` and
// `partial`, so the Job status alone cannot tell them apart. Each mode therefore
// writes a one-line JSON verdict to the container termination message
// (/dev/termination-log, mounted by the kubelet, writable under a read-only root
// filesystem), read back from `pod.status.(init)containerStatuses[].state.terminated.message`
// with the `pods get/list` right the deployer already holds — no `pods/log`.
// Verdict fields only: no key, no source object, no credential. Best-effort: a
// missing file (outside k8s, selftest) or a write error never changes the exit code.
const TERMINATION_FORMAT = 'geo-backup-verdict/v1';
function terminationRecord(mode, r, err) {
  if (err !== undefined) {
    return { format: TERMINATION_FORMAT, mode, exitCode: err instanceof BackupError ? err.exitCode : EXIT.RETRYABLE, verdict: 'FAIL' };
  }
  const rec = { format: TERMINATION_FORMAT, mode, exitCode: r.exitCode };
  if (mode === 'backup') {
    rec.verdict = r.verdict || null;
    rec.status = (r.manifest && r.manifest.status) || null;
    rec.date = (r.manifest && r.manifest.date) || null;
    rec.docsStatus = (r.manifest && r.manifest.docs && r.manifest.docs.status) || null;
    rec.latestComplete = (r.pointer && r.pointer.latestComplete && r.pointer.latestComplete.date) || null;
  } else if (mode === 'purge') {
    rec.verdict = r.skipped ? 'SKIPPED' : 'OK';
  } else if (mode === 'freshness') {
    rec.verdict = r.ok ? 'OK' : 'STALE';
  }
  return rec;
}
function writeTerminationMessage(rec, file = process.env.TERMINATION_MESSAGE_PATH || '/dev/termination-log') {
  try {
    if (!fs.existsSync(file)) return false;
    fs.writeFileSync(file, JSON.stringify(rec).slice(0, 4000));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const mode = process.argv[2] || 'backup';
  const modes = { backup: [readConfig, runBackup], purge: [readPurgeConfig, runPurge], freshness: [readFreshnessConfig, runFreshness] };
  if (!modes[mode]) throw new BackupError(EXIT.INTEGRITY, `unknown mode ${mode}`);
  const [read, run] = modes[mode];
  // Lazy: resolved from the geo-api image (NODE_PATH=/app/node_modules); the selftest never loads it.
  const sdk = require('@aws-sdk/client-s3');
  const cfg = read(process.env);
  const s3 = new sdk.S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    maxAttempts: 5,
    // Plain PUTs with our own Content-MD5 (no aws-chunked trailers): the most
    // portable form for S3-compatible providers and object-lock buckets.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const log = (m) => console.log(`[${mode}] ${m}`);
  const r = await run({ env: process.env, sdk, s3, fetchImpl: globalThis.fetch, log });
  writeTerminationMessage(terminationRecord(mode, r));
  return r.exitCode;
}

module.exports = {
  EXIT, BackupError, LAYOUT, PURGE_PLAN_FILE, keysFor, classifyKey, dayNumber, isValidDate, isoWeekIndex, monthIndex, weekdayUtc,
  planRetention, parseEnvFile, parseSha256Line, parseMigrationsCopy, resolveMigrationTag, parsePrefixes, withScheme,
  encodeKey, checkDumpSize, checkSourceCount, upToDate, planDocs, formatId, buildInventory, readConfig, readPurgeConfig,
  readFreshnessConfig, assertBuckets, buildManifest, buildLatestPointer, checkFreshness, copySourceObject, runBackup,
  planPurge, validatePurgePlan, executePurge, runPurge, runFreshness, TERMINATION_FORMAT, terminationRecord, writeTerminationMessage,
};

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((e) => {
    const code = e instanceof BackupError ? e.exitCode : EXIT.RETRYABLE;
    const msg = e instanceof BackupError ? e.message : errName(e);
    console.error(`[${process.argv[2] || 'backup'}] VERDICT FAIL exit=${code} ${msg}`);
    writeTerminationMessage(terminationRecord(process.argv[2] || 'backup', null, e));
    process.exit(code);
  });
}
