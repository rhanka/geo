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
// plus static checks of the CronJob / SealedSecrets / netpol / RBAC / CD wiring.
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
async function run(fake, clock, env, { overrides, fetchImpl = okFetch } = {}) {
  const logs = [];
  try {
    const r = await lib.runBackup({ env, sdk, s3: fake, fetchImpl, now: () => clock.now(), log: (m) => logs.push(m), overrides });
    return { code: r.exitCode, r, logs };
  } catch (e) {
    return { code: e instanceof lib.BackupError ? e.exitCode : `unexpected:${e && e.stack}`, err: e, logs };
  }
}
const noLeak = (name, logs, extra = '') => {
  const text = logs.join('\n') + extra;
  ok(`${name} — no source key / credential in logs`, LEAK_MARKERS.every((m) => !text.includes(m)));
};
const invOf = (fake, date = '2026-09-26') => JSON.parse(fake.text(BK, `docs-inventory/${date}.json`));

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
{
  const t0 = new Date('2026-09-01T00:00:00Z'); const t1 = new Date('2026-09-02T00:00:00Z');
  ok('upToDate: same size + same ETag', lib.upToDate({ Size: 5, ETag: '"a"', LastModified: t1 }, { Size: 5, ETag: '"a"', LastModified: t0 }));
  ok('upToDate: multipart ETag differs but copy is newer', lib.upToDate({ Size: 5, ETag: '"a-2"', LastModified: t0 }, { Size: 5, ETag: '"b"', LastModified: t1 }));
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
throwsCode('readConfig: part size < 5 MiB → exit 2', () => lib.readConfig({ ...envFor('/w'), MULTIPART_PART_BYTES: '1024' }), 2);
throwsCode('readConfig: copy threshold > 5 GiB (CopyObject cap) → exit 2', () => lib.readConfig({ ...envFor('/w'), COPY_MULTIPART_THRESHOLD_BYTES: String(6 * 1024 ** 3) }), 2);
throwsCode('readConfig: copy part < 5 MiB → exit 2', () => lib.readConfig({ ...envFor('/w'), COPY_PART_BYTES: '1024' }), 2);
throwsCode('assertBuckets: backup == source → exit 2', () => lib.assertBuckets(lib.readConfig({ ...envFor('/w'), BACKUP_BUCKET: SRC, EXPECTED_BACKUP_BUCKET: '' })), 2);
throwsCode('assertBuckets: unexpected backup bucket → exit 2', () => lib.assertBuckets(lib.readConfig({ ...envFor('/w'), BACKUP_BUCKET: 'other' })), 2);
throwsCode('assertBuckets: unexpected source bucket → exit 2', () => lib.assertBuckets(lib.readConfig({ ...envFor('/w'), SOURCE_BUCKET: 'other' })), 2);

// ═════════════════════════════════════════════════════════════════════════════
console.log('# runBackup — first run with 210 days of un-purged history');
{
  const { clock, fake } = mkWorld();
  const partial = new Set(['2026-08-15', '2026-09-24']);
  for (const d of range('2026-03-01', '2026-09-25')) {
    fake.seed(BK, `pg/${d}/geo.dump`, 'old-dump');
    fake.seed(BK, `pg/${d}/geo.dump.sha256`, 'old-sha');
    fake.seed(BK, `docs-inventory/${d}.json`, '{}');
    if (!partial.has(d)) fake.seed(BK, `manifests/${d}.json`, '{}');
  }
  fake.seed(BK, 'manifests/latest.json', JSON.stringify({ date: '2026-09-25', pgSizeBytes: 400 * 1024 }));
  fake.seed(BK, 'pg/notes.txt', 'operator note');
  const { dir, dump } = makeWork('2026-09-26');
  const res = await run(fake, clock, envFor(dir));
  eq('exit 0', res.code, 0);
  const m = res.r && res.r.manifest;
  const stored = JSON.parse(fake.text(BK, 'manifests/2026-09-26.json') || '{}');
  eq('manifest stored = manifest returned', stored, m);
  eq('manifest format + status', [m.format, m.status], ['geo-backup-manifest/v1', 'complete']);
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
  const latest = JSON.parse(fake.text(BK, 'manifests/latest.json'));
  eq('latest pointer', [latest.format, latest.date, latest.manifestKey, latest.pgSizeBytes, latest.status],
    ['geo-backup-latest/v1', '2026-09-26', 'manifests/2026-09-26.json', dump.length, 'complete']);
  eq('manifest checks record the previous size', m.pg.checks.previousSizeBytes, 400 * 1024);
  // retention: 1st of Apr..Sep (monthly), Sundays Aug 30 / Sep 6 / Sep 13 (weekly), Sep 20..26 (daily),
  // Sep 19 (min-keep: Sep 24 is unfinished, so the 7 newest complete backups reach back to Sep 19).
  const keptExpected = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-08-30', '2026-09-01',
    '2026-09-06', '2026-09-13', '2026-09-19', ...range('2026-09-20', '2026-09-26')];
  const datesLeft = [...new Set(fake.current(BK).map((o) => lib.classifyKey(o.Key)).filter(Boolean).map((c) => c.date))].sort();
  eq('retention: dated folders left', datesLeft, keptExpected);
  ok('retention: purge used delete-markers only (no VersionId)', fake.calls.filter((c) => c.op === 'DeleteObject').every((c) => !c.input.VersionId));
  ok('retention: never touched docs/ nor latest nor unknown keys', fake.calls.filter((c) => c.op === 'DeleteObject').every((c) => lib.classifyKey(c.input.Key)) &&
    fake.text(BK, 'pg/notes.txt') === 'operator note' && fake.text(BK, 'manifests/latest.json'));
  ok('retention: purged versions are still there as noncurrent (lock/lifecycle expire them)', fake.b(BK).keys.get('pg/2026-03-02/geo.dump').length === 2);
  eq('retention: result', [res.r.purge.keptDates, res.r.purge.purgedDates.length], [17, 210 - 17]);
  noLeak('first run', res.logs, JSON.stringify(m));
  ok('verdict line', res.logs.some((l) => l.startsWith('VERDICT OK date=2026-09-26 status=complete')));
  ok('DB size logged (count only)', res.logs.some((l) => l.includes('db_size_bytes=123456789')));

  console.log('# runBackup — next day is incremental and idempotent');
  clock.t += 86400000;
  const w2 = makeWork('2026-09-27', { bytes: 310 * 1024 });
  const res2 = await run(fake, clock, envFor(w2.dir));
  eq('day 2 exit 0', res2.code, 0);
  eq('day 2 docs: nothing to copy', [res2.r.manifest.docs.copied, res2.r.manifest.docs.alreadyUpToDate], [0, 7]);
  ok('day 2 purge kept the Sunday + 6 previous days', res2.r.purge.purgedDates.every((d) => d < '2026-09-20') && !res2.r.purge.purgedDates.includes('2026-09-20'));
  noLeak('day 2', res2.logs);

  console.log('# runBackup — normalized/ object rewritten under the same key');
  clock.t += 86400000;
  const rewritten = DOC_KEYS[2];
  const before = fake.b(BK).keys.get(`docs/${rewritten}`).length;
  fake.seed(SRC, rewritten, 'doc-2-' + 'y'.repeat(42)); // same size, new content, newer LastModified
  clock.t += 60000;
  const res3 = await run(fake, clock, envFor(makeWork('2026-09-28', { bytes: 305 * 1024 }).dir));
  eq('day 3: only the rewritten object is copied', [res3.code, res3.r.manifest.docs.copied], [0, 1]);
  ok('…previous content kept as a noncurrent version (bucket versioning)', fake.b(BK).keys.get(`docs/${rewritten}`).length === before + 1 &&
    fake.text(BK, `docs/${rewritten}`) === fake.text(SRC, rewritten));
}

console.log('# runBackup — dump multipart above the threshold');
{
  const { clock, fake } = mkWorld();
  const { dir, dump } = makeWork('2026-09-26', { bytes: 300 * 1024 });
  const res = await run(fake, clock, envFor(dir), { overrides: { multipartThreshold: 100 * 1024, partSize: 64 * 1024 } });
  eq('exit 0', res.code, 0);
  eq('5 parts uploaded with Content-MD5', fake.calls.filter((c) => c.op === 'UploadPart').length, 5);
  eq('multipart object byte-exact', fake.latest(fake.b(BK), 'pg/2026-09-26/geo.dump').body.equals(dump), true);
  eq('manifest multipart flag', res.r.manifest.pg.multipart, true);
}

console.log('# runBackup — large source object: multipart server-side copy (UploadPartCopy)');
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
  eq('source rewritten during a multipart copy → exit 4, state failed', [res.code, invOf(fake).objects.find((o) => o.key === big).state], [4, 'failed']);
  ok('…upload aborted (no dangling multipart upload) and no docs/ object for it', fake.uploads.size === 0 && fake.text(BK, `docs/${big}`) === null &&
    fake.calls.some((c) => c.op === 'AbortMultipartUpload'));
  noLeak('multipart failure', res.logs);
}

console.log('# runBackup — refusals and degraded paths');
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
  const { dir } = makeWork('2026-09-26', { bytes: 70 * 1024 });
  const res = await run(fake, clock, envFor(dir, { MIN_DUMP_BYTES: '65536' }));
  eq('first run (no previous): only the 64 KiB floor applies → exit 0', res.code, 0);
}
{
  const { clock, fake } = mkWorld();
  const { dir, dump } = makeWork('2026-09-26');
  const res = await run(fake, clock, envFor(dir, { MIN_DUMP_BYTES: String(dump.length + 1) }));
  eq('dump < MIN_DUMP_BYTES → exit 2', res.code, 2);
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
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir, { COPY_CONCURRENCY: '1' }));
  eq('copy budget exhausted (seed) → manifest partial, exit 4', [res.code, res.r && res.r.manifest.status], [4, 'partial']);
  eq('…1 copied, 5 pending, budget flag', [res.r.manifest.docs.copied, res.r.manifest.docs.pending, res.r.manifest.docs.budgetExhausted], [1, 5, true]);
  ok('…PG backup still recorded and purge ran', !!fake.text(BK, 'pg/2026-09-26/geo.dump.sha256') && res.r.purge !== null);
  ok('verdict PARTIAL', res.logs.some((l) => l.startsWith('VERDICT PARTIAL')));
  // resume: the next run copies only what is still pending
  delete fake.hooks.CopyObject;
  clock.t += 3600e3;
  const res2 = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('…a later run resumes: 5 copied, complete, exit 0', [res2.code, res2.r.manifest.docs.copied, res2.r.manifest.status], [0, 5, 'complete']);
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.CopyObject = (input) => (input.Key.endsWith('x.json') ? s3err('InternalError', 500) : undefined);
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('one copy fails → exit 4, inventory state=failed', [res.code, invOf(fake).counts.failed], [4, 1]);
  noLeak('copy failure', res.logs);
}
{
  const { clock, fake } = mkWorld();
  fake.hooks.ListObjectsV2 = (input) => (input.Bucket === SRC ? s3err('AccessDenied', 403) : undefined);
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('source unreadable → exit 4, docs failed, PG recorded', [res.code, res.r.manifest.docs.status, !!res.r.manifest.pg.sha256], [4, 'failed', true]);
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
  fake.hooks.DeleteObject = () => s3err('InternalError', 500);
  for (const d of range('2026-01-01', '2026-01-10')) fake.seed(BK, `manifests/${d}.json`, '{}');
  const res = await run(fake, clock, envFor(makeWork('2026-09-26').dir));
  eq('purge failure after a complete manifest → exit 3', res.code, 3);
  ok('…manifest of the day is complete', JSON.parse(fake.text(BK, 'manifests/2026-09-26.json')).status === 'complete');
}
{
  const { clock, fake } = mkWorld();
  for (const d of range('2026-01-01', '2026-01-10')) fake.seed(BK, `manifests/${d}.json`, '{}');
  const cfg = { ...lib.readConfig(envFor('/w')), purgeDryRun: false };
  let code = null;
  try { await lib.purgeRetention({ cfg, sdk, s3: fake, now: () => clock.now(), log: () => {} }, '2026-09-26'); } catch (e) { code = e.exitCode; }
  eq('purge refuses to run when the manifest of today is not listed (exit 3)', code, 3);
  ok('…and deleted nothing', !fake.calls.some((c) => c.op === 'DeleteObject'));
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
console.log('# static wiring checks');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const active = (t) => t.split('\n').filter((l) => !/^\s*(#|\/\/)/.test(l)).join('\n');
const WRITER_KEYS = ['BACKUP_BUCKET', 'S3_ACCESS_KEY', 'S3_ENDPOINT', 'S3_REGION', 'S3_SECRET_KEY', 'SOURCE_BUCKET'];
const READER_KEYS = ['BACKUP_BUCKET', 'S3_ACCESS_KEY', 'S3_ENDPOINT', 'S3_REGION', 'S3_SECRET_KEY'];
const SEALED = 'deploy/ci/backup/geo-backup-sealedsecrets.yaml';
const cj = read('deploy/ci/backup/cronjob-backup-daily.yaml');
{
  const prodDump = read('deploy/ci/bascule-preprod/cronjob-db-backup-prod.yaml');
  const pinned = /image:\s*"(ghcr\.io\/rhanka\/geo-api@sha256:[0-9a-f]{64})"/.exec(prodDump)[1];
  ok('CronJob name/ns/schedule/Forbid/not suspended', /name: geo-backup-daily\n/.test(cj) && /namespace: geo\n/.test(cj) &&
    /schedule: "23 3 \* \* \*"/.test(cj) && /concurrencyPolicy: Forbid/.test(cj) && /suspend: false/.test(cj));
  ok('same geo-api digest as the bascule dump CronJob (no new image)', cj.includes(`image: "${pinned}"`) && cj.includes(`name: BACKUP_IMAGE, value: "${pinned}"`));
  ok('dump image = postgis/postgis:16-3.4 (= the postgis StatefulSet)', /image: postgis\/postgis:16-3\.4\n/.test(cj) &&
    /image: postgis\/postgis:16-3\.4/.test(read('deploy/k8s/postgis-statefulset.yaml')));
  ok('DB host/name as the bascule dump (geo-postgis.geo.svc, EXPECTED_DATABASE=geo)', /name: PGHOST, value: "geo-postgis\.geo\.svc"/.test(cj) &&
    (cj.match(/name: EXPECTED_DATABASE, value: "geo"/g) || []).length === 2);
  const podLabels = /template:\n\s+metadata:\n\s+labels:\n([\s\S]*?)\n\s+spec:/.exec(cj);
  ok('pod template carries role: pra-backup', !!podLabels && /^\s+role: pra-backup$/m.test(podLabels[1]));
  const np = read('deploy/ci/bascule-preprod/netpol-geo-db-backup.k8s-apply.yaml');
  ok('existing netpols select role: pra-backup (ingress postgis + egress), untouched by this job',
    /name: allow-geo-db-backup-to-postgis[\s\S]*?from:\s*\n\s*- podSelector:\s*\n\s*matchLabels:\s*\n\s*role: pra-backup/.test(np) &&
    /name: allow-geo-db-backup-egress[\s\S]*?spec:\s*\n\s*podSelector:\s*\n\s*matchLabels:\s*\n\s*role: pra-backup/.test(np));
  ok('egress is DNS/postgis/S3 only → PUBLIC_HEALTH_URL empty', /cidr: 54\.39\.60\.208\/32/.test(np) && /name: PUBLIC_HEALTH_URL, value: "" \}/.test(cj));
  ok('writer identity only (reader never mounted by the job)', /name: geo-backup-writer, key: S3_SECRET_KEY/.test(cj) && !cj.includes('geo-backup-reader'));
  const writerRefs = [...cj.matchAll(/secretKeyRef: \{ name: geo-backup-writer, key: ([A-Z_0-9]+) \}/g)].map((x) => x[1]).sort();
  eq('CronJob reads exactly the writer keys (SOURCE_BUCKET, not SOURCE_DOCS_BUCKET)', writerRefs, WRITER_KEYS);
  ok('DB via the RO role secret, never the superuser', /name: geo-db-ro-prod, key: POSTGRES_PASSWORD/.test(cj) && !active(cj).includes('geo-postgis-credentials'));
  ok('podFailurePolicy FailJob on 2/3/4', /values: \[2, 3, 4\]/.test(cj));
  ok('no python in any active line of the backup job', !/python|\.py\b/i.test(active(cj) + active(read('deploy/ci/backup/backup-daily.cjs'))));
  const cfgKeys = ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'BACKUP_BUCKET', 'SOURCE_BUCKET', 'EXPECTED_BACKUP_BUCKET',
    'EXPECTED_SOURCE_BUCKET', 'EXPECTED_DATABASE', 'WORK_DIR', 'PUBLIC_HEALTH_URL', 'DRIZZLE_JOURNAL', 'COPY_CONCURRENCY', 'DOCS_COPY_BUDGET_SECONDS',
    'DOCS_EXCLUDE_PREFIXES', 'COPY_MULTIPART_THRESHOLD_BYTES', 'COPY_PART_BYTES', 'MIN_DUMP_BYTES', 'MIN_DUMP_RATIO',
    'RETENTION_DAILY_DAYS', 'RETENTION_WEEKLY_WEEKS', 'RETENTION_MONTHLY_MONTHS', 'RETENTION_MIN_KEEP', 'PURGE_DRY_RUN'];
  ok('every runtime knob is set explicitly in the CronJob', cfgKeys.every((k) => cj.includes(`name: ${k},`)));
  const cfg = lib.readConfig(Object.fromEntries([...cj.matchAll(/\{ name: ([A-Z_0-9]+), value: "([^"]*)" \}/g)].map((x) => [x[1], x[2]])
    .concat([['S3_ENDPOINT', 'e'], ['S3_REGION', 'r'], ['S3_ACCESS_KEY', 'a'], ['S3_SECRET_KEY', 's'], ['BACKUP_BUCKET', BK], ['SOURCE_BUCKET', SRC]])));
  eq('CronJob values parse into the documented retention', cfg.retention, { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 6, minKeep: 7 });
  eq('CronJob guards: buckets + database', [cfg.expectedBackupBucket, cfg.expectedSourceBucket, cfg.expectedDatabase], [BK, SRC, DB]);
  eq('CronJob copy knobs: concurrency 8, 2 h budget, 64 KiB dump floor, ratio 0.5 from the 2nd run',
    [cfg.copyConcurrency, cfg.docsBudgetSeconds, cfg.minDumpBytes, cfg.minDumpRatio], [8, 7200, 65536, 0.5]);
  eq('excluded prefixes = frozen archive + rebuildable PMTiles only', cfg.excludePrefixes, [ARCHIVE, 'pmtiles/']);
  ok('irreplaceable prefixes are never excluded', ['raw/', 'capture/', 'sources/', 'registry/', 'normalized/']
    .every((p) => !cfg.excludePrefixes.some((x) => p.startsWith(x) || x.startsWith(p))));
  ok('docs budget fits the Job deadline', /activeDeadlineSeconds: 10800/.test(cj) && cfg.docsBudgetSeconds <= 10800 - 1800);
}
{
  if (fs.existsSync(path.join(ROOT, SEALED))) {
    const docs = read(SEALED).split(/^---\s*$/m).filter((d) => d.trim());
    const byName = Object.fromEntries(docs.map((d) => [(/^ {2}name: (\S+)$/m.exec(d) || [])[1], d]));
    const keys = (t) => [...t.matchAll(/^ {4}([A-Z_0-9]+): Ag/mg)].map((x) => x[1]).sort();
    const w = byName['geo-backup-writer'] || ''; const r = byName['geo-backup-reader'] || '';
    ok('SealedSecrets file: exactly writer + reader', docs.length === 2 && !!w && !!r);
    ok('writer SealedSecret kind/ns', /kind: SealedSecret/.test(w) && /name: geo-backup-writer\n\s+namespace: geo\n/.test(w));
    eq('writer keys', keys(w), WRITER_KEYS);
    ok('reader SealedSecret kind/ns', /kind: SealedSecret/.test(r) && /name: geo-backup-reader\n\s+namespace: geo\n/.test(r));
    eq('reader keys', keys(r), READER_KEYS);
  } else {
    console.log(`  PENDING ${SEALED} not committed yet (k8s-lane SealedSecrets, verbatim) — the CD guard refuses to apply until it is`);
  }
}
{
  const rbac = read('deploy/ci/bascule-preprod/rbac-ci-bascule-prod.yaml');
  ok('CD Role: backup SealedSecrets name-scoped', /resourceNames: \["geo-db-ro-prod", "geo-pra-writer-prod", "geo-backup-writer", "geo-backup-reader"\]/.test(rbac));
  ok('CD Role: backup script ConfigMap name-scoped', /resourceNames: \["geo-db-ro-role-sql", "geo-backup-daily-script"\]/.test(rbac));
  ok('CD Role: backup CronJob name-scoped', /resourceNames: \["geo-db-backup-prod", "geo-backup-daily"\]/.test(rbac));
  const wf = read('.github/workflows/bascule-bundle-cd.yml');
  const job = (/\n {2}apply-backup:\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|$)/.exec(wf) || [])[1] || '';
  ok('CD workflow: path trigger deploy/ci/backup/** + dispatch input backup_run_now', wf.includes("- 'deploy/ci/backup/**'") && /backup_run_now:/.test(wf));
  ok('CD apply-backup: same owner gate (needs approve, attempt-bound) + vault Environment geo-prod-bundle', /needs: approve/.test(job) &&
    /environment: geo-prod-bundle/.test(job) && /needs\.approve\.outputs\.attempt == github\.run_attempt/.test(job));
  ok('CD apply-backup: armed by BASCULE_BUNDLE_CD_ENABLED AND BACKUP_DAILY_CD_ENABLED', /vars\.BASCULE_BUNDLE_CD_ENABLED == 'true'/.test(job) &&
    /vars\.BACKUP_DAILY_CD_ENABLED == 'true'/.test(job));
  ok('CD apply-backup: guard refuses without the committed SealedSecrets, before any cluster call',
    job.includes('geo-backup-sealedsecrets.yaml') && job.indexOf('Guard') < job.indexOf('Configure kubeconfig'));
  ok('CD apply-backup: selftest gate before the kubeconfig', job.indexOf('backup-daily.selftest.mjs') > -1 && job.indexOf('backup-daily.selftest.mjs') < job.indexOf('Configure kubeconfig'));
  ok('CD apply-backup: applies SealedSecrets + script ConfigMap + CronJob, asserts the committed schedule',
    job.includes('geo-backup-daily-script') && job.includes('cronjob-backup-daily.yaml') && job.includes('"23 3 * * *|false|Forbid"'));
  const ci = read('.github/workflows/ci.yml');
  ok('CI runs this selftest', ci.includes('node deploy/ci/backup/backup-daily.selftest.mjs'));
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
