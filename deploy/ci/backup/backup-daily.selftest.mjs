#!/usr/bin/env node
// =============================================================================
// backup-daily.selftest.mjs — self-test of deploy/ci/backup/backup-daily.cjs.
//
// Port of the immo selftest (rhanka/radar-immobilier#771) + the geo deltas
// (tenant-agnostic names, SOURCE_BUCKET alias, multipart server-side copy,
// DB size, geo wiring: netpol label, geo-api digest, RBAC, CD job).
//
// 0 network, 0 cluster, 0 real S3, 0 DB: pure helpers + the full runBackup flow
// against an in-memory VERSIONED S3 fake (delete-markers, ListObjectVersions,
// multipart upload + UploadPartCopy, Content-MD5 verification, pagination),
// plus static checks of the CronJob / netpol / RBAC / CD wiring (incl. the step writing the
// backup Secrets from the Environment geo-prod-bundle).
//
//   node deploy/ci/backup/backup-daily.selftest.mjs   → exit 0 when all pass.
// =============================================================================
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const lib = require('./backup-daily.cjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

let passed = 0;
let failed = 0;
const ok = (name, cond) => {
  if (cond) { passed += 1; console.log(`  ok   ${name}`); } else { failed += 1; console.log(`  FAIL ${name}`); }
};
const eq = (name, a, b) => ok(`${name}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`, JSON.stringify(a) === JSON.stringify(b));
const throwsCode = (name, fn, code) => {
  try { fn(); ok(`${name} (did not throw)`, false); } catch (e) { eq(name, e.exitCode, code); }
};

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const md5hex = (b) => crypto.createHash('md5').update(b).digest('hex');
const md5b64 = (b) => crypto.createHash('md5').update(b).digest('base64');
const addDays = (d, n) => new Date(lib.dayNumber(d) * 86400000 + n * 86400000).toISOString().slice(0, 10);
const range = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

// ── fake AWS SDK (command classes named like the real ones) ──────────────────
const OPS = ['PutObject', 'GetObject', 'HeadObject', 'ListObjectsV2', 'ListObjectVersions', 'CopyObject', 'DeleteObject',
  'GetBucketVersioning', 'CreateMultipartUpload', 'UploadPart', 'UploadPartCopy', 'CompleteMultipartUpload', 'AbortMultipartUpload'];
const sdk = Object.fromEntries(OPS.map((op) => {
  const name = `${op}Command`;
  return [name, ({ [name]: class { constructor(input) { this.input = input; } } })[name]];
}));
const s3err = (name, status) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
async function toBuf(body) {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  const chunks = [];
  for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}
const parseCopySource = (cs) => { const m = /^\/([^/]+)\/(.*)$/.exec(cs); return { bucket: m[1], key: decodeURIComponent(m[2]) }; };

class FakeS3 {
  constructor(clock, pageSize = 3) {
    this.clock = clock; this.pageSize = pageSize; this.buckets = new Map(); this.calls = []; this.hooks = {}; this.seq = 0; this.uploads = new Map();
  }
  bucket(name, versioning = 'Enabled') { this.buckets.set(name, { versioning, keys: new Map() }); return this; }
  b(name) { const b = this.buckets.get(name); if (!b) throw s3err('NoSuchBucket', 404); return b; }
  latest(b, key) { const v = b.keys.get(key); if (!v || !v.length) return null; const l = v[v.length - 1]; return l.deleteMarker ? null : l; }
  write(bucket, key, body, etag, { contentType, metadata } = {}) {
    const b = this.b(bucket);
    const ver = { id: b.versioning === 'Enabled' ? `v${++this.seq}` : 'null', body, etag: etag || `"${md5hex(body)}"`, lastModified: new Date(this.clock.now()),
      deleteMarker: false, contentType, metadata };
    if (b.versioning !== 'Enabled' || !b.keys.has(key)) b.keys.set(key, [ver]); else b.keys.get(key).push(ver);
    return ver;
  }
  seed(bucket, key, body, meta) { return this.write(bucket, key, Buffer.from(body), undefined, meta); }
  current(bucket, prefix) {
    const b = this.b(bucket);
    return [...b.keys.keys()].sort().filter((k) => !prefix || k.startsWith(prefix))
      .map((k) => [k, this.latest(b, k)]).filter(([, l]) => l)
      .map(([k, l]) => ({ Key: k, Size: l.body.length, ETag: l.etag, LastModified: l.lastModified }));
  }
  text(bucket, key) { const l = this.latest(this.b(bucket), key); return l ? l.body.toString('utf8') : null; }
  async send(cmd) {
    const op = cmd.constructor.name.replace(/Command$/, '');
    this.calls.push({ op, input: cmd.input });
    if (this.hooks[op]) {
      const r = await this.hooks[op](cmd.input);
      if (r instanceof Error) throw r;
      if (r !== undefined) return r;
    }
    return this[`op${op}`](cmd.input);
  }
  async opPutObject({ Bucket, Key, Body, ContentMD5, ContentLength, ContentType }) {
    const body = await toBuf(Body);
    if (ContentLength !== undefined && ContentLength !== body.length) throw s3err('IncompleteBody', 400);
    if (!ContentMD5 || ContentMD5 !== md5b64(body)) throw s3err('BadDigest', 400); // object-lock: integrity header required
    const v = this.write(Bucket, Key, body, undefined, { contentType: ContentType });
    return { ETag: v.etag, VersionId: v.id };
  }
  async opGetObject({ Bucket, Key }) {
    const l = this.latest(this.b(Bucket), Key);
    if (!l) throw s3err('NoSuchKey', 404);
    return { Body: Readable.from([l.body]), ContentLength: l.body.length, ETag: l.etag, VersionId: l.id };
  }
  async opHeadObject({ Bucket, Key, IfMatch }) {
    const l = this.latest(this.b(Bucket), Key);
    if (!l) throw s3err('NotFound', 404);
    if (IfMatch && IfMatch !== l.etag) throw s3err('PreconditionFailed', 412);
    return { ContentLength: l.body.length, ETag: l.etag, VersionId: l.id, ContentType: l.contentType, Metadata: l.metadata };
  }
  async opListObjectsV2({ Bucket, Prefix, ContinuationToken }) {
    const all = this.current(Bucket, Prefix);
    const start = ContinuationToken ? Number(ContinuationToken) : 0;
    const more = start + this.pageSize < all.length;
    return { Contents: all.slice(start, start + this.pageSize), IsTruncated: more, NextContinuationToken: more ? String(start + this.pageSize) : undefined };
  }
  async opListObjectVersions({ Bucket, Prefix, KeyMarker, VersionIdMarker }) {
    const b = this.b(Bucket);
    const flat = [];
    for (const k of [...b.keys.keys()].sort()) {
      if (Prefix && !k.startsWith(Prefix)) continue;
      const vs = b.keys.get(k);
      for (let i = vs.length - 1; i >= 0; i -= 1) flat.push({ k, v: vs[i], latest: i === vs.length - 1 });
    }
    const start = KeyMarker ? flat.findIndex((x) => x.k === KeyMarker && x.v.id === VersionIdMarker) + 1 : 0;
    const page = flat.slice(start, start + this.pageSize);
    const more = start + this.pageSize < flat.length;
    const last = page[page.length - 1];
    return {
      Versions: page.filter((x) => !x.v.deleteMarker).map((x) => ({ Key: x.k, VersionId: x.v.id, IsLatest: x.latest, Size: x.v.body.length, ETag: x.v.etag, LastModified: x.v.lastModified })),
      DeleteMarkers: page.filter((x) => x.v.deleteMarker).map((x) => ({ Key: x.k, VersionId: x.v.id, IsLatest: x.latest })),
      IsTruncated: more, NextKeyMarker: more ? last.k : undefined, NextVersionIdMarker: more ? last.v.id : undefined,
    };
  }
  async opCopyObject({ Bucket, Key, CopySource }) {
    const src = parseCopySource(CopySource);
    const l = this.latest(this.b(src.bucket), src.key);
    if (!l) throw s3err('NoSuchKey', 404);
    if (l.body.length > 5 * 1024 * 1024 * 1024) throw s3err('InvalidRequest', 400); // CopyObject cap (never reached in tests)
    const v = this.write(Bucket, Key, l.body, l.etag, { contentType: l.contentType, metadata: l.metadata });
    return { CopyObjectResult: { ETag: v.etag, LastModified: v.lastModified }, VersionId: v.id };
  }
  async opDeleteObject({ Bucket, Key, VersionId }) {
    if (VersionId) throw s3err('AccessDenied', 403); // the writer has NO s3:DeleteObjectVersion
    const b = this.b(Bucket);
    if (b.versioning === 'Enabled') {
      if (!b.keys.has(Key)) b.keys.set(Key, []);
      b.keys.get(Key).push({ id: `dm${++this.seq}`, deleteMarker: true, body: Buffer.alloc(0), lastModified: new Date(this.clock.now()) });
    } else b.keys.delete(Key);
    return {};
  }
  async opGetBucketVersioning({ Bucket }) { const b = this.b(Bucket); return b.versioning === 'Off' ? {} : { Status: b.versioning }; }
  async opCreateMultipartUpload({ Bucket, Key, ContentType, Metadata }) {
    const id = `up${++this.seq}`; this.uploads.set(id, { Bucket, Key, ContentType, Metadata, parts: new Map() }); return { UploadId: id };
  }
  async opUploadPart({ UploadId, PartNumber, Body, ContentMD5 }) {
    const body = await toBuf(Body);
    if (ContentMD5 !== md5b64(body)) throw s3err('BadDigest', 400);
    this.uploads.get(UploadId).parts.set(PartNumber, body);
    return { ETag: `"${md5hex(body)}"` };
  }
  async opUploadPartCopy({ UploadId, PartNumber, CopySource, CopySourceRange, CopySourceIfMatch }) {
    const src = parseCopySource(CopySource);
    const l = this.latest(this.b(src.bucket), src.key);
    if (!l) throw s3err('NoSuchKey', 404);
    if (CopySourceIfMatch && CopySourceIfMatch !== l.etag) throw s3err('PreconditionFailed', 412);
    const r = /^bytes=(\d+)-(\d+)$/.exec(CopySourceRange || '');
    if (!r || Number(r[2]) >= l.body.length) throw s3err('InvalidRange', 416);
    const part = l.body.subarray(Number(r[1]), Number(r[2]) + 1);
    this.uploads.get(UploadId).parts.set(PartNumber, part);
    return { CopyPartResult: { ETag: `"${md5hex(part)}"` } };
  }
  async opCompleteMultipartUpload({ Bucket, Key, UploadId, MultipartUpload }) {
    const u = this.uploads.get(UploadId);
    const bufs = MultipartUpload.Parts.map((p) => u.parts.get(p.PartNumber));
    const etag = `"${md5hex(Buffer.concat(bufs.map((x) => crypto.createHash('md5').update(x).digest())))}-${bufs.length}"`;
    const v = this.write(Bucket, Key, Buffer.concat(bufs), etag, { contentType: u.ContentType, metadata: u.Metadata });
    this.uploads.delete(UploadId);
    return { ETag: v.etag, VersionId: v.id };
  }
  async opAbortMultipartUpload({ UploadId }) { this.uploads.delete(UploadId); return {}; }
}

// ── fixtures ─────────────────────────────────────────────────────────────────
const DB = 'geo';
const BK = 'geo-backup';
const SRC = 'sentropic-geo';
const ARCHIVE = 'ops/decommission/20260913/';
const MIGRATIONS_SQL = [
  '--', '-- PostgreSQL database dump', '--', '', 'SET statement_timeout = 0;', '',
  '--', '-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: -', '--', '',
  'COPY drizzle.__drizzle_migrations (id, hash, created_at) FROM stdin;',
  `2\t${'b'.repeat(64)}\t1780000000000`,
  `1\t${'a'.repeat(64)}\t1779659626580`,
  `3\t${'c'.repeat(64)}\t1749524400000`,
  '\\.', '', '--', '-- PostgreSQL database dump complete', '--', '',
].join('\n');
const JOURNAL = { entries: [
  { idx: 0, when: 1779659626580, tag: '0000_first' },
  { idx: 1, when: 1780000000000, tag: '0001_second' },
  { idx: 2, when: 1749524400000, tag: '0002_third' },
] };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-backup-selftest-'));
const JOURNAL_PATH = path.join(TMP, '_journal.json');
fs.writeFileSync(JOURNAL_PATH, JSON.stringify(JOURNAL));
// Source keys chosen to be recognisable: none of these fragments may ever appear in logs.
const DOC_KEYS = ['raw/ville-a/cas/pv 2026-01-15.pdf', 'raw/ville-b/cas/procès-verbal.pdf', 'normalized/qc-zonage-ville-c/zones.geojson',
  'capture/_runs/ville-c/a.json', 'capture/_runs/ville-c/b.json', `${ARCHIVE}scw/ville-e/big.bin`, 'registry/ville-d/x.json'];
const LEAK_MARKERS = ['ville-', 'procès', 'zonage', '_runs', 'decommission', 'AKFAKE', 'SKFAKE'];

let workSeq = 0;
function makeWork(date, { bytes = 300 * 1024, globals = true, migrations = false, db = DB, dbSize = '123456789' } = {}) {
  const dir = path.join(TMP, `work-${++workSeq}`);
  fs.mkdirSync(dir);
  const dump = crypto.randomBytes(bytes);
  fs.writeFileSync(path.join(dir, `${db}.dump`), dump);
  fs.writeFileSync(path.join(dir, `${db}.dump.sha256`), `${sha(dump)}  ${db}.dump\n`);
  fs.writeFileSync(path.join(dir, 'dump.env'), [
    `DATE=${date}`, `STARTED_AT=${date}T03:23:05Z`, `FINISHED_AT=${date}T03:23:16Z`, `DATABASE=${db}`,
    'SERVER_VERSION=16.4 (Debian 16.4-1.pgdg120+2)', 'POSTGIS_VERSION=3.4.3',
    'PG_DUMP_VERSION=pg_dump (PostgreSQL) 16.4 (Debian 16.4-1.pgdg120+2)', `DB_SIZE_BYTES=${dbSize}`, 'TOC_ENTRIES=812',
    `GLOBALS_STATUS=${globals ? 'ok' : 'failed'}`, '',
  ].join('\n'));
  // geo has no drizzle table: the initContainer leaves an EMPTY migrations.sql.
  fs.writeFileSync(path.join(dir, 'migrations.sql'), migrations ? MIGRATIONS_SQL : '');
  if (globals) fs.writeFileSync(path.join(dir, 'globals.sql'), '--\n-- PostgreSQL database cluster dump\n--\nCREATE ROLE geo_db_ro_prod;\n');
  return { dir, dump };
}
const envFor = (dir, extra = {}) => ({
  S3_ENDPOINT: 's3.bhs.io.cloud.ovh.net', S3_REGION: 'bhs', S3_ACCESS_KEY: 'AKFAKE', S3_SECRET_KEY: 'SKFAKE',
  BACKUP_BUCKET: BK, SOURCE_BUCKET: SRC, EXPECTED_BACKUP_BUCKET: BK, EXPECTED_SOURCE_BUCKET: SRC, EXPECTED_DATABASE: DB,
  WORK_DIR: dir, PUBLIC_HEALTH_URL: '', DRIZZLE_JOURNAL: '',
  BACKUP_IMAGE: 'ghcr.io/example/geo-api@sha256:test', MIN_DUMP_BYTES: '1000', ...extra,
});
const okFetch = async () => ({ json: async () => ({ status: 'ok', sha: 'abc1234' }) });
const mkClock = (iso) => ({ t: Date.parse(iso), now() { return this.t; } });

function mkWorld(iso = '2026-09-26T03:20:00Z') {
  const clock = mkClock(iso);
  const fake = new FakeS3(clock).bucket(BK, 'Enabled').bucket(SRC, 'Off');
  clock.t -= 86400000 * 3; // source objects written 3 days earlier
  DOC_KEYS.forEach((k, i) => fake.seed(SRC, k, `doc-${i}-${'x'.repeat(40 + i)}`));
  clock.t += 86400000; // backup copies of 2 objects written after the source writes
  fake.seed(BK, `docs/${DOC_KEYS[3]}`, 'doc-3-' + 'x'.repeat(43)); // identical → up to date
  fake.seed(BK, `docs/${DOC_KEYS[4]}`, 'stale'); // different size → recopied
  clock.t = Date.parse(iso);
  return { clock, fake };
}
// Identities as provisioned by the k8s lane: an S3 view of the fake that refuses
// (AccessDenied) every operation the identity does not have, and records the attempt.
const WRITER_OPS = OPS.filter((op) => op !== 'DeleteObject'); // copy/upload, NO delete
const PURGER_OPS = ['DeleteObject', 'ListObjectsV2']; // delete-marker on dated prefixes + ListBucket, no GET/PUT
const READER_OPS = ['GetObject', 'HeadObject', 'ListObjectsV2', 'ListObjectVersions'];
const PURGER_PREFIXES = ['pg/', 'manifests/', 'docs-inventory/'];
function asIdentity(fake, allowed, { deletePrefixes = null } = {}) {
  const view = { denied: [], ops: [], async send(cmd) {
    const op = cmd.constructor.name.replace(/Command$/, '');
    const prefixOk = !deletePrefixes || op !== 'DeleteObject' || deletePrefixes.some((p) => cmd.input.Key.startsWith(p));
    if (!allowed.includes(op) || !prefixOk) { view.denied.push(op); throw s3err('AccessDenied', 403); }
    view.ops.push(op);
    return fake.send(cmd);
  } };
  return view;
}
const writerOf = (fake) => asIdentity(fake, WRITER_OPS);
const purgerOf = (fake) => asIdentity(fake, PURGER_OPS, { deletePrefixes: PURGER_PREFIXES });
const readerOf = (fake) => asIdentity(fake, READER_OPS);
async function run(fake, clock, env, { overrides, fetchImpl = okFetch, s3, terminate } = {}) {
  const logs = [];
  const view = s3 || writerOf(fake);
  try {
    const r = await lib.runBackup({ env, sdk, s3: view, fetchImpl, now: () => clock.now(), log: (m) => logs.push(m), overrides, terminate });
    return { code: r.exitCode, r, logs, s3: view };
  } catch (e) {
    return { code: e instanceof lib.BackupError ? e.exitCode : `unexpected:${e && e.stack}`, err: e, logs, s3: view };
  }
}
const purgeEnvFor = (dir, extra = {}) => ({
  S3_ENDPOINT: 's3.bhs.io.cloud.ovh.net', S3_REGION: 'bhs', S3_ACCESS_KEY: 'AKFAKE', S3_SECRET_KEY: 'SKFAKE',
  BACKUP_BUCKET: BK, EXPECTED_BACKUP_BUCKET: BK, WORK_DIR: dir, RETENTION_DAILY_DAYS: '7', PURGE_DRY_RUN: 'false', ...extra,
});
async function runPurgeStep(fake, clock, dir, extra = {}, s3 = purgerOf(fake)) {
  const logs = [];
  try {
    const r = await lib.runPurge({ env: purgeEnvFor(dir, extra), sdk, s3, now: () => clock.now(), log: (m) => logs.push(m) });
    return { code: r.exitCode, r, logs, s3 };
  } catch (e) {
    return { code: e instanceof lib.BackupError ? e.exitCode : `unexpected:${e && e.stack}`, err: e, logs, s3 };
  }
}
// The pod: initContainer `backup` (writer), then container `purge` (purger) only if `backup` exited 0.
async function runPod(fake, clock, env, opts = {}) {
  const b = await run(fake, clock, env, opts);
  const p = b.code === 0 ? await runPurgeStep(fake, clock, env.WORK_DIR) : null;
  return { ...b, purge: p };
}
const planOf = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, lib.PURGE_PLAN_FILE), 'utf8')); } catch { return null; } };
const writePlan = (dir, plan) => fs.writeFileSync(path.join(dir, lib.PURGE_PLAN_FILE), JSON.stringify(plan));
const noLeak = (name, logs, extra = '') => {
  const text = logs.join('\n') + extra;
  ok(`${name} — no source key / credential in logs`, LEAK_MARKERS.every((m) => !text.includes(m)));
};
const invOf = (fake, date = '2026-09-26') => JSON.parse(fake.text(BK, `docs-inventory/${date}.json`));
const latestOf = (fake) => JSON.parse(fake.text(BK, 'manifests/latest.json'));
const deletes = (fake) => fake.calls.filter((c) => c.op === 'DeleteObject');

// ═════════════════════════════════════════════════════════════════════════════
console.log('# dates / keys / formats');
eq('dayNumber epoch', lib.dayNumber('1970-01-01'), 0);
ok('invalid dates rejected', ['2026-02-30', '2026-13-01', '26-09-01', 'x', ''].every((d) => !lib.isValidDate(d)));
eq('ISO week: Sun 1970-01-04 and Mon 1970-01-05 differ', [lib.isoWeekIndex('1970-01-04'), lib.isoWeekIndex('1970-01-05')], [0, 1]);
eq('2026-09-27 is a Sunday', lib.weekdayUtc('2026-09-27'), 0);
eq('keysFor layout (dump named after EXPECTED_DATABASE)', lib.keysFor('2026-09-26', 'geo'), {
  dump: 'pg/2026-09-26/geo.dump', dumpSha: 'pg/2026-09-26/geo.dump.sha256', globals: 'pg/2026-09-26/globals.sql',
  globalsSha: 'pg/2026-09-26/globals.sql.sha256', inventory: 'docs-inventory/2026-09-26.json', manifest: 'manifests/2026-09-26.json',
});
eq('keysFor keeps the immo layout for db radar', lib.keysFor('2026-09-26', 'radar').dump, 'pg/2026-09-26/radar.dump');
ok('keysFor refuses a non-identifier db name', (() => { try { lib.keysFor('2026-09-26', '../x'); return false; } catch { return true; } })());
eq('formatId', [lib.formatId('geo', 'manifest'), lib.formatId('radar', 'latest')], ['geo-backup-manifest/v1', 'radar-backup-latest/v1']);
eq('classifyKey pg', lib.classifyKey('pg/2026-09-26/geo.dump'), { kind: 'pg', date: '2026-09-26' });
eq('classifyKey inventory', lib.classifyKey('docs-inventory/2026-09-26.json'), { kind: 'inventory', date: '2026-09-26' });
eq('classifyKey manifest', lib.classifyKey('manifests/2026-09-26.json'), { kind: 'manifest', date: '2026-09-26' });
ok('classifyKey never matches docs/, latest, nested or invalid dates', ['docs/pg/2026-09-26/x', 'manifests/latest.json',
  'pg/2026-09-26/sub/x', 'pg/2026-13-01/geo.dump', 'pg/notes.txt', 'docs-inventory/2026-09-26.json.bak'].every((k) => lib.classifyKey(k) === null));

console.log('# retention — 500-day daily simulation (purge every day)');
{
  const existing = new Set();
  let invariantsOk = true; let maxSize = 0;
  const start = '2025-01-01';
  let today = start;
  for (let i = 0; i < 500; i += 1) {
    today = addDays(start, i);
    existing.add(today);
    const plan = lib.planRetention({ today, dates: [...existing], completeDates: [...existing] });
    for (const d of plan.purge) existing.delete(d);
    for (let a = 0; a < Math.min(7, i + 1); a += 1) if (!existing.has(addDays(today, -a))) invariantsOk = false;
    maxSize = Math.max(maxSize, existing.size);
  }
  ok('the last 7 days are always present', invariantsOk);
  // 4 weekly points = the Sunday inside the daily window + exactly 3 older Sundays (ages 7..27).
  ok(`history bounded (max ${maxSize} <= 16 = 7 daily + 3 older Sundays + 6 monthly)`, maxSize <= 16);
  const t = lib.dayNumber(today);
  const expected = range(start, today).filter((d) => {
    const age = t - lib.dayNumber(d);
    return age < 7 || (lib.weekdayUtc(d) === 0 && age < 28) || (d.endsWith('-01') && lib.monthIndex(today) - lib.monthIndex(d) < 6);
  });
  eq(`final set on ${today} = last 7 days + Sundays < 28 d + 1st of the last 6 months`, [...existing].sort(), expected);
}
{
  // Sunday 2026-09-13 missing → the Saturday becomes the weekly point of that week.
  const existing = new Set();
  for (const today of range('2026-08-01', '2026-09-30')) {
    if (today === '2026-09-13') continue; // no run that day (no backup, no purge)
    existing.add(today);
    const plan = lib.planRetention({ today, dates: [...existing], completeDates: [...existing] });
    for (const d of plan.purge) existing.delete(d);
  }
  ok('missing Sunday → Saturday 2026-09-12 kept as weekly', existing.has('2026-09-12'));
  ok('…and the other days of that week purged', !existing.has('2026-09-11') && !existing.has('2026-09-10'));
}
{
  const all = range('2026-08-02', '2026-09-27'); // today = Sunday 2026-09-27
  const plan = lib.planRetention({ today: '2026-09-27', dates: all, completeDates: all });
  ok('weekly boundary: Sunday aged 21 kept, Sunday aged exactly 28 purged', plan.keep.includes('2026-09-06') && plan.purge.includes('2026-08-30'));
  ok('daily boundary: aged 6 kept, aged 7 (a Sunday) kept only as weekly', plan.reasons['2026-09-21'].includes('daily') &&
    JSON.stringify(plan.reasons['2026-09-20']) === JSON.stringify(['weekly']));
  ok('monthly boundary: 1st of the month 6 months back purged', lib.planRetention({ today: '2026-10-01', dates: ['2026-04-01', '2026-05-01', '2026-10-01'],
    completeDates: ['2026-04-01', '2026-05-01', '2026-10-01'], minKeep: 1 }).purge.join() === '2026-04-01');
}
{
  const complete = [...range('2026-09-01', '2026-09-10'), '2026-09-25'];
  const plan = lib.planRetention({ today: '2026-09-25', dates: complete, completeDates: complete });
  eq('outage: min-keep holds the 7 newest backups', plan.keep, ['2026-09-01', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-25']);
  eq('outage: purge set', plan.purge, ['2026-09-02', '2026-09-03', '2026-09-04']);
}
{
  const all = range('2026-09-01', '2026-09-26');
  const complete = all.filter((d) => d !== '2026-09-03' && d !== '2026-09-24');
  const plan = lib.planRetention({ today: '2026-09-26', dates: [...all, '2026-09-28'], completeDates: complete });
  ok('unfinished day inside the daily window kept', plan.keep.includes('2026-09-24'));
  ok('unfinished day outside the daily window purged', plan.purge.includes('2026-09-03'));
  ok('future date never purged', plan.keep.includes('2026-09-28') && plan.reasons['2026-09-28'].includes('future'));
  ok('monthly point = 1st', plan.reasons['2026-09-01'].includes('monthly'));
}

console.log('# parsers / guards');
eq('parseEnvFile keeps spaces in values', lib.parseEnvFile('DATE=2026-09-26\nSERVER_VERSION=16.4 (Debian)\nbad line\n'), { DATE: '2026-09-26', SERVER_VERSION: '16.4 (Debian)' });
eq('parseSha256Line', lib.parseSha256Line(`${'f'.repeat(64)}  geo.dump\n`), { sha256: 'f'.repeat(64), name: 'geo.dump' });
eq('parseSha256Line rejects garbage', lib.parseSha256Line('nope'), null);
eq('parseMigrationsCopy: count + last by id (not by created_at)', lib.parseMigrationsCopy(MIGRATIONS_SQL), {
  migrationsApplied: 3, lastMigration: { id: 3, hash: 'c'.repeat(64), createdAt: '1749524400000' },
});
eq('parseMigrationsCopy: absent table (empty file, geo today) → null', lib.parseMigrationsCopy(''), null);
eq('resolveMigrationTag via journal `when`', lib.resolveMigrationTag('1749524400000', JOURNAL), '0002_third');
eq('resolveMigrationTag unknown → null', lib.resolveMigrationTag('1', JOURNAL), null);
eq('withScheme bare host', lib.withScheme('s3.bhs.io.cloud.ovh.net'), 'https://s3.bhs.io.cloud.ovh.net');
eq('withScheme keeps scheme', lib.withScheme('http://minio:9000'), 'http://minio:9000');
eq('parsePrefixes', lib.parsePrefixes(` ${ARCHIVE} ,, pmtiles/ `), [ARCHIVE, 'pmtiles/']);
eq('checkDumpSize ok', lib.checkDumpSize({ size: 5000, previousSize: 6000, minBytes: 1000, minRatio: 0.5 }).ok, true);
eq('checkDumpSize floor', lib.checkDumpSize({ size: 999, previousSize: 0, minBytes: 1000, minRatio: 0.5 }).ok, false);
eq('checkDumpSize relative drop', lib.checkDumpSize({ size: 2999, previousSize: 6000, minBytes: 1000, minRatio: 0.5 }).ok, false);
eq('checkDumpSize ratio 0 disables relative check', lib.checkDumpSize({ size: 1000, previousSize: 1e9, minBytes: 1000, minRatio: 0 }).ok, true);
eq('checkSourceCount: 0 object refused', lib.checkSourceCount({ count: 0, previousCount: null, minRatio: 0.5 }).ok, false);
eq('checkSourceCount: first run (no previous) ok', lib.checkSourceCount({ count: 1, previousCount: null, minRatio: 0.5 }).ok, true);
eq('checkSourceCount: < 0.5 x previous refused, = 0.5 x ok', [lib.checkSourceCount({ count: 49, previousCount: 100, minRatio: 0.5 }).ok,
  lib.checkSourceCount({ count: 50, previousCount: 100, minRatio: 0.5 }).ok], [false, true]);
eq('checkSourceCount: ratio 0 disables the relative check (never the empty one)', [lib.checkSourceCount({ count: 1, previousCount: 1e6, minRatio: 0 }).ok,
  lib.checkSourceCount({ count: 0, previousCount: 0, minRatio: 0 }).ok], [true, false]);
{
  const t0 = new Date('2026-09-01T00:00:00Z'); const t1 = new Date('2026-09-02T00:00:00Z');
  ok('upToDate: same size + same ETag', lib.upToDate({ Size: 5, ETag: '"a"', LastModified: t1 }, { Size: 5, ETag: '"a"', LastModified: t0 }));
  ok('upToDate: multipart ETag differs but copy is newer', lib.upToDate({ Size: 5, ETag: '"a-2"', LastModified: t0 }, { Size: 5, ETag: '"b"', LastModified: t1 }));
  ok('not upToDate: ETag differs and copy in the SAME second as the source write (strict >)', !lib.upToDate({ Size: 5, ETag: '"c"', LastModified: t1 }, { Size: 5, ETag: '"a"', LastModified: t1 }));
  ok('not upToDate: normalized/ rewritten same size after the copy', !lib.upToDate({ Size: 5, ETag: '"c"', LastModified: t1 }, { Size: 5, ETag: '"a"', LastModified: t0 }));
  ok('not upToDate: size differs', !lib.upToDate({ Size: 6, ETag: '"a"', LastModified: t0 }, { Size: 5, ETag: '"a"', LastModified: t1 }));
  ok('not upToDate: absent', !lib.upToDate({ Size: 6, ETag: '"a"' }, undefined));
}
throwsCode('readConfig: missing secret key → exit 2', () => lib.readConfig({ ...envFor('/w'), S3_SECRET_KEY: '' }), 2);
throwsCode('readConfig: missing EXPECTED_DATABASE (no tenant default) → exit 2', () => lib.readConfig({ ...envFor('/w'), EXPECTED_DATABASE: '' }), 2);
throwsCode('readConfig: EXPECTED_DATABASE not an identifier → exit 2', () => lib.readConfig({ ...envFor('/w'), EXPECTED_DATABASE: 'geo/../x' }), 2);
throwsCode('readConfig: missing source bucket → exit 2', () => lib.readConfig({ ...envFor('/w'), SOURCE_BUCKET: '' }), 2);
eq('readConfig: legacy immo names SOURCE_DOCS_BUCKET / EXPECTED_SOURCE_DOCS_BUCKET accepted',
  (({ sourceBucket, expectedSourceBucket }) => [sourceBucket, expectedSourceBucket])(lib.readConfig({ ...envFor('/w'), SOURCE_BUCKET: '', EXPECTED_SOURCE_BUCKET: '',
    SOURCE_DOCS_BUCKET: SRC, EXPECTED_SOURCE_DOCS_BUCKET: SRC })), [SRC, SRC]);
throwsCode('readConfig: SOURCE_BUCKET and SOURCE_DOCS_BUCKET disagree → exit 2', () => lib.readConfig({ ...envFor('/w'), SOURCE_DOCS_BUCKET: 'other' }), 2);
throwsCode('readConfig: invalid number → exit 2', () => lib.readConfig({ ...envFor('/w'), COPY_CONCURRENCY: 'many' }), 2);
throwsCode('readConfig: MIN_DUMP_RATIO >= 1 → exit 2', () => lib.readConfig({ ...envFor('/w'), MIN_DUMP_RATIO: '1' }), 2);
throwsCode('readConfig: MIN_SOURCE_RATIO >= 1 → exit 2', () => lib.readConfig({ ...envFor('/w'), MIN_SOURCE_RATIO: '1' }), 2);
eq('readConfig: MIN_DUMP_BYTES default 1 MiB, MIN_SOURCE_RATIO default 0.5', (({ minDumpBytes, minSourceRatio }) => [minDumpBytes, minSourceRatio])(
  lib.readConfig({ ...envFor('/w'), MIN_DUMP_BYTES: '' })), [1048576, 0.5]);
throwsCode('readConfig: part size < 5 MiB → exit 2', () => lib.readConfig({ ...envFor('/w'), MULTIPART_PART_BYTES: '1024' }), 2);
throwsCode('readConfig: copy threshold > 5 GiB (CopyObject cap) → exit 2', () => lib.readConfig({ ...envFor('/w'), COPY_MULTIPART_THRESHOLD_BYTES: String(6 * 1024 ** 3) }), 2);
throwsCode('readConfig: copy part < 5 MiB → exit 2', () => lib.readConfig({ ...envFor('/w'), COPY_PART_BYTES: '1024' }), 2);
throwsCode('assertBuckets: backup == source → exit 2', () => lib.assertBuckets(lib.readConfig({ ...envFor('/w'), BACKUP_BUCKET: SRC, EXPECTED_BACKUP_BUCKET: '' })), 2);
throwsCode('assertBuckets: unexpected backup bucket → exit 2', () => lib.assertBuckets(lib.readConfig({ ...envFor('/w'), BACKUP_BUCKET: 'other' })), 2);
throwsCode('assertBuckets: unexpected source bucket → exit 2', () => lib.assertBuckets(lib.readConfig({ ...envFor('/w'), SOURCE_BUCKET: 'other' })), 2);
eq('readPurgeConfig: purger secret keys only (no source bucket, no DB)', (({ backupBucket, workDir, dailyDays, purgeDryRun }) => [backupBucket, workDir, dailyDays, purgeDryRun])(
  lib.readPurgeConfig(purgeEnvFor('/w'))), [BK, '/w', 7, false]);
throwsCode('readPurgeConfig: missing BACKUP_BUCKET → exit 2', () => lib.readPurgeConfig({ ...purgeEnvFor('/w'), BACKUP_BUCKET: '' }), 2);
eq('readFreshnessConfig defaults: max age 1 day, max partial 3 days', (({ maxAgeDays, maxPartialDays }) => [maxAgeDays, maxPartialDays])(
  lib.readFreshnessConfig(purgeEnvFor('/w'))), [1, 3]);

console.log('# freshness (pure)');
{
  const P = (o) => ({ date: '2026-09-26', status: 'complete', ...o });
  eq('complete today → fresh', lib.checkFreshness(P({}), '2026-09-26').ok, true);
  eq('complete yesterday (D-1) → fresh', lib.checkFreshness(P({ date: '2026-09-25' }), '2026-09-26').ok, true);
  eq('latest older than D-1 → stale', lib.checkFreshness(P({ date: '2026-09-24' }), '2026-09-26').ok, false);
  eq('partial since 3 days → still fresh (seed)', lib.checkFreshness(P({ status: 'partial', partialSince: '2026-09-23' }), '2026-09-26').ok, true);
  eq('partial since more than 3 days → stale', lib.checkFreshness(P({ status: 'partial', partialSince: '2026-09-22' }), '2026-09-26').ok, false);
  eq('partial without partialSince → measured from its own date', lib.checkFreshness(P({ status: 'partial' }), '2026-09-26').ok, true);
  eq('no pointer → stale', lib.checkFreshness(null, '2026-09-26').ok, false);
  eq('N configurable', lib.checkFreshness(P({ status: 'partial', partialSince: '2026-09-23' }), '2026-09-26', { maxPartialDays: 2 }).ok, false);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('# pod run — first run with 210 days of un-purged history (backup as writer, purge as purger)');
{
  const { clock, fake } = mkWorld();
  const partial = new Set(['2026-08-15', '2026-09-24']);
  for (const d of range('2026-03-01', '2026-09-25')) {
    fake.seed(BK, `pg/${d}/geo.dump`, 'old-dump');
    fake.seed(BK, `pg/${d}/geo.dump.sha256`, 'old-sha');
    fake.seed(BK, `docs-inventory/${d}.json`, '{}');
    if (!partial.has(d)) fake.seed(BK, `manifests/${d}.json`, '{}');
  }
  fake.seed(BK, 'manifests/latest.json', JSON.stringify({ date: '2026-09-25', status: 'complete', manifestKey: 'manifests/2026-09-25.json', pgSizeBytes: 400 * 1024, docsObjects: 7 }));
  fake.seed(BK, 'pg/notes.txt', 'operator note');
  const { dir, dump } = makeWork('2026-09-26');
  const res = await runPod(fake, clock, envFor(dir));
  eq('backup exit 0', res.code, 0);
  const m = res.r && res.r.manifest;
  const stored = JSON.parse(fake.text(BK, 'manifests/2026-09-26.json') || '{}');
  eq('manifest stored = manifest returned', stored, m);
  eq('manifest format + status + verdict', [m.format, m.status, m.verdict], ['geo-backup-manifest/v1', 'complete', 'OK']);
  eq('dump uploaded byte-exact', fake.latest(fake.b(BK), 'pg/2026-09-26/geo.dump').body.equals(dump), true);
  eq('sha256 object', fake.text(BK, 'pg/2026-09-26/geo.dump.sha256'), `${sha(dump)}  geo.dump\n`);
  eq('manifest pg', [m.pg.database, m.pg.key, m.pg.sha256, m.pg.sizeBytes, m.pg.multipart, m.pg.serverVersion, m.pg.postgisVersion, m.pg.tocEntries, m.pg.databaseSizeBytes],
    ['geo', 'pg/2026-09-26/geo.dump', sha(dump), dump.length, false, '16.4 (Debian 16.4-1.pgdg120+2)', '3.4.3', 812, 123456789]);
  ok('dump re-read after upload (HEAD + GET on the dump key)', fake.calls.some((c) => c.op === 'HeadObject' && c.input.Key === 'pg/2026-09-26/geo.dump') &&
    fake.calls.filter((c) => c.op === 'GetObject' && c.input.Key === 'pg/2026-09-26/geo.dump').length === 1);
  eq('globals uploaded', [m.pg.globals.status, m.pg.globals.key, m.pg.globals.rolePasswords], ['ok', 'pg/2026-09-26/globals.sql', 'excluded']);
  eq('schema: no drizzle table on geo → unknown', m.schema, { status: 'unknown', source: 'dump: drizzle.__drizzle_migrations' });
  eq('served code sha: PUBLIC_HEALTH_URL empty (netpol) → unknown, no fetch', [m.code.servedSha, m.code.source], ['unknown', null]);
  eq('docs counts', [m.docs.status, m.docs.objects, m.docs.copied, m.docs.copiedMultipart, m.docs.alreadyUpToDate, m.docs.pending, m.docs.versionIds],
    ['complete', 7, 6, 0, 1, 0, 'list-versions']);
  ok('source mirrored under docs/ (all 7 source keys)', DOC_KEYS.every((k) => fake.text(BK, `docs/${k}`) === fake.text(SRC, k)));
  const inv = invOf(fake);
  eq('inventory format', inv.format, 'geo-backup-docs-inventory/v1');
  eq('inventory sha256 in manifest', m.docs.inventorySha256, sha(Buffer.from(fake.text(BK, 'docs-inventory/2026-09-26.json'))));
  ok('inventory: every object backed-up with a versionId and backup ETag', inv.objects.length === 7 && inv.objects.every((o) => o.state === 'backed-up' && o.versionId && o.backupEtag));
  ok('inventory sorted by key', inv.objects.map((o) => o.key).join('|') === [...DOC_KEYS].sort().join('|'));
  const latest = latestOf(fake);
  eq('latest pointer', [latest.format, latest.date, latest.manifestKey, latest.pgSizeBytes, latest.status, latest.verdict, latest.docsObjects, latest.partialSince],
    ['geo-backup-latest/v1', '2026-09-26', 'manifests/2026-09-26.json', dump.length, 'complete', 'OK', 7, null]);
  eq('latest pointer: latestComplete = this backup', latest.latestComplete, { date: '2026-09-26', manifestKey: 'manifests/2026-09-26.json', manifestSha256: latest.manifestSha256 });
  eq('manifest checks record the previous size', m.pg.checks.previousSizeBytes, 400 * 1024);
  eq('COPY STEP CANNOT DELETE: 0 DeleteObject issued or attempted by the writer', [res.s3.ops.filter((o) => o === 'DeleteObject').length, res.s3.denied], [0, []]);
  const plan = planOf(dir);
  ok('complete backup → purge plan written for the purger', !!plan && plan.status === 'complete' && plan.date === '2026-09-26' &&
    plan.manifestKey === 'manifests/2026-09-26.json' && plan.keys.length > 0);
  eq('purge step exit 0', res.purge.code, 0);
  eq('PURGE STEP = DeleteObject + one LIST (its manifest), nothing else, nothing denied', [[...new Set(res.purge.s3.ops)].sort(), res.purge.s3.denied, res.purge.s3.ops.filter((o) => o === 'ListObjectsV2').length],
    [['DeleteObject', 'ListObjectsV2'], [], 1]);
  // retention: 1st of Apr..Sep (monthly), Sundays Aug 30 / Sep 6 / Sep 13 (weekly), Sep 20..26 (daily),
  // Sep 19 (min-keep: Sep 24 is unfinished, so the 7 newest complete backups reach back to Sep 19).
  const keptExpected = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-08-30', '2026-09-01',
    '2026-09-06', '2026-09-13', '2026-09-19', ...range('2026-09-20', '2026-09-26')];
  const datesLeft = [...new Set(fake.current(BK).map((o) => lib.classifyKey(o.Key)).filter(Boolean).map((c) => c.date))].sort();
  eq('retention: dated folders left', datesLeft, keptExpected);
  ok('retention: purge used delete-markers only (no VersionId)', deletes(fake).every((c) => !c.input.VersionId));
  ok('retention: never touched docs/ nor latest nor unknown keys', deletes(fake).every((c) => lib.classifyKey(c.input.Key)) &&
    fake.text(BK, 'pg/notes.txt') === 'operator note' && fake.text(BK, 'manifests/latest.json'));
  ok('retention: purged versions are still there as noncurrent (lock/lifecycle expire them)', fake.b(BK).keys.get('pg/2026-03-02/geo.dump').length === 2);
  eq('retention: planned + executed', [res.r.purge.keptDates, res.r.purge.purgeDates.length, res.purge.r.purgedDates.length, res.purge.r.deleteMarkers],
    [17, 210 - 17, 210 - 17, deletes(fake).length]);
  noLeak('first run', res.logs.concat(res.purge.logs), JSON.stringify(m));
  ok('verdict lines', res.logs.some((l) => l.startsWith('VERDICT OK date=2026-09-26 status=complete')) && res.purge.logs.some((l) => l.startsWith('PURGE VERDICT OK date=2026-09-26')));
  ok('DB size logged (count only)', res.logs.some((l) => l.includes('db_size_bytes=123456789')));
  const fr = await lib.runFreshness({ env: purgeEnvFor('/w'), sdk, s3: readerOf(fake), now: () => clock.now(), log: () => {} });
  eq('freshness (reader identity) after a complete backup → exit 0', fr.exitCode, 0);

  console.log('# pod run — next day is incremental and idempotent');
  clock.t += 86400000;
  const w2 = makeWork('2026-09-27', { bytes: 310 * 1024 });
  const res2 = await runPod(fake, clock, envFor(w2.dir));
  eq('day 2 exit 0 / 0', [res2.code, res2.purge.code], [0, 0]);
  eq('day 2 docs: nothing to copy', [res2.r.manifest.docs.copied, res2.r.manifest.docs.alreadyUpToDate], [0, 7]);
  ok('day 2 purge kept the Sunday + 6 previous days', res2.r.purge.purgeDates.every((d) => d < '2026-09-20') && !res2.r.purge.purgeDates.includes('2026-09-20'));
  noLeak('day 2', res2.logs);

  console.log('# pod run — normalized/ object rewritten under the same key');
  clock.t += 86400000;
  const rewritten = DOC_KEYS[2];
  const before = fake.b(BK).keys.get(`docs/${rewritten}`).length;
  fake.seed(SRC, rewritten, 'doc-2-' + 'y'.repeat(42)); // same size, new content, newer LastModified
  clock.t += 60000;
  const res3 = await runPod(fake, clock, envFor(makeWork('2026-09-28', { bytes: 305 * 1024 }).dir));
  eq('day 3: only the rewritten object is copied', [res3.code, res3.r.manifest.docs.copied], [0, 1]);
  ok('…previous content kept as a noncurrent version (bucket versioning)', fake.b(BK).keys.get(`docs/${rewritten}`).length === before + 1 &&
    fake.text(BK, `docs/${rewritten}`) === fake.text(SRC, rewritten));

  console.log('# pod run — seed interrupted: partial = exit 0, no purge, latestComplete carried over');
  clock.t += 86400000;
  const markersBefore = deletes(fake).length;
  fake.seed(SRC, 'raw/ville-z/cas/new.pdf', 'new-pdf');
  fake.hooks.CopyObject = () => s3err('InternalError', 500);
  const w4 = makeWork('2026-09-29', { bytes: 305 * 1024 });
  const res4 = await runPod(fake, clock, envFor(w4.dir));
  delete fake.hooks.CopyObject;
  eq('partial backup → exit 0 (not a job failure), verdict PARTIAL in the manifest', [res4.code, res4.r.manifest.status, res4.r.manifest.verdict], [0, 'partial', 'PARTIAL']);
  ok('…no purge plan, purge step skipped, no delete-marker', planOf(w4.dir) === null && res4.purge.code === 0 && res4.purge.r.skipped &&
    deletes(fake).length === markersBefore);
  const l4 = latestOf(fake);
  eq('…pointer: status partial, latestComplete = 2026-09-28, partialSince = 2026-09-29', [l4.status, l4.latestComplete.date, l4.partialSince], ['partial', '2026-09-28', '2026-09-29']);
  clock.t += 86400000;
  fake.hooks.CopyObject = () => s3err('InternalError', 500);
  const res5 = await runPod(fake, clock, envFor(makeWork('2026-09-30', { bytes: 305 * 1024 }).dir));
  delete fake.hooks.CopyObject;
  const l5 = latestOf(fake);
  eq('…second partial day keeps partialSince and latestComplete', [res5.code, l5.partialSince, l5.latestComplete.date], [0, '2026-09-29', '2026-09-28']);
  const fresh = (iso) => lib.runFreshness({ env: purgeEnvFor('/w'), sdk, s3: readerOf(fake), now: () => Date.parse(iso), log: () => {} });
  eq('freshness: partial since 2026-09-29 is still fresh on 2026-10-02 (3 days)', (await fresh('2026-10-01T07:47:00Z')).exitCode, 0);
  eq('freshness: …and stale (exit 5) on 2026-10-03 (> 3 days)', (await fresh('2026-10-03T07:47:00Z')).exitCode, 5);
  clock.t += 86400000;
  const res6 = await runPod(fake, clock, envFor(makeWork('2026-10-01', { bytes: 305 * 1024 }).dir));
  const l6 = latestOf(fake);
  eq('…next complete run resets partialSince, latestComplete = today, purge runs again', [res6.code, l6.status, l6.partialSince, l6.latestComplete.date, !!res6.purge && res6.purge.code],
    [0, 'complete', null, '2026-10-01', 0]);
}

console.log('# pod run — source listing guard (refuse, nothing purged)');
{
  const { clock, fake } = mkWorld();
  fake.b(SRC).keys.clear(); // emptied / wrong source bucket
  const { dir } = makeWork('2026-09-26');
  const res = await runPod(fake, clock, envFor(dir));
  eq('0 source object → exit 2, no manifest, no plan, no purge step', [res.code, fake.text(BK, 'manifests/2026-09-26.json'), planOf(dir), res.purge], [2, null, null, null]);
}
{
  const { clock, fake } = mkWorld();
  fake.seed(BK, 'manifests/latest.json', JSON.stringify({ date: '2026-09-25', status: 'complete', manifestKey: 'manifests/2026-09-25.json', pgSizeBytes: 300 * 1024, docsObjects: 20 }));
  const res = await runPod(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('7 source objects < 0.5 x previous inventory 20 → exit 2, no manifest', [res.code, fake.text(BK, 'manifests/2026-09-26.json')], [2, null]);
  ok('…and no copy made', !fake.calls.some((c) => c.op === 'CopyObject'));
  const again = await runPod(fake, clock, envFor(makeWork('2026-09-26').dir, { MIN_SOURCE_RATIO: '0' }));
  eq('MIN_SOURCE_RATIO=0 disables the relative guard (one run, by PR)', again.code, 0);
}
{
  const { clock, fake } = mkWorld();
  // previous pointer of the old format (no docsObjects): count read from the previous manifest
  fake.seed(BK, 'manifests/2026-09-25.json', JSON.stringify({ docs: { objects: 30 } }));
  fake.seed(BK, 'manifests/latest.json', JSON.stringify({ date: '2026-09-25', status: 'complete', manifestKey: 'manifests/2026-09-25.json', pgSizeBytes: 300 * 1024 }));
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('previous count from the previous manifest when the pointer lacks it → exit 2', res.code, 2);
}

console.log('# purge step — plan validation (the purger cannot read: it trusts no unchecked plan)');
{
  const { clock, fake } = mkWorld();
  for (const d of range('2026-09-01', '2026-09-26')) { fake.seed(BK, `manifests/${d}.json`, '{}'); fake.seed(BK, `pg/${d}/geo.dump`, 'x'); }
  const dir = makeWork('2026-09-26').dir;
  const good = { format: 'geo-backup-purge-plan/v1', date: '2026-09-26', status: 'complete', backupBucket: BK, manifestKey: 'manifests/2026-09-26.json',
    purgeDates: ['2026-09-02'], keys: ['pg/2026-09-02/geo.dump', 'manifests/2026-09-02.json'] };
  const cases = [
    ['partial backup', { status: 'partial' }],
    ['key under docs/', { keys: ['docs/raw/x.pdf'] }],
    ['manifests/latest.json', { keys: ['manifests/latest.json'] }],
    ['date inside the daily window', { purgeDates: ['2026-09-22'], keys: ['pg/2026-09-22/geo.dump'] }],
    ['key of a date not in purgeDates', { keys: ['pg/2026-09-03/geo.dump'] }],
    ['stale plan (3 days old)', { date: '2026-09-23', manifestKey: 'manifests/2026-09-23.json' }],
    ['other bucket', { backupBucket: 'other' }],
    ['manifest key of another date', { manifestKey: 'manifests/2026-09-25.json' }],
  ];
  for (const [name, patch] of cases) {
    writePlan(dir, { ...good, ...patch });
    const r = await runPurgeStep(fake, clock, dir);
    eq(`invalid plan (${name}) → exit 2, no delete`, [r.code, deletes(fake).length], [2, 0]);
  }
  fs.writeFileSync(path.join(dir, lib.PURGE_PLAN_FILE), '{not json');
  eq('unreadable plan → exit 2', (await runPurgeStep(fake, clock, dir)).code, 2);
  writePlan(dir, { ...good, date: '2026-09-27', manifestKey: 'manifests/2026-09-27.json', purgeDates: ['2026-09-02'] });
  const futureClock = mkClock('2026-09-27T01:00:00Z');
  eq('plan whose manifest is not listed (purger confirms by LIST only) → exit 2, no delete', [(await runPurgeStep(fake, futureClock, dir)).code, deletes(fake).length], [2, 0]);
  writePlan(dir, good);
  const dry = await runPurgeStep(fake, clock, dir, { PURGE_DRY_RUN: 'true' });
  eq('PURGE_DRY_RUN → exit 0, plan counted, 0 delete', [dry.code, dry.r.deleteMarkers, deletes(fake).length], [0, 2, 0]);
  fake.hooks.DeleteObject = () => s3err('InternalError', 500);
  eq('delete failure → exit 3', (await runPurgeStep(fake, clock, dir)).code, 3);
  delete fake.hooks.DeleteObject;
  const beforeOk = deletes(fake).length; // the failed attempt above reached the fake once
  const okRun = await runPurgeStep(fake, clock, dir);
  eq('valid plan → exit 0, 2 delete-markers, only DeleteObject + the manifest LIST', [okRun.code, deletes(fake).length - beforeOk, okRun.s3.denied,
    [...new Set(okRun.s3.ops)].sort()], [0, 2, [], ['DeleteObject', 'ListObjectsV2']]);
  const noPlan = makeWork('2026-09-26').dir;
  const skipped = await runPurgeStep(fake, clock, noPlan);
  eq('no plan (backup not complete) → skipped, exit 0', [skipped.code, skipped.r.skipped], [0, true]);
  const outside = purgerOf(fake);
  writePlan(dir, good);
  // defence in depth: even a validated plan cannot reach docs/ with the purger (prefix-scoped ARN)
  let refused = false;
  try { await outside.send(new sdk.DeleteObjectCommand({ Bucket: BK, Key: 'docs/raw/x.pdf' })); } catch (e) { refused = e.name === 'AccessDenied'; }
  ok('purger identity model: DeleteObject on docs/ is AccessDenied', refused);
}
{
  const { clock, fake } = mkWorld();
  for (const d of range('2026-01-01', '2026-01-10')) fake.seed(BK, `manifests/${d}.json`, '{}');
  const cfg = { ...lib.readConfig(envFor('/w')) };
  let code = null;
  try { await lib.planPurge({ cfg, sdk, s3: writerOf(fake), now: () => clock.now(), log: () => {} }, '2026-09-26'); } catch (e) { code = e.exitCode; }
  eq('purge planning refuses when the manifest of today is not listed (exit 3)', code, 3);
}

console.log('# pod run — dump multipart above the threshold');
{
  const { clock, fake } = mkWorld();
  const { dir, dump } = makeWork('2026-09-26', { bytes: 300 * 1024 });
  const res = await run(fake, clock, envFor(dir), { overrides: { multipartThreshold: 100 * 1024, partSize: 64 * 1024 } });
  eq('exit 0', res.code, 0);
  eq('5 parts uploaded with Content-MD5', fake.calls.filter((c) => c.op === 'UploadPart').length, 5);
  eq('multipart object byte-exact', fake.latest(fake.b(BK), 'pg/2026-09-26/geo.dump').body.equals(dump), true);
  eq('manifest multipart flag', res.r.manifest.pg.multipart, true);
}

console.log('# pod run — large source object: multipart server-side copy (UploadPartCopy)');
{
  const { clock, fake } = mkWorld();
  const big = 'normalized/qc-zonage-ville-f/lots.geojson';
  clock.t -= 3600e3;
  const body = crypto.randomBytes(100);
  fake.write(SRC, big, body, undefined, { contentType: 'application/geo+json', metadata: { 'geo-sha256': sha(body) } });
  clock.t += 3600e3;
  const over = { copyMultipartThreshold: 60, copyPartSize: 32 }; // test objects are 46..52 bytes; the big one is 100
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir), { overrides: over });
  eq('exit 0, complete', [res.code, res.r.manifest.status], [0, 'complete']);
  const parts = fake.calls.filter((c) => c.op === 'UploadPartCopy');
  eq('4 part copies (32+32+32+4 bytes), ranges and ETag pin', parts.map((c) => [c.input.PartNumber, c.input.CopySourceRange, c.input.CopySourceIfMatch]),
    [[1, 'bytes=0-31', `"${md5hex(body)}"`], [2, 'bytes=32-63', `"${md5hex(body)}"`], [3, 'bytes=64-95', `"${md5hex(body)}"`], [4, 'bytes=96-99', `"${md5hex(body)}"`]]);
  ok('…no single CopyObject for it', !fake.calls.some((c) => c.op === 'CopyObject' && c.input.Key === `docs/${big}`));
  const copy = fake.latest(fake.b(BK), `docs/${big}`);
  ok('…byte-exact copy, Content-Type and user metadata carried over', copy.body.equals(body) && copy.contentType === 'application/geo+json' &&
    copy.metadata['geo-sha256'] === sha(body));
  eq('…manifest counts the multipart copy', [res.r.manifest.docs.copied, res.r.manifest.docs.copiedMultipart], [7, 1]);
  const e = invOf(fake).objects.find((o) => o.key === big);
  ok('…inventory entry backed-up with its version id', e.state === 'backed-up' && !!e.versionId && /-4"$/.test(e.backupEtag));
  clock.t += 86400000;
  const res2 = await run(fake, clock, envFor(makeWork('2026-09-27').dir), { overrides: over });
  eq('next day: multipart copy recognised as up to date (newer copy, same size)', [res2.code, res2.r.manifest.docs.copied], [0, 0]);
}
{
  const { clock, fake } = mkWorld();
  const big = 'normalized/qc-zonage-ville-f/lots.geojson';
  fake.seed(SRC, big, 'y'.repeat(100));
  fake.hooks.UploadPartCopy = (input) => { if (input.PartNumber === 2) fake.seed(SRC, big, 'z'.repeat(100)); return undefined; };
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir), { overrides: { copyMultipartThreshold: 60, copyPartSize: 32 } });
  eq('source rewritten during a multipart copy → partial (exit 0), state failed', [res.code, res.r.manifest.status, invOf(fake).objects.find((o) => o.key === big).state], [0, 'partial', 'failed']);
  ok('…upload aborted (no dangling multipart upload) and no docs/ object for it', fake.uploads.size === 0 && fake.text(BK, `docs/${big}`) === null &&
    fake.calls.some((c) => c.op === 'AbortMultipartUpload'));
  noLeak('multipart failure', res.logs);
}

console.log('# pod run — refusals and degraded paths');
{
  const { clock, fake } = mkWorld();
  const { dir } = makeWork('2026-09-26', { bytes: 50 * 1024 });
  fake.seed(BK, 'manifests/latest.json', JSON.stringify({ pgSizeBytes: 500 * 1024 }));
  const res = await run(fake, clock, envFor(dir));
  eq('dump < 0.5 x previous → exit 2', res.code, 2);
  ok('…and nothing written under pg/ nor manifests/<date>', !fake.calls.some((c) => c.op === 'PutObject' || c.op === 'CreateMultipartUpload'));
}
{
  const { clock, fake } = mkWorld();
  const small = await run(fake, clock, envFor(makeWork('2026-09-26', { bytes: 900 * 1024 }).dir, { MIN_DUMP_BYTES: '1048576' }));
  eq('first run: 900 KiB dump under the 1 MiB floor → exit 2', small.code, 2);
  const okSize = await run(fake, clock, envFor(makeWork('2026-09-26', { bytes: 1100 * 1024 }).dir, { MIN_DUMP_BYTES: '1048576' }));
  eq('first run: 1.1 MiB dump over the 1 MiB floor → exit 0 (prod dump measured 19.4 MB)', okSize.code, 0);
}
{
  const { clock, fake } = mkWorld();
  const res = await run(fake, clock, envFor(makeWork('2026-09-26', { db: 'radar' }).dir));
  eq('dump.env DATABASE differs from EXPECTED_DATABASE → exit 2', res.code, 2);
  ok('…zero S3 call', fake.calls.length === 0);
}
{
  const { clock, fake } = mkWorld();
  const res = await run(fake, clock, envFor(makeWork('2026-09-26', { dbSize: '' }).dir));
  eq('DB size unknown → still exit 0, recorded null', [res.code, res.r.manifest.pg.databaseSizeBytes], [0, null]);
}
{
  const { clock, fake } = mkWorld();
  fake.b(BK).versioning = 'Suspended';
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('versioning Suspended → exit 2', res.code, 2);
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.GetBucketVersioning = () => s3err('AccessDenied', 403);
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('GetBucketVersioning denied → proceeds', res.code, 0);
  ok('…recorded as unverified', res.r.manifest.tool.bucketVersioning.startsWith('unverified'));
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.ListObjectVersions = () => s3err('AccessDenied', 403);
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('ListObjectVersions denied → fallback, exit 0', res.code, 0);
  const inv = invOf(fake);
  eq('…versionIds = copy-only', res.r.manifest.docs.versionIds, 'copy-only');
  ok('…copied objects carry a versionId, the up-to-date one does not', inv.objects.filter((o) => o.versionId).length === 6 &&
    inv.objects.find((o) => o.key === DOC_KEYS[3]).versionId === null && inv.objects.every((o) => o.backupEtag));
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.CopyObject = () => { clock.t += 5401 * 1000; }; // the first copy exhausts the budget
  const w = makeWork('2026-09-26');
  const res = await runPod(fake, clock, envFor(w.dir, { COPY_CONCURRENCY: '1' }));
  eq('copy budget exhausted (seed) → partial, exit 0', [res.code, res.r && res.r.manifest.status], [0, 'partial']);
  eq('…1 copied, 5 pending, budget flag', [res.r.manifest.docs.copied, res.r.manifest.docs.pending, res.r.manifest.docs.budgetExhausted], [1, 5, true]);
  ok('…PG backup recorded, purge skipped (no plan)', !!fake.text(BK, 'pg/2026-09-26/geo.dump.sha256') && planOf(w.dir) === null && res.purge.r.skipped);
  ok('verdict PARTIAL', res.logs.some((l) => l.startsWith('VERDICT PARTIAL')));
  // resume: the next run copies only what is still pending
  delete fake.hooks.CopyObject;
  clock.t += 3600e3;
  const res2 = await runPod(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('…a later run resumes: 5 copied, complete, exit 0', [res2.code, res2.r.manifest.docs.copied, res2.r.manifest.status], [0, 5, 'complete']);
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.CopyObject = (input) => (input.Key.endsWith('x.json') ? s3err('InternalError', 500) : undefined);
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('one copy fails → partial, exit 0, inventory state=failed', [res.code, res.r.manifest.status, invOf(fake).counts.failed], [0, 'partial', 1]);
  noLeak('copy failure', res.logs);
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.ListObjectsV2 = (input) => (input.Bucket === SRC ? s3err('AccessDenied', 403) : undefined);
  const w = makeWork('2026-09-26');
  const res = await run(fake, clock, envFor(w.dir));
  eq('source step failed as a whole → exit 4 (real error), docs failed, PG recorded, no plan',
    [res.code, res.r.manifest.docs.status, !!res.r.manifest.pg.sha256, planOf(w.dir)], [4, 'failed', true, null]);
}
{
  const { clock, fake } = mkWorld();
  let once = true;
  fake.hooks.GetObject = (input) => {
    if (input.Key.endsWith('geo.dump') && once) { once = false; return { Body: Readable.from([Buffer.from('corrupted')]) }; }
    return undefined;
  };
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('re-read sha256 mismatch → exit 1 (retryable)', res.code, 1);
  ok('…no manifest written', fake.text(BK, 'manifests/2026-09-26.json') === null);
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.ListObjectsV2 = (input) => (input.Bucket === BK && input.Prefix === 'manifests/' ? s3err('InternalError', 500) : undefined);
  const w = makeWork('2026-09-26');
  const res = await run(fake, clock, envFor(w.dir));
  eq('purge planning failure after a complete manifest → exit 3, no plan', [res.code, res.r.manifest.status, planOf(w.dir)], [3, 'complete', null]);
}
{
  const { clock, fake } = mkWorld();
  const w = makeWork('2026-09-26');
  writePlan(w.dir, { stale: true });
  const res = await run(fake, clock, envFor(w.dir, { MIN_DUMP_BYTES: '999999999' }));
  eq('a leftover plan is removed by any backup run, even a refused one', [res.code, planOf(w.dir)], [2, null]);
}
{
  const { clock, fake } = mkWorld();
  const res = await run(fake, clock, envFor(makeWork('2026-09-26', { globals: false }).dir));
  eq('globals failed → still exit 0, recorded', [res.code, res.r.manifest.pg.globals.status], [0, 'failed']);
}
{
  const { clock, fake } = mkWorld();
  const res = await run(fake, clock, envFor(makeWork('2026-09-26', { migrations: true }).dir, { DRIZZLE_JOURNAL: JOURNAL_PATH }));
  eq('a drizzle table in the dump is still parsed (tenant-agnostic)', res.r.manifest.schema.lastMigration, { id: 3, hash: 'c'.repeat(64), createdAt: '1749524400000', tag: '0002_third' });
}
{
  const { clock, fake } = mkWorld();
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir, { DOCS_EXCLUDE_PREFIXES: `${ARCHIVE},pmtiles/` }));
  const inv = invOf(fake);
  eq('excluded archive prefix: not copied, state=excluded, docs complete', [res.code, res.r.manifest.docs.excluded, fake.text(BK, `docs/${DOC_KEYS[5]}`),
    inv.objects.find((o) => o.key === DOC_KEYS[5]).state], [0, 1, null, 'excluded']);
  // one-time archive copy (README.md): a run without the archive exclusion, then the exclusion again
  clock.t += 3600e3;
  const once = await run(fake, clock, envFor(makeWork('2026-09-26').dir, { DOCS_EXCLUDE_PREFIXES: 'pmtiles/' }));
  eq('one-time archive run copies only the archive object', [once.code, once.r.manifest.docs.copied], [0, 1]);
  clock.t += 3600e3;
  const back = await run(fake, clock, envFor(makeWork('2026-09-26').dir, { DOCS_EXCLUDE_PREFIXES: `${ARCHIVE},pmtiles/` }));
  eq('…afterwards the archive object reads backed-up even under the exclusion', [back.r.manifest.docs.excluded,
    invOf(fake).objects.find((o) => o.key === DOC_KEYS[5]).state], [0, 'backed-up']);
}
{
  const { clock, fake } = mkWorld();
  fake.seed(BK, 'manifests/latest.json', '{not json');
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir, { PUBLIC_HEALTH_URL: 'https://geo.example/health' }), { fetchImpl: async () => { throw new Error('offline'); } });
  eq('corrupt latest pointer + /health unreachable → exit 0', res.code, 0);
  eq('…code sha unknown', res.r.manifest.code.servedSha, 'unknown');
}
{
  const { clock, fake } = mkWorld();
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir, { BACKUP_BUCKET: SRC }));
  eq('secret pointing the backup at the source bucket → exit 2', res.code, 2);
  ok('…zero S3 call', fake.calls.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════════
// Incident 2026-09-26: one CopyObject never answered (no timeout), the worker
// waited forever, the Job died on activeDeadlineSeconds with no manifest, no
// inventory, no latest.json. A request that never answers must not block a run.
console.log('# S3 request deadlines (incident 2026-09-26)');
const HANG = () => new Promise(() => {}); // a request that never answers
const FAST = { connectMs: 10000, requestMs: 150, metaMs: 150, minBytesPerSec: 8 * 1024 * 1024 };
const SLOW = { connectMs: 10000, requestMs: 600000, metaMs: 600000, minBytesPerSec: 8 * 1024 * 1024 };
const timed = async (fn) => { const t0 = Date.now(); const r = await fn(); return { r, ms: Date.now() - t0 }; };
{
  const cfg = lib.readConfig(envFor('/w'));
  eq('defaults: connect 10 s, request 120 s, meta 30 s, 8 MiB/s, grace 120 s', [cfg.timeouts, cfg.terminationGraceSeconds],
    [{ connectMs: 10000, requestMs: 120000, metaMs: 30000, minBytesPerSec: 8388608 }, 120]);
  eq('env overrides', lib.readConfig(envFor('/w', { S3_CONNECT_TIMEOUT_MS: '5000', S3_REQUEST_TIMEOUT_MS: '60000', S3_META_TIMEOUT_MS: '9000',
    S3_MIN_THROUGHPUT_BYTES_PER_SEC: '1048576' })).timeouts, { connectMs: 5000, requestMs: 60000, metaMs: 9000, minBytesPerSec: 1048576 });
  throwsCode('invalid S3_REQUEST_TIMEOUT_MS → exit 2', () => lib.readConfig(envFor('/w', { S3_REQUEST_TIMEOUT_MS: '0' })), 2);
  throwsCode('TERMINATION_GRACE_SECONDS < 15 → exit 2', () => lib.readConfig(envFor('/w', { TERMINATION_GRACE_SECONDS: '5' })), 2);
  eq('purger and reader carry the same timeouts', [lib.readPurgeConfig(purgeEnvFor('/w')).timeouts, lib.readFreshnessConfig(purgeEnvFor('/w')).timeouts],
    [cfg.timeouts, cfg.timeouts]);
  const c = { cfg };
  eq('deadline: meta 30 s, small copy 120 s (floor), 4 GiB copy 512 s (size / 8 MiB/s)',
    [lib.requestDeadlineMs(c, 'meta', 0), lib.requestDeadlineMs(c, 'body', 1000), lib.requestDeadlineMs(c, 'body', 4 * 1024 ** 3)], [30000, 120000, 512000]);
  eq('deadline after SIGTERM: capped to the grace left (min 1 s)', [lib.requestDeadlineMs({ cfg, finalDeadline: 1000 + 45000 }, 'body', 4 * 1024 ** 3, 1000),
    lib.requestDeadlineMs({ cfg, finalDeadline: 1000 }, 'meta', 0, 5000)], [45000, 1000]);
}
{
  let seen = null;
  const s3 = { send: (cmd, opts) => { seen = opts; return HANG(); } };
  const ctx = { cfg: { timeouts: FAST }, s3 };
  let err = null;
  const { ms } = await timed(() => lib.s3send(ctx, new sdk.CopyObjectCommand({}), { kind: 'body', bytes: 10 }).catch((e) => { err = e; }));
  ok(`s3send: a request that never answers rejects S3RequestTimeout (${ms} ms)`, !!err && err.name === 'S3RequestTimeout' && ms < 2000);
  ok('s3send: the SDK received an AbortSignal, aborted at the deadline', !!seen && seen.abortSignal && seen.abortSignal.aborted);
  const ac = new AbortController();
  const p = lib.s3send({ cfg: { timeouts: SLOW }, s3 }, new sdk.CopyObjectCommand({}), { signal: ac.signal }).catch((e) => e);
  ac.abort(lib.stoppedError('budget'));
  const e2 = await p;
  ok('s3send: parent signal (budget / SIGTERM) aborts at once with its reason', e2 && e2.name === 'BackupStopped' && e2.stop === 'budget');
  const body = new Readable({ read() {} }); // headers arrived, body never ends
  body.push(Buffer.from('partial'));
  const e3 = await lib.s3send({ cfg: { timeouts: FAST }, s3: { send: async () => ({ Body: body }) } }, new sdk.GetObjectCommand({}), {
    consume: async (out, sig) => { for await (const x of out.Body) { void x; if (sig.aborted) break; } return out; },
  }).catch((e) => e);
  ok('s3send: a body that stops flowing is bounded by the same deadline', e3 && e3.name === 'S3RequestTimeout');
  let opts = null;
  const fakeHandler = class { constructor(o) { opts = o; } };
  const h = lib.buildRequestHandler(lib.DEFAULT_TIMEOUTS, () => ({ NodeHttpHandler: fakeHandler }));
  eq('requestHandler: NodeHttpHandler with connectionTimeout 10 s + socketTimeout (idle) 120 s', [h.mode, opts], ['node-http-handler', { connectionTimeout: 10000, socketTimeout: 120000 }]);
  const h2 = lib.buildRequestHandler(lib.DEFAULT_TIMEOUTS, () => { throw new Error('Cannot find module'); });
  eq('requestHandler: module not resolvable → abort-signal-only (s3send still bounds every request)', [h2.mode, h2.requestHandler], ['abort-signal-only', undefined]);
}
const PREV_LATEST = JSON.stringify({ date: '2026-09-25', status: 'complete', manifestKey: 'manifests/2026-09-25.json', manifestSha256: 'f'.repeat(64),
  latestComplete: { date: '2026-09-25', manifestKey: 'manifests/2026-09-25.json', manifestSha256: 'f'.repeat(64) }, pgSizeBytes: 300 * 1024, docsObjects: 7 });
{
  // The incident, replayed: one CopyObject never answers.
  const { clock, fake } = mkWorld();
  fake.seed(BK, 'manifests/latest.json', PREV_LATEST);
  fake.hooks.CopyObject = (input) => (input.Key.endsWith('x.json') ? HANG() : undefined);
  const w = makeWork('2026-09-26');
  const { r: res, ms } = await timed(() => runPod(fake, clock, envFor(w.dir), { overrides: { timeouts: FAST } }));
  const m = res.r && res.r.manifest;
  eq(`hung CopyObject: the run ends (${ms} ms), exit 0, manifest partial`, [res.code, m && m.status, m && m.verdict, ms < 5000], [0, 'partial', 'PARTIAL', true]);
  eq('…the hung object is failed (timed out), the 5 others copied', [m.docs.failed, m.docs.timedOut, m.docs.copied, m.docs.pending], [1, 1, 5, 0]);
  const inv = invOf(fake);
  ok('…inventory written: the object is `failed`, every other backed-up', inv.counts.failed === 1 && inv.counts.backedUp === 6 &&
    inv.objects.find((o) => o.key.endsWith('x.json')).state === 'failed');
  ok('…manifest stored, reason recorded', JSON.parse(fake.text(BK, 'manifests/2026-09-26.json')).partialReason === '1 object(s) failed (1 timed out)');
  const l = latestOf(fake);
  eq('…latest.json: partial, partialSince today, latestComplete unchanged, reason', [l.date, l.status, l.partialSince, l.latestComplete.date, l.partialReason],
    ['2026-09-26', 'partial', '2026-09-26', '2026-09-25', '1 object(s) failed (1 timed out)']);
  ok('…no purge plan, purge step skipped', planOf(w.dir) === null && res.purge && res.purge.r.skipped);
  ok('…verdict line with the counts and the reason', res.logs.some((x) => x.startsWith('VERDICT PARTIAL') && x.includes('docs.timed_out=1') &&
    x.includes('reason="1 object(s) failed (1 timed out)"')));
  noLeak('hung copy', res.logs);
}
{
  // Budget reached with every copy in flight (each one would hang for 10 min):
  // the budget aborts them, the run ends at the budget, not at the request deadline.
  const { clock, fake } = mkWorld();
  fake.seed(BK, 'manifests/latest.json', PREV_LATEST);
  fake.hooks.CopyObject = HANG;
  const w = makeWork('2026-09-26');
  const { r: res, ms } = await timed(() => runPod(fake, clock, envFor(w.dir), { overrides: { timeouts: SLOW, docsBudgetSeconds: 0.2 } }));
  const m = res.r && res.r.manifest;
  eq(`budget with copies in flight: ends at the budget (${ms} ms), exit 0, partial`, [res.code, m && m.status, ms < 5000], [0, 'partial', true]);
  eq('…stop=budget, 0 copied, 6 pending (interrupted, retried next run), 0 failed', [m.docs.stopReason, m.docs.budgetExhausted, m.docs.copied, m.docs.pending,
    m.docs.failed, m.docs.interrupted], ['budget', true, 0, 6, 0, 6]);
  ok('…inventory + manifest + latest.json written', invOf(fake).counts.pending === 6 && !!fake.text(BK, 'manifests/2026-09-26.json') &&
    latestOf(fake).status === 'partial' && latestOf(fake).latestComplete.date === '2026-09-25');
  eq('…reason', m.partialReason, 'docs copy budget reached (0.2 s); 6 object(s) pending');
  ok('…no purge plan', planOf(w.dir) === null && res.purge.r.skipped);
  ok('…log: copy stopped reason=budget', res.logs.some((x) => x.startsWith('docs copy stopped reason=budget')));
}
{
  // SIGTERM (kubelet, activeDeadlineSeconds) while copies hang: recorded, exit 1.
  const { clock, fake } = mkWorld();
  fake.seed(BK, 'manifests/latest.json', PREV_LATEST);
  const term = new AbortController();
  fake.hooks.CopyObject = (input) => {
    if (input.Key.endsWith('b.json')) return undefined; // first to copy: done before the signal
    setTimeout(() => term.abort(lib.stoppedError('terminated')), 30);
    return HANG();
  };
  const w = makeWork('2026-09-26');
  const { r: res, ms } = await timed(() => runPod(fake, clock, envFor(w.dir, { COPY_CONCURRENCY: '1' }), { overrides: { timeouts: SLOW }, terminate: term.signal }));
  const m = res.r && res.r.manifest;
  eq(`SIGTERM during the copy: ends at once (${ms} ms), exit 1, manifest partial`, [res.code, m && m.status, ms < 5000], [1, 'partial', true]);
  eq('…stop=terminated, 1 copied, the rest pending, 0 failed', [m.docs.stopReason, m.docs.copied, m.docs.failed, m.docs.pending], ['terminated', 1, 0, 5]);
  eq('…reason', m.partialReason, 'terminated (SIGTERM) before the copy finished; 5 object(s) pending');
  const l = latestOf(fake);
  ok('…inventory + manifest + latest.json written (latestComplete unchanged)', invOf(fake).counts.pending === 5 && l.status === 'partial' &&
    l.latestComplete.date === '2026-09-25' && l.partialSince === '2026-09-26' && !!l.partialReason);
  ok('…no purge plan, no purge step (exit 1)', planOf(w.dir) === null && res.purge === null);
  ok('…verdict TERMINATED', res.logs.some((x) => x.startsWith('VERDICT TERMINATED') && x.includes('docs.stop=terminated')));
}
{
  // SIGTERM before the PG part is recorded: nothing to record, exit 1, no manifest.
  const { clock, fake } = mkWorld();
  const term = new AbortController();
  term.abort(lib.stoppedError('terminated'));
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir), { terminate: term.signal });
  eq('SIGTERM before the PG upload → exit 1, no manifest, no latest', [res.code, fake.text(BK, 'manifests/2026-09-26.json'), fake.text(BK, 'manifests/latest.json')],
    [1, null, null]);
}
{
  // A hung inventory PUT does not block either: manifest partial (inventory not written).
  const { clock, fake } = mkWorld();
  fake.seed(BK, 'manifests/latest.json', PREV_LATEST);
  fake.hooks.PutObject = (input) => (input.Key.startsWith('docs-inventory/') ? HANG() : undefined);
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir), { overrides: { timeouts: { ...FAST, requestMs: 150 } } });
  const m = res.r && res.r.manifest;
  eq('hung inventory PUT: exit 0, partial even with every object copied (never complete without its inventory)',
    [res.code, m && m.status, m && m.docs.pending, m && m.docs.failed, m && m.docs.inventoryKey], [0, 'partial', 0, 0, null]);
  ok('…reason names the inventory, latest.json written', /inventory not written \(S3RequestTimeout\)/.test(m.partialReason) && latestOf(fake).status === 'partial');
}
{
  // A hung GET of latest.json (before any write): bounded, retryable failure.
  const { clock, fake } = mkWorld();
  fake.hooks.GetObject = (input) => (input.Key === 'manifests/latest.json' ? HANG() : undefined);
  const { r: res, ms } = await timed(() => run(fake, clock, envFor(makeWork('2026-09-26').dir), { overrides: { timeouts: FAST } }));
  // A non-BackupError is mapped to exit 1 (retryable) by main().
  eq(`hung GET latest.json → S3RequestTimeout = exit 1 (${ms} ms), nothing written`,
    [res.err && res.err.name, fake.text(BK, 'manifests/2026-09-26.json'), ms < 5000], ['S3RequestTimeout', null, true]);
}
{
  // Purger: a hung DeleteObject ends the purge (exit 3) instead of blocking the pod.
  const { clock, fake } = mkWorld();
  for (const d of range('2026-09-01', '2026-09-26')) { fake.seed(BK, `manifests/${d}.json`, '{}'); fake.seed(BK, `pg/${d}/geo.dump`, 'x'); }
  const dir = makeWork('2026-09-26').dir;
  writePlan(dir, { format: 'geo-backup-purge-plan/v1', date: '2026-09-26', status: 'complete', backupBucket: BK, manifestKey: 'manifests/2026-09-26.json',
    purgeDates: ['2026-09-02'], keys: ['pg/2026-09-02/geo.dump'] });
  fake.hooks.DeleteObject = HANG;
  const { r: res, ms } = await timed(() => runPurgeStep(fake, clock, dir, { S3_META_TIMEOUT_MS: '150' }));
  eq(`purge: hung DeleteObject → exit 3 (${ms} ms)`, [res.code, ms < 5000], [3, true]);
}
{
  // Freshness reader: a hung GET ends (exit 1 from main), never blocks the CronJob.
  const { clock, fake } = mkWorld();
  fake.hooks.GetObject = HANG;
  let err = null;
  try { await lib.runFreshness({ env: purgeEnvFor('/w', { S3_META_TIMEOUT_MS: '150' }), sdk, s3: readerOf(fake), now: () => clock.now(), log: () => {} }); } catch (e) { err = e; }
  ok('freshness: hung GET → S3RequestTimeout (bounded)', !!err && err.name === 'S3RequestTimeout');
}
{
  // Final write size under SIGTERM: inventory of ~116 000 objects (prod: 70 440 listed
  // + growth), built + serialised + uploaded at the minimum throughput, must fit in
  // the grace period with the manifest and latest.json.
  const N = 116000;
  const t0 = new Date('2026-09-20T00:00:00Z');
  const srcObjs = Array.from({ length: N }, (_, i) => ({ Key: `raw/ville-${i % 1106}/cas/document-${i}-procès-verbal.pdf`, Size: 100000 + i, ETag: `"${md5hex(String(i))}"`,
    LastModified: t0 }));
  const dstIndex = new Map(srcObjs.slice(0, N / 2).map((o) => [o.Key, { ...o, VersionId: `v${o.Size}`, LastModified: new Date('2026-09-21T00:00:00Z') }]));
  const started = Date.now();
  const inv = lib.buildInventory({ db: DB, date: '2026-09-26', createdAt: t0.toISOString(), sourceBucket: SRC, backupBucket: BK, excludePrefixes: [],
    versionIds: 'list-versions', srcObjs, dstIndex, copied: new Map(), failed: new Set() });
  const bytes = Buffer.byteLength(JSON.stringify(inv));
  const buildMs = Date.now() - started;
  const cfg = lib.readConfig(envFor('/w'));
  const uploadMs = lib.requestDeadlineMs({ cfg }, 'body', bytes);
  const graceMs = (cfg.terminationGraceSeconds - 10) * 1000;
  ok(`inventory of ${N} objects: ${(bytes / 1048576).toFixed(1)} MiB built in ${buildMs} ms, upload bound ${uploadMs} ms at 8 MiB/s`,
    buildMs < 15000 && bytes / cfg.timeouts.minBytesPerSec * 1000 < 10000);
  ok(`…build + upload at the min throughput + manifest + latest fit in the grace window (${graceMs} ms)`,
    buildMs + bytes / cfg.timeouts.minBytesPerSec * 1000 + 2 * 5000 < graceMs);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('# static wiring checks');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const active = (t) => t.split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l)).join('\n');
const WRITER_KEYS = ['BACKUP_BUCKET', 'S3_ACCESS_KEY', 'S3_ENDPOINT', 'S3_REGION', 'S3_SECRET_KEY', 'SOURCE_BUCKET'];
const READER_KEYS = ['BACKUP_BUCKET', 'S3_ACCESS_KEY', 'S3_ENDPOINT', 'S3_REGION', 'S3_SECRET_KEY'];
const PURGER_KEYS = READER_KEYS;
const cj = read('deploy/ci/backup/cronjob-backup-daily.yaml');
const fcj = read('deploy/ci/backup/cronjob-backup-freshness.yaml');
// container blocks of the daily CronJob (items indented 12 spaces)
const block = (text, name) => {
  const start = text.indexOf(`\n            - name: ${name}\n`);
  if (start < 0) return '';
  const rest = text.slice(start + 1);
  const end = rest.slice(1).search(/\n {12}- name: |\n {10}containers:/);
  return end < 0 ? rest : rest.slice(0, end + 1);
};
const secretRefs = (text) => [...text.matchAll(/secretKeyRef: \{ name: ([a-z0-9-]+), key: ([A-Z_0-9]+) \}/g)].map((x) => `${x[1]}/${x[2]}`);
{
  const prodDump = read('deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml');
  const pinned = /image:\s*"(ghcr\.io\/rhanka\/geo-api@sha256:[0-9a-f]{64})"/.exec(prodDump)[1];
  ok('CronJob name/ns/schedule/Forbid/not suspended', /name: geo-backup-daily\n/.test(cj) && /namespace: geo\n/.test(cj) &&
    /schedule: "23 3 \* \* \*"/.test(cj) && /concurrencyPolicy: Forbid/.test(cj) && /suspend: false/.test(cj));
  const bk = block(cj, 'backup'); const pu = block(cj, 'purge'); const du = block(cj, 'dump');
  ok('pod order: initContainers dump → backup, then container purge', cj.indexOf('- name: dump') < cj.indexOf('- name: backup') &&
    cj.indexOf('- name: backup') < cj.indexOf('          containers:') && cj.indexOf('          containers:') < cj.indexOf('- name: purge') &&
    /command: \["node", "\/opt\/backup\/backup-daily\.cjs", "backup"\]/.test(bk) && /command: \["node", "\/opt\/backup\/backup-daily\.cjs", "purge"\]/.test(pu));
  ok('same geo-api digest as the bascule dump CronJob for backup, purge and freshness (no new image)',
    [bk, pu, fcj].every((t) => t.includes(`image: "${pinned}"`)) && bk.includes(`name: BACKUP_IMAGE, value: "${pinned}"`));
  ok('dump image = postgis/postgis:16-3.4 (= the postgis StatefulSet)', /image: postgis\/postgis:16-3\.4\n/.test(du) &&
    /image: postgis\/postgis:16-3\.4/.test(read('deploy/k8s/postgis-statefulset.yaml')));
  ok('DB host/name as the bascule dump (geo-postgis.geo.svc, EXPECTED_DATABASE=geo)', /name: PGHOST, value: "geo-postgis\.geo\.svc"/.test(du) &&
    /name: EXPECTED_DATABASE, value: "geo"/.test(du) && /name: EXPECTED_DATABASE, value: "geo"/.test(bk));
  const podLabels = /template:\n\s+metadata:\n\s+labels:\n([\s\S]*?)\n\s+spec:/.exec(cj);
  ok('pod template carries role: pra-backup', !!podLabels && /^\s+role: pra-backup$/m.test(podLabels[1]));
  const np = read('deploy/ci/bascule-preprod/netpol-geo-db-backup.k8s-apply.yaml');
  ok('existing netpols select role: pra-backup (ingress postgis + egress), untouched by this job',
    /name: allow-geo-db-backup-to-postgis[\s\S]*?from:\s*\n\s*- podSelector:\s*\n\s*matchLabels:\s*\n\s*role: pra-backup/.test(np) &&
    /name: allow-geo-db-backup-egress[\s\S]*?spec:\s*\n\s*podSelector:\s*\n\s*matchLabels:\s*\n\s*role: pra-backup/.test(np));
  ok('egress is DNS/postgis/S3 only → PUBLIC_HEALTH_URL empty', /cidr: 54\.39\.60\.208\/32/.test(np) && /name: PUBLIC_HEALTH_URL, value: "" \}/.test(bk));
  eq('backup step reads exactly the writer keys (SOURCE_BUCKET, not SOURCE_DOCS_BUCKET)', secretRefs(bk).filter((r) => r.startsWith('geo-backup')).sort(),
    WRITER_KEYS.map((k) => `geo-backup-writer/${k}`));
  eq('purge step reads exactly the purger keys, and no other backup identity', secretRefs(pu).sort(), PURGER_KEYS.map((k) => `geo-backup-purger/${k}`));
  ok('the writer never meets the purger (identities per container)', !bk.includes('geo-backup-purger') && !pu.includes('geo-backup-writer') &&
    !cj.includes('geo-backup-reader'));
  ok('purge mounts /work read-only; backup writes it', /\{ name: work, mountPath: \/work, readOnly: true \}/.test(pu) && /\{ name: work, mountPath: \/work \}/.test(bk));
  ok('DB via the RO role secret, never the superuser', /name: geo-db-ro-prod, key: POSTGRES_PASSWORD/.test(du) && !active(cj).includes('geo-postgis-credentials'));
  ok('podFailurePolicy FailJob on 2/3/4 (partial = exit 0 is not in it)', /values: \[2, 3, 4\]/.test(cj));
  // Server-side schema of batch/v1 PodFailurePolicy (not checked by --dry-run=client; port of immo #772):
  // every rule has an action and exactly one matcher; onExitCodes has operator + values
  // (unique, ascending, no 0 with In); every onPodConditions entry has type AND status.
  for (const [file, text] of [['cronjob-backup-daily.yaml', cj], ['cronjob-backup-freshness.yaml', fcj]]) {
    const at = text.indexOf('\n      podFailurePolicy:');
    if (at < 0) { ok(`${file}: no podFailurePolicy (nothing to validate)`, !/podFailurePolicy:/.test(text.replace(/#.*$/mg, ''))); continue; }
    const pfp = text.slice(at + 1).split('\n').slice(1).filter((l, i, a) => a.slice(0, i + 1).every((x) => /^ {8,}\S|^\s*$/.test(x))).join('\n');
    const rules = pfp.split(/\n {10}- /).slice(1).map((r) => '- ' + r);
    const problems = [];
    rules.forEach((r, i) => {
      if (!/^- action: (FailJob|FailIndex|Ignore|Count)\b/.test(r)) problems.push(`rules[${i}].action`);
      const hasCodes = /\n {12}onExitCodes:/.test(r); const hasConds = /\n {12}onPodConditions:/.test(r);
      if (hasCodes === hasConds) problems.push(`rules[${i}]: exactly one of onExitCodes/onPodConditions`);
      if (hasCodes) {
        if (!/\n {14}operator: (In|NotIn)\b/.test(r)) problems.push(`rules[${i}].onExitCodes.operator`);
        const m = /\n {14}values: \[([^\]]*)\]/.exec(r);
        const vals = m ? m[1].split(',').map((v) => Number(v.trim())) : [];
        if (!vals.length || vals.some((v, j) => !Number.isInteger(v) || (j && v <= vals[j - 1])) || (/operator: In/.test(r) && vals.includes(0))) {
          problems.push(`rules[${i}].onExitCodes.values`);
        }
      }
      if (hasConds) {
        const conds = r.split(/\n {14}- /).slice(1);
        if (!conds.length) problems.push(`rules[${i}].onPodConditions empty`);
        conds.forEach((c, j) => {
          if (!/^type: \S+/.test(c)) problems.push(`rules[${i}].onPodConditions[${j}].type`);
          if (!/(^|\n {16})status: "(True|False|Unknown)"/.test(c)) problems.push(`rules[${i}].onPodConditions[${j}].status`);
        });
      }
    });
    eq(`${file}: podFailurePolicy matches the batch/v1 schema (${rules.length} rules)`, problems, []);
  }
  ok('no python in any active line of the backup job', !/python|\.py\b/i.test(active(cj) + active(fcj) + active(read('deploy/ci/backup/backup-daily.cjs'))));
  const cfgKeys = ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'BACKUP_BUCKET', 'SOURCE_BUCKET', 'EXPECTED_BACKUP_BUCKET',
    'EXPECTED_SOURCE_BUCKET', 'EXPECTED_DATABASE', 'WORK_DIR', 'PUBLIC_HEALTH_URL', 'DRIZZLE_JOURNAL', 'COPY_CONCURRENCY', 'DOCS_COPY_BUDGET_SECONDS',
    'DOCS_EXCLUDE_PREFIXES', 'COPY_MULTIPART_THRESHOLD_BYTES', 'COPY_PART_BYTES', 'MIN_DUMP_BYTES', 'MIN_DUMP_RATIO', 'MIN_SOURCE_RATIO',
    'RETENTION_DAILY_DAYS', 'RETENTION_WEEKLY_WEEKS', 'RETENTION_MONTHLY_MONTHS', 'RETENTION_MIN_KEEP',
    'S3_CONNECT_TIMEOUT_MS', 'S3_REQUEST_TIMEOUT_MS', 'S3_META_TIMEOUT_MS', 'S3_MIN_THROUGHPUT_BYTES_PER_SEC', 'TERMINATION_GRACE_SECONDS'];
  ok('every runtime knob of the backup step is set explicitly', cfgKeys.every((k) => bk.includes(`name: ${k},`)));
  ok('every runtime knob of the purge step is set explicitly', ['EXPECTED_BACKUP_BUCKET', 'WORK_DIR', 'RETENTION_DAILY_DAYS', 'PURGE_DRY_RUN']
    .every((k) => pu.includes(`name: ${k},`)) && !bk.includes('name: PURGE_DRY_RUN,'));
  const vals = (t) => Object.fromEntries([...t.matchAll(/\{ name: ([A-Z_0-9]+), value: "([^"]*)" \}/g)].map((x) => [x[1], x[2]]));
  const fakeSecret = { S3_ENDPOINT: 'e', S3_REGION: 'r', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's', BACKUP_BUCKET: BK };
  const cfg = lib.readConfig({ ...vals(bk), ...fakeSecret, SOURCE_BUCKET: SRC });
  const pcfg = lib.readPurgeConfig({ ...vals(pu), ...fakeSecret });
  const fcfg = lib.readFreshnessConfig({ ...vals(fcj), ...fakeSecret });
  eq('CronJob values parse into the documented retention (backup and purge agree on the daily window)',
    [cfg.retention, pcfg.dailyDays, pcfg.purgeDryRun], [{ dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 6, minKeep: 7 }, 7, false]);
  eq('CronJob guards: buckets + database', [cfg.expectedBackupBucket, cfg.expectedSourceBucket, cfg.expectedDatabase, pcfg.expectedBackupBucket, fcfg.expectedBackupBucket],
    [BK, SRC, DB, BK, BK]);
  eq('CronJob copy knobs: concurrency 8, 2 h budget, 1 MiB dump floor (prod 19.4 MB), ratios 0.5',
    [cfg.copyConcurrency, cfg.docsBudgetSeconds, cfg.minDumpBytes, cfg.minDumpRatio, cfg.minSourceRatio], [8, 7200, 1048576, 0.5, 0.5]);
  eq('excluded prefixes = frozen archive + rebuildable PMTiles only', cfg.excludePrefixes, [ARCHIVE, 'pmtiles/']);
  ok('irreplaceable prefixes are never excluded', ['raw/', 'capture/', 'sources/', 'registry/', 'normalized/']
    .every((p) => !cfg.excludePrefixes.some((x) => p.startsWith(x) || x.startsWith(p))));
  ok('docs budget fits the Job deadline', /activeDeadlineSeconds: 10800/.test(cj) && cfg.docsBudgetSeconds <= 10800 - 1800);
  // The internal budget must cut well before activeDeadlineSeconds, so the normal
  // case never depends on SIGTERM: pre-docs phase (dump + PG upload/re-read, 30 min
  // margin) + docs budget + the longest request deadline in flight (a copy of
  // COPY_MULTIPART_THRESHOLD_BYTES) + the final writes (inventory, manifest,
  // latest.json: 3 request deadlines) + the grace period < activeDeadlineSeconds.
  const deadlineS = Number((/activeDeadlineSeconds: (\d+)/.exec(cj) || [])[1]);
  const graceS = Number((/terminationGracePeriodSeconds: (\d+)/.exec(cj) || [])[1]);
  const maxCopyS = lib.requestDeadlineMs({ cfg }, 'body', Math.max(cfg.copyMultipartThreshold, cfg.copyPartSize)) / 1000;
  const finalS = 3 * lib.requestDeadlineMs({ cfg }, 'body', 0) / 1000;
  const totalS = 1800 + cfg.docsBudgetSeconds + maxCopyS + finalS + graceS;
  ok(`budget + max request deadline + final writes + grace < activeDeadlineSeconds (1800 + ${cfg.docsBudgetSeconds} + ${maxCopyS} + ${finalS} + ${graceS} = ${totalS} < ${deadlineS})`,
    Number.isFinite(totalS) && totalS < deadlineS);
  eq('terminationGracePeriodSeconds = TERMINATION_GRACE_SECONDS (final writes capped to the real grace)', [graceS, cfg.terminationGraceSeconds], [120, 120]);
  eq('CronJob S3 deadlines: connect 10 s, request 120 s, meta 30 s, 8 MiB/s', cfg.timeouts, { connectMs: 10000, requestMs: 120000, metaMs: 30000, minBytesPerSec: 8388608 });
  ok('freshness CronJob: name/ns/schedule after the backup window, no retry', /name: geo-backup-freshness\n/.test(fcj) && /namespace: geo\n/.test(fcj) &&
    /schedule: "47 7 \* \* \*"/.test(fcj) && /backoffLimit: 0/.test(fcj) && /command: \["node", "\/opt\/backup\/backup-daily\.cjs", "freshness"\]/.test(fcj));
  eq('freshness reads only the reader identity; N = 3 days, max age 1 day', [secretRefs(fcj).sort(), fcfg.maxPartialDays, fcfg.maxAgeDays],
    [READER_KEYS.map((k) => `geo-backup-reader/${k}`), 3, 1]);
  ok('freshness pod needs no postgis access (no role=pra-backup)', !/role: pra-backup/.test(fcj));
}
// ── Backup identities: Environment geo-prod-bundle → core Secrets written by the CD.
// Owner rule: NO SealedSecret committed for them; source of truth = GitHub + the k8s lane `.env`.
const IDS = ['writer', 'reader', 'purger'];
const WANT_KEYS = { writer: WRITER_KEYS, reader: READER_KEYS, purger: PURGER_KEYS };
const GH_SECRETS = IDS.flatMap((id) => [`GEO_BACKUP_${id.toUpperCase()}_ACCESS_KEY`, `GEO_BACKUP_${id.toUpperCase()}_SECRET_KEY`]);
const GH_VARS = ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_REGION', 'BACKUP_BUCKET', 'BACKUP_SOURCE_BUCKET'];
const wf = read('.github/workflows/bascule-bundle-cd.yml');
const job = (/\n {2}apply-backup:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/.exec(wf) || [])[1] || '';
const jobSteps = job.split(/\n(?= {6}- (?:name|uses): )/).slice(1);
const secretStep = jobSteps.find((st) => /^ {6}- name: Write backup Secrets from GitHub/.test(st)) || '';
// `run:` bodies of a workflow text (block `run: |` and one-line `run: …`).
const runBodies = (text) => {
  const out = []; const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(?:- )?run: ?(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (!/^[|>]/.test(m[2])) { out.push(m[2]); continue; }
    const body = [];
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > m[1].length); j += 1) body.push(lines[j]);
    out.push(body.join('\n'));
  }
  return out;
};
const secretRun = runBodies(secretStep).join('\n');
{
  const dir = path.join(ROOT, 'deploy/ci/backup');
  const files = fs.readdirSync(dir);
  ok('no SealedSecret committed for the backup identities (no *sealed* file, no kind: SealedSecret)',
    !files.some((f) => /sealed/i.test(f)) && files.filter((f) => /\.ya?ml$/.test(f)).every((f) => !/^kind: SealedSecret/m.test(read(`deploy/ci/backup/${f}`))));
  ok('CD apply-backup: no SealedSecret guard/apply/wait left in the job', !/kubectl[^\n]*sealedsecret|sealed[^\s]*\.ya?ml|kind: SealedSecret/i.test(active(job)));
  const envMap = Object.fromEntries([...secretStep.matchAll(/^ {10}([A-Z0-9_]+): \$\{\{ (secrets|vars)\.([A-Z0-9_]+) \}\}$/mg)].map((x) => [x[1], `${x[2]}.${x[3]}`]));
  eq('CD secret step: env = the 6 Environment secrets + the 4 Environment variables, same names',
    envMap, Object.fromEntries([...GH_SECRETS.map((n) => [n, `secrets.${n}`]), ...GH_VARS.map((n) => [n, `vars.${n}`])]));
  ok('CD workflow: no ${{ secrets.* }} interpolated in any run: block', runBodies(wf).every((b) => !/\$\{\{\s*secrets\./.test(b)));
  ok('CD secret step: no ${{ }} expression at all in its run: block', secretRun.length > 0 && !secretRun.includes('${{'));
  ok('CD apply-backup: no xtrace, no --from-literal (values never in argv or logs)', !/set -[a-z]*x|set -o xtrace|--from-literal/.test(active(job)));
  const keysOf = (id) => ((new RegExp(`\\n\\s+\\[${id}\\]="([^"]*)"`).exec(secretRun) || [])[1] || '').split(/\s+/).filter(Boolean).sort();
  for (const id of IDS) eq(`CD secret step: geo-backup-${id} keys`, keysOf(id), WANT_KEYS[id]);
  const mounted = {};
  for (const t of [cj, fcj]) for (const x of t.matchAll(/secretKeyRef: \{ name: geo-backup-([a-z]+), key: ([A-Z_0-9]+) \}/g)) (mounted[x[1]] ||= new Set()).add(x[2]);
  eq('CD secret step keys = keys mounted by the CronJobs, per identity', IDS.map((id) => keysOf(id)), IDS.map((id) => [...(mounted[id] || [])].sort()));
  const iGuard = secretRun.indexOf('(missing)'); const iBucket = secretRun.indexOf('EXPECTED_BACKUP_BUCKET');
  const iGet = secretRun.indexOf('get secret'); const iDry = secretRun.indexOf(' replace --dry-run=server -f ');
  const iDryOk = secretRun.indexOf('server-side dry-run OK for the 3 Secrets'); const iReplace = secretRun.indexOf(' replace -f "$tmp/');
  ok('CD secret step: fail-closed order — values guard, bucket guard, Secrets exist, dry-run of the 3, then the real replace',
    iGuard > 0 && iGuard < iBucket && iBucket < iGet && iGet < iDry && iDry < iDryOk && iDryOk < iReplace && secretRun.indexOf('kubectl') > iGuard &&
    secretRun.includes('EXPECTED_SOURCE_BUCKET') && /multi-line/.test(secretRun));
  const kubectlCalls = [...active(secretRun).matchAll(/\bkubectl\s+(?:-n\s+"\$NAMESPACE"\s+)?([a-z-]+)([^\n]*)/g)].map((x) => [x[1], x[2]]);
  eq('CD secret step: kubectl verbs = get, create (client-side), label (local), replace — never apply/patch/delete',
    [...new Set(kubectlCalls.map((c) => c[0]))].sort(), ['create', 'get', 'label', 'replace']);
  const replaces = kubectlCalls.filter(([v]) => v === 'replace').map(([, rest]) => rest.trim());
  eq('CD secret step: exactly 2 replace calls — server-side dry-run, then the real PUT — of the rendered manifests',
    replaces, ['--dry-run=server -f "$tmp/${id}.yaml" -o json | keys_json)" || [ "$live" != "$(want_of "$id")" ]; then', '-f "$tmp/${id}.yaml" -o json | keys_json)" || [ "$live" != "$(want_of "$id")" ]; then']);
  ok('CD secret step: create is client-side only (--dry-run=client), label is --local',
    kubectlCalls.every(([v, rest]) => (v !== 'create' || /--dry-run=client/.test(rest)) && (v !== 'label' || /--local/.test(rest))) &&
    /create secret generic "geo-backup-\$\{id\}" --type=Opaque "\$\{args\[@\]\}" --dry-run=client -o yaml/.test(secretRun));
  ok('CD secret step: S3 target pinned + credential charset/length', /PINNED_S3_ENDPOINT="https:\/\/s3\.bhs\.io\.cloud\.ovh\.net"/.test(secretRun) &&
    /PINNED_S3_REGION="bhs"/.test(secretRun) && secretRun.includes("RE_ACCESS_KEY='^[A-Za-z0-9]{16,128}$'") && secretRun.includes("RE_SECRET_KEY='^[A-Za-z0-9/+=]{16,128}$'"));
  const guardEnd = secretRun.indexOf('# 3. The three Secrets exist');
  // kubectl is a function that aborts (97): the guard must decide before any cluster call.
  const guardScript = guardEnd > 0 ? `kubectl() { echo KUBECTL-CALLED; exit 97; }\n${secretRun.slice(0, guardEnd)}\necho GUARD-PASSED\n` : 'exit 99';
  const fakeVals = Object.fromEntries(GH_SECRETS.map((n, i) => [n, n.endsWith('_ACCESS_KEY') ? `AKFAKE${i}0123456789abcdef` : `SKFAKE${i}/+=0123456789abcdef`]));
  const goodEnv = { NAMESPACE: 'geo', BACKUP_DIR: 'deploy/ci/backup', ...fakeVals, BACKUP_S3_ENDPOINT: 'https://s3.bhs.io.cloud.ovh.net', BACKUP_S3_REGION: 'bhs',
    BACKUP_BUCKET: BK, BACKUP_SOURCE_BUCKET: SRC };
  const guard = (over) => {
    const r = spawnSync('bash', ['-e', '-c', guardScript], { cwd: ROOT, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ...goodEnv, ...over } });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    return { passed: r.status === 0 && out.includes('GUARD-PASSED'), refused: r.status === 1 && out.includes('Nothing was applied') && !out.includes('GUARD-PASSED'),
      leak: Object.values(fakeVals).some((v) => out.includes(v)) };
  };
  const good = guard({});
  ok('CD secret step guard (bash): valid GitHub values pass, nothing echoed', good.passed && !good.leak);
  const W = 'GEO_BACKUP_WRITER', R = 'GEO_BACKUP_READER', U = 'GEO_BACKUP_PURGER';
  for (const [name, over] of [
    ['missing secret', { [`${U}_SECRET_KEY`]: '' }], ['missing variable', { BACKUP_S3_REGION: '' }],
    ['multi-line secret', { [`${R}_ACCESS_KEY`]: 'AKFAKE0123456789abcd\n' }], ['CR in a value', { [`${W}_SECRET_KEY`]: 'SKFAKE0123456789abcd\r' }],
    ['access key charset', { [`${W}_ACCESS_KEY`]: 'AKFAKE-0123456789abc' }], ['access key too short', { [`${R}_ACCESS_KEY`]: 'AKFAKE012345678' }],
    ['access key too long', { [`${U}_ACCESS_KEY`]: `AKFAKE${'a'.repeat(123)}` }], ['secret key charset (quote)', { [`${W}_SECRET_KEY`]: 'SKFAKE"0123456789abc' }],
    ['secret key charset (space)', { [`${U}_SECRET_KEY`]: 'SKFAKE 0123456789abc' }], ['endpoint not pinned (no scheme)', { BACKUP_S3_ENDPOINT: 's3.bhs.io.cloud.ovh.net' }],
    ['endpoint not pinned (other region)', { BACKUP_S3_ENDPOINT: 'https://s3.gra.io.cloud.ovh.net' }], ['region not pinned', { BACKUP_S3_REGION: 'gra' }],
    ['backup bucket mismatch', { BACKUP_BUCKET: 'other-bucket' }], ['source bucket mismatch', { BACKUP_SOURCE_BUCKET: 'other-source' }],
  ]) {
    const g = guard(over);
    ok(`CD secret step guard (bash): ${name} → refused before any kubectl, no value echoed`, g.refused && !g.leak);
  }
  ok('CD secret step: values from 0600 files of a temp dir removed on exit', /umask 077/.test(secretRun) && /mktemp -d/.test(secretRun) &&
    /trap 'rm -rf "\$tmp"' EXIT/.test(secretRun) && /--from-file=\$\{k\}=/.test(secretRun));
  ok('CD secret step: Secrets labelled app.kubernetes.io/component=db-backup', /app\.kubernetes\.io\/component=db-backup/.test(secretRun));
  const names = jobSteps.map((st) => (/- name: (.*)/.exec(st) || [])[1] || '');
  const at = (p) => names.findIndex((n) => n.startsWith(p));
  ok('CD apply-backup: selftest → kubeconfig → pre-flight → Secrets → ConfigMap/CronJobs', at('Selftest') > -1 && at('Selftest') < at('Configure kubeconfig') &&
    at('Configure kubeconfig') < at('Pre-flight') && at('Pre-flight') < at('Write backup Secrets') && at('Write backup Secrets') < at('Apply script ConfigMap'));
}
{
  const rbac = read('deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml');
  const role = rbac.split(/^---\s*$/m).find((d) => /^kind: Role$/m.test(d) && /^ {2}name: geo-ci-bascule-prod$/m.test(d)) || '';
  const list = (x) => (x || '').split(',').map((y) => y.trim()).filter(Boolean).map((y) => y.replace(/^"|"$/g, ''));
  const rules = role.split(/\n {2}- apiGroups: /).slice(1).map((r) => ({
    groups: list((/^\[([^\]]*)\]/.exec(r) || [])[1]),
    resources: list((/\n {4}resources: \[([^\]]*)\]/.exec(r) || [])[1]),
    verbs: list((/\n {4}verbs: \[([^\]]*)\]/.exec(r) || [])[1]),
    names: list((/\n {4}resourceNames: \[([^\]]*)\]/.exec(r) || [])[1]),
  }));
  const secretRules = rules.filter((r) => r.groups.includes('') && r.resources.some((x) => x === 'secrets' || x === '*'));
  eq('CD Role: core secrets = ONE rule, get/update on the 3 backup names only (no create/patch/list/watch/delete)',
    secretRules.map((r) => [r.resources, [...r.verbs].sort(), [...r.names].sort()]),
    [[['secrets'], ['get', 'update'], ['geo-backup-purger', 'geo-backup-reader', 'geo-backup-writer']]]);
  ok('CD Role: no wildcard verb or resource', rules.every((r) => !r.verbs.includes('*') && !r.resources.includes('*')));
  eq('CD Role: sealedsecrets name-scoped to the 2 bundle SealedSecrets only (no backup name)',
    rules.filter((r) => r.resources.includes('sealedsecrets') && r.names.length).map((r) => r.names), [['geo-db-ro-prod', 'geo-pra-writer-prod']]);
  ok('CD Role: backup script ConfigMap name-scoped', /resourceNames: \["geo-db-ro-role-sql", "geo-backup-daily-script"\]/.test(rbac));
  ok('CD Role: backup + freshness CronJobs name-scoped', /resourceNames: \["geo-db-backup-prod", "geo-backup-daily", "geo-backup-freshness"\]/.test(rbac));
  ok('CD workflow: path trigger deploy/ci/backup/** + dispatch inputs', wf.includes("- 'deploy/ci/backup/**'") && /backup_run_now:/.test(wf) && /backup_include_archive:/.test(wf));
  ok('CD apply-backup: same owner gate (needs approve, attempt-bound) + vault Environment geo-prod-bundle', /needs: approve/.test(job) &&
    /environment: geo-prod-bundle/.test(job) && /needs\.approve\.outputs\.attempt == github\.run_attempt/.test(job));
  ok('CD apply-backup: armed by BASCULE_BUNDLE_CD_ENABLED AND BACKUP_DAILY_CD_ENABLED', /vars\.BASCULE_BUNDLE_CD_ENABLED == 'true'/.test(job) &&
    /vars\.BACKUP_DAILY_CD_ENABLED == 'true'/.test(job));
  ok('CD apply-backup: applies script ConfigMap + both CronJobs, asserts the committed schedules',
    job.includes('geo-backup-daily-script') && job.includes('cronjob-backup-daily.yaml') && job.includes('"23 3 * * *|false|Forbid"') &&
    job.includes('cronjob-backup-freshness.yaml') && job.includes('"47 7 * * *|false|Forbid"'));
  ok('CD apply-backup: manual run refused inside the 03:13–06:30 UTC window and while a run is active',
    /WINDOW_START_MIN: "193"/.test(job) && /WINDOW_END_MIN: "390"/.test(job) && job.includes('status.active'));
  const ci = read('.github/workflows/ci.yml');
  ok('CI runs this selftest', ci.includes('node deploy/ci/backup/backup-daily.selftest.mjs'));
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
