#!/usr/bin/env node
// =============================================================================
// restore-mode.selftest.mjs — selftest hors ligne de la bascule geo MODE=restore|list.
//
// 0 kubectl réel, 0 S3, 0 réseau. Couvre :
//   - backup-restore.cjs (in-pod) : fonctions pures + chaque étape (resolve, list,
//     docs, recon) contre un faux S3 VERSIONNÉ en mémoire, un client PAR IDENTITÉ
//     (lecteur / signataire de copie) : une lecture par la mauvaise identité est un
//     AccessDenied ; copie multipart au-delà de 5 GiB ; repli sans listing de versions ;
//   - le script tourne vraiment sous `node -e` (comme dans les Jobs) ;
//   - restore-mode.mjs (runner) : PIN, liste, message de fin, gardes #405 du Secret ;
//   - rendu des 2 templates (script embarqué récupéré à l'octet ; YAML parsé si `yaml`) ;
//   - câblage du workflow (MODE, jobs list/restore, environment geo-bascule, secrets
//     par env:, cycle-leg) ;
//   - la CLI réelle de bout en bout contre un faux `kubectl`.
//
//   node deploy/ci/bascule-preprod/restore-mode.selftest.mjs   → exit 0 si tout passe.
// =============================================================================
import { Buffer } from "node:buffer";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
  assertScriptEmbeddable, assertYamlSafeVars, BACKUP_SECRET_SPECS, backupSecretValues, basculeMode, buildSecretManifest, specsForMode, forbiddenDstBuckets, formatBackupTable, indentBlock, JOBS, keysOfReplaced,
  parseTermination, pickTerminationMessage, PINNED_S3_ENDPOINT, podOfJob, readerSecretValues, safeReason, validateBackupIdInput, validateCycleId,
  validateListing, validatePin,
} from "./restore-mode.mjs";
import { backupOfLeg, buildGeoLeg } from "./served-ids.mjs";
import { secretSpecsForMode } from "./restore-mode.mjs";
import {
  assertManifestNamespace, buildPgFailureSummary, PG_DEFAULTS, PG_JOBS, pgParams, POSTGIS_SECRET_KEYS, postgisSecretValues, PROD_NAMESPACES,
} from "./restore-pg.mjs";

const require = createRequire(import.meta.url);
const br = require("./backup-restore.cjs");
const DIR = import.meta.dirname;

let passed = 0;
let failed = 0;
const ok = (name, cond) => { if (cond) { passed += 1; console.log(`  ok   ${name}`); } else { failed += 1; console.log(`  FAIL ${name}`); } };
const eq = (name, a, b) => ok(`${name} (obtenu ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));
const throws = (name, fn) => { try { fn(); ok(name, false); } catch { ok(name, true); } };
const throwsCode = (name, fn, code) => { try { fn(); ok(name, false); } catch (e) { ok(`${name} (exit ${e.exitCode})`, e.exitCode === code); } };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const md5q = (b) => `"${createHash("md5").update(b).digest("hex")}"`;

// ═════════════════════════════ faux S3 versionné ══════════════════════════════
class Cmd { constructor(input) { this.input = input; } }
const sdk = {};
for (const n of ["GetObjectCommand", "HeadObjectCommand", "ListObjectsV2Command", "ListObjectVersionsCommand", "CopyObjectCommand",
  "CreateMultipartUploadCommand", "UploadPartCopyCommand", "CompleteMultipartUploadCommand", "AbortMultipartUploadCommand"]) {
  sdk[n] = { [n]: class extends Cmd {} }[n];
}
const denied = () => Object.assign(new Error("AccessDenied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
const notFound = () => Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
class Store {
  constructor() { this.b = new Map(); this.seq = 0; this.copies = []; this.mpu = new Map(); }
  put(bucket, key, body, lastModified, sizeOverride) {
    if (!this.b.has(bucket)) this.b.set(bucket, new Map());
    const m = this.b.get(bucket);
    if (!m.has(key)) m.set(key, []);
    const buf = Buffer.from(body);
    const v = { VersionId: `v${++this.seq}`, body: buf, ETag: md5q(buf), Size: sizeOverride ?? buf.length, LastModified: new Date(lastModified || "2026-09-26T04:00:00Z") };
    m.get(key).push(v);
    return v;
  }
  versions(bucket, key) { return (this.b.get(bucket) && this.b.get(bucket).get(key)) || []; }
  latest(bucket, key) { const v = this.versions(bucket, key); return v.length ? v[v.length - 1] : null; }
}
function client(store, policy) {
  const can = (op, bucket, key) => (policy[op] || []).some((e) => e === bucket || (key !== undefined && e.includes("/") &&
    e.slice(0, e.indexOf("/")) === bucket && key.startsWith(e.slice(e.indexOf("/") + 1))));
  const parseSrc = (s) => { const m = /^\/([^/]+)\/(.+?)(?:\?versionId=(.+))?$/.exec(s); return { b: m[1], k: decodeURIComponent(m[2]), v: m[3] ? decodeURIComponent(m[3]) : null }; };
  return {
    async send(cmd) {
      const i = cmd.input;
      if (cmd instanceof sdk.GetObjectCommand || cmd instanceof sdk.HeadObjectCommand) {
        if (!can("read", i.Bucket, i.Key)) throw denied();
        const v = i.VersionId ? store.versions(i.Bucket, i.Key).find((x) => x.VersionId === i.VersionId) : store.latest(i.Bucket, i.Key);
        if (!v) throw notFound();
        if (cmd instanceof sdk.HeadObjectCommand) return { ContentLength: v.Size, ETag: v.ETag, VersionId: v.VersionId };
        const body = v.body;
        return { VersionId: v.VersionId, Body: (async function* gen() { yield body.subarray(0, 5); yield body.subarray(5); })() };
      }
      if (cmd instanceof sdk.ListObjectsV2Command) {
        if (!can("list", i.Bucket)) throw denied();
        const m = store.b.get(i.Bucket) || new Map();
        const all = [...m.keys()].filter((k) => !i.Prefix || k.startsWith(i.Prefix)).sort().map((k) => { const v = store.latest(i.Bucket, k); return { Key: k, Size: v.Size, ETag: v.ETag }; });
        const start = i.ContinuationToken ? Number(i.ContinuationToken) : 0;
        const more = start + 2 < all.length;
        return { Contents: all.slice(start, start + 2), IsTruncated: more, NextContinuationToken: more ? String(start + 2) : undefined };
      }
      if (cmd instanceof sdk.ListObjectVersionsCommand) {
        if (!can("listVersions", i.Bucket)) throw denied();
        const m = store.b.get(i.Bucket) || new Map();
        const all = [];
        for (const k of [...m.keys()].filter((x) => !i.Prefix || x.startsWith(i.Prefix)).sort()) for (const v of m.get(k)) all.push({ Key: k, ...v, body: undefined });
        const start = i.KeyMarker ? Number(i.KeyMarker) : 0;
        const more = start + 3 < all.length;
        return { Versions: all.slice(start, start + 3), IsTruncated: more, NextKeyMarker: more ? String(start + 3) : undefined, NextVersionIdMarker: more ? "x" : undefined };
      }
      if (cmd instanceof sdk.CopyObjectCommand) {
        const s = parseSrc(i.CopySource);
        if (!can("read", s.b, s.k) || !can("write", i.Bucket)) throw denied();
        const v = s.v ? store.versions(s.b, s.k).find((x) => x.VersionId === s.v) : store.latest(s.b, s.k);
        if (!v) throw notFound();
        if (v.Size > 5 * 1024 ** 3) throw Object.assign(new Error("EntityTooLarge"), { name: "EntityTooLarge" });
        store.copies.push({ key: i.Key, from: s.k, fromBucket: s.b, versionId: s.v, grant: i.GrantFullControl || null, multipart: false });
        store.put(i.Bucket, i.Key, v.body, "2026-09-27T05:00:00Z", v.Size);
        return {};
      }
      if (cmd instanceof sdk.CreateMultipartUploadCommand) {
        if (!can("write", i.Bucket)) throw denied();
        const id = `mpu${store.seq++}`; store.mpu.set(id, { parts: 0, grant: i.GrantFullControl || null }); return { UploadId: id };
      }
      if (cmd instanceof sdk.UploadPartCopyCommand) {
        const s = parseSrc(i.CopySource);
        if (!can("read", s.b, s.k)) throw denied();
        store.mpu.get(i.UploadId).parts += 1; store.mpu.get(i.UploadId).src = s; return { CopyPartResult: { ETag: `"p${i.PartNumber}"` } };
      }
      if (cmd instanceof sdk.CompleteMultipartUploadCommand) {
        const u = store.mpu.get(i.UploadId);
        const v = store.versions(u.src.b, u.src.k).find((x) => x.VersionId === u.src.v) || store.latest(u.src.b, u.src.k);
        store.copies.push({ key: i.Key, from: u.src.k, fromBucket: u.src.b, versionId: u.src.v, grant: u.grant, multipart: true, parts: i.MultipartUpload.Parts.length });
        store.put(i.Bucket, i.Key, v.body, "2026-09-27T05:00:00Z", v.Size);
        return {};
      }
      if (cmd instanceof sdk.AbortMultipartUploadCommand) return {};
      throw new Error("commande inattendue");
    },
  };
}

// ═════════════════════════════ fixture : backup geo du jour D ═════════════════
const B = "geo-backup";
const DST = "sentropic-geo-preprod";
const PROD = "sentropic-geo";
const D = "2026-09-26";
const D1 = "2026-09-25";
const DB = "geo";
const P = "normalized/";
const NOW_FRESH = Date.parse("2026-09-26T12:00:00Z");
const NOW_STALE = Date.parse("2026-09-27T08:00:00Z");
const BIG = 6 * 1024 ** 3;
function fixture({ tamperDump = false, rewriteAfterD = true } = {}) {
  const s = new Store();
  const dump = Buffer.from("PGDMP-geo-custom-archive-0123456789");
  const dumpV = s.put(B, `pg/${D}/${DB}.dump`, tamperDump ? Buffer.concat([dump, Buffer.from("!")]) : dump);
  s.put(B, `pg/${D}/${DB}.dump.sha256`, `${sha(dump)}  ${DB}.dump\n`);
  const a = s.put(B, `docs/${P}laval/zones.parquet`, "AAAA", "2026-09-20T01:00:00Z");
  const bD = s.put(B, `docs/${P}montreal/zones.parquet`, "BBBB-at-D", "2026-09-21T01:00:00Z");
  const big = s.put(B, `docs/${P}qc/lots.pmtiles`, "BIG-body", "2026-09-22T01:00:00Z", BIG);
  s.put(B, "docs/raw/cas/abc", "RAW-not-served", "2026-09-22T01:00:00Z");
  if (rewriteAfterD) s.put(B, `docs/${P}montreal/zones.parquet`, "BBBB-rewritten-later!", "2026-09-28T01:00:00Z");
  const inventory = {
    format: "geo-backup-docs-inventory/v1", date: D, createdAt: "2026-09-26T04:40:00.000Z", counts: { objects: 4 },
    objects: [
      { key: `${P}laval/zones.parquet`, size: a.Size, etag: a.ETag, state: "backed-up", backupEtag: a.ETag, versionId: a.VersionId },
      { key: `${P}montreal/zones.parquet`, size: bD.Size, etag: bD.ETag, state: "backed-up", backupEtag: bD.ETag, versionId: null },
      { key: `${P}qc/lots.pmtiles`, size: BIG, etag: big.ETag, state: "backed-up", backupEtag: big.ETag, versionId: big.VersionId },
      { key: "raw/cas/abc", size: 14, etag: '"x"', state: "excluded", backupEtag: null, versionId: null },
    ],
  };
  const invBuf = Buffer.from(JSON.stringify(inventory));
  s.put(B, `docs-inventory/${D}.json`, invBuf);
  const manifest = {
    format: "geo-backup-manifest/v1", date: D, status: "complete", verdict: "OK", startedAt: "2026-09-26T03:23:00Z", completedAt: "2026-09-26T04:41:00Z",
    pg: { database: DB, key: `pg/${D}/${DB}.dump`, sha256: sha(dump), sizeBytes: dump.length, versionId: dumpV.VersionId, dumpStartedAt: "2026-09-26T03:23:05Z", tocEntries: 24 },
    docs: { status: "complete", objects: 4, inventoryKey: `docs-inventory/${D}.json`, inventorySha256: sha(invBuf) },
  };
  const manBuf = Buffer.from(JSON.stringify(manifest, null, 2));
  s.put(B, `manifests/${D}.json`, manBuf);
  s.put(B, `manifests/${D1}.json`, JSON.stringify({ ...manifest, date: D1, status: "partial", pg: { ...manifest.pg, key: `pg/${D1}/${DB}.dump` } }));
  s.put(B, "manifests/latest.json", JSON.stringify({ format: "geo-backup-latest/v1", date: D, status: "complete", manifestKey: `manifests/${D}.json`,
    manifestSha256: sha(manBuf), latestComplete: { date: D, manifestKey: `manifests/${D}.json`, manifestSha256: sha(manBuf) } }));
  s.put(DST, `${P}montreal/zones.parquet`, "BBBB-rewritten-later!");
  s.put(DST, `${P}extra-newer.parquet`, "E");
  return { s, dump, manifest, manSha: sha(manBuf) };
}
const readerPolicy = { read: [B], list: [B] }; // geo-backup-reader-preprod : pg/, manifests/, docs-inventory/, docs/
const copierPolicy = { read: [`${B}/docs/`], listVersions: [B], list: [DST], write: [DST] };
const copierNoVersions = { read: [`${B}/docs/`], list: [DST], write: [DST] };
const baseEnv = (extra = {}) => ({ S3_ENDPOINT: "s3.bhs.io.cloud.ovh.net", PINNED_S3_ENDPOINT, S3_REGION: "bhs", READER_ACCESS_KEY: "r", READER_SECRET_KEY: "r",
  BACKUP_BUCKET: B, EXPECTED_BACKUP_BUCKET: B, EXPECTED_DATABASE: DB, ...extra });
const tmp = mkdtempSync(join(tmpdir(), "geo-restore-selftest-"));
let tn = 0;
async function step({ s, env, now = NOW_FRESH, copier = copierPolicy }) {
  const term = join(tmp, `t${++tn}.json`);
  const logs = [];
  let r = null; let err = null;
  try { r = await br.runStep({ env: { ...env, TERMINATION_LOG: term }, sdk, clients: { reader: client(s, readerPolicy), copier: client(s, copier) }, now: () => now, log: (m) => logs.push(m) }); } catch (e) { err = e; }
  return { r, t: existsSync(term) ? JSON.parse(readFileSync(term, "utf8")) : null, logs, code: err ? err.exitCode ?? 1 : r.exitCode };
}
const docsEnv = (manSha, extra = {}) => baseEnv({ BR_STEP: "docs", BACKUP_DATE: D, PIN_MANIFEST_SHA256: manSha, COPIER_ACCESS_KEY: "c", COPIER_SECRET_KEY: "c",
  DST_BUCKET: DST, FORBIDDEN_DST_BUCKETS: PROD, DOCS_RESTORE_PREFIX: P, COPY_GRANTEE: "1901410700457444:g", COPY_CONCURRENCY: "2", ...extra });

// ═════════════════════════════ fonctions pures (in-pod) ═══════════════════════
eq("parseBackupId — latest par défaut", br.parseBackupId("", D).kind, "latest");
throwsCode("parseBackupId — injection refusée", () => br.parseBackupId('x"; rm', D), 2);
throwsCode("parseBackupId — futur refusé", () => br.parseBackupId("2026-12-01", D), 2);
eq("keysFor — dump pg/<D>/geo.dump", br.keysFor(D, DB).dump, `pg/${D}/geo.dump`);
eq("chooseDate — latestComplete + son manifestSha256", br.chooseDate({ kind: "latest" }, { date: "2026-09-27", latestComplete: { date: D, manifestKey: `manifests/${D}.json`, manifestSha256: "a".repeat(64) } }, DB),
  { date: D, source: "latestComplete", pointerSha256: "a".repeat(64) });
{
  const { manifest } = fixture();
  throwsCode("checkManifest — partial refusé", () => br.checkManifest({ ...manifest, status: "partial" }, D, DB), 2);
  throwsCode("checkManifest — format immo refusé", () => br.checkManifest({ ...manifest, format: "radar-backup-manifest/v1" }, D, DB), 2);
  throwsCode("staleGuard — latest > 24 h refusé", () => br.staleGuard({ parsed: { kind: "latest" }, manifest, nowMs: NOW_STALE }), 2);
  eq("staleGuard — date explicite non bloquante", br.staleGuard({ parsed: { kind: "date", date: D }, manifest, nowMs: NOW_STALE }).blocking, false);
  eq("partRanges — 6 GiB en parts de 512 MiB", br.partRanges(BIG).length, 12);
}
throwsCode("readConfig — endpoint non figé refusé", () => br.readConfig(baseEnv({ S3_ENDPOINT: "https://evil.example" }), "resolve"), 2);
throwsCode("readConfig — écriture dans la prod refusée", () => br.readConfig(docsEnv("a".repeat(64), { DST_BUCKET: PROD }), "docs"), 2);
throwsCode("readConfig — préfixe invalide refusé", () => br.readConfig(docsEnv("a".repeat(64), { DOCS_RESTORE_PREFIX: "../" }), "docs"), 2);
throwsCode("readConfig — liste interdite vide refusée (jamais « rien d'interdit »)", () => br.readConfig(docsEnv("a".repeat(64), { FORBIDDEN_DST_BUCKETS: " , " }), "recon"), 2);
throwsCode("readConfig — sentropic-geo figé interdit même absent de la liste", () => br.readConfig(docsEnv("a".repeat(64), { DST_BUCKET: "sentropic-geo", FORBIDDEN_DST_BUCKETS: "autre-bucket" }), "docs"), 2);
throwsCode("readConfig — geo-backup figé interdit même avec un autre bucket de backup", () => br.readConfig(docsEnv("a".repeat(64), { DST_BUCKET: "geo-backup", BACKUP_BUCKET: "geo-backup-2", EXPECTED_BACKUP_BUCKET: "geo-backup-2" }), "docs"), 2);
eq("HARD_FORBIDDEN_DST_BUCKETS — sentropic-geo + geo-backup", br.HARD_FORBIDDEN_DST_BUCKETS, ["sentropic-geo", "geo-backup"]);
{
  // `excluded` (préfixe écarté par le backup, backup toujours complet) : non exigé, compté à part ; pending bloque toujours.
  const entries = [{ key: `${P}archive/old.parquet`, size: 9, state: "excluded" }, { key: `${P}laval/zones.parquet`, size: 2, etag: '"e"', backupEtag: '"e"', state: "backed-up" }];
  const dest = new Map([[`${P}laval/zones.parquet`, { Size: 2, ETag: '"e"' }]]);
  const plan = br.planDocsRestore({ entries, createdAt: "2026-09-26T04:40:00Z", versionsIndex: new Map(), destIndex: dest });
  eq("planDocsRestore — excluded ignoré (pas un refus), compté à part", [plan.excluded, plan.notInBackup, plan.unresolved, plan.upToDate], [1, 0, 0, 1]);
  const rec = br.reconInventory(entries, dest, P);
  eq("reconInventory — excluded non exigé, compté à part", [rec.ok, rec.excluded, rec.notInBackup, rec.extra], [true, 1, 0, 0]);
  eq("planDocsRestore — pending bloque toujours (notInBackup)", br.planDocsRestore({ entries: [{ key: `${P}p`, size: 1, state: "pending" }], createdAt: "2026-09-26T04:40:00Z", versionsIndex: new Map(), destIndex: new Map() }).notInBackup, 1);
}
eq("forbiddenDstBuckets — sentropic-geo figé + PROD_DOCS + bucket de backup, dédoublonnés", forbiddenDstBuckets({ prodDocs: PROD, backupBucket: B }), `${PROD},${B}`);
throws("forbiddenDstBuckets — PROD_DOCS vide refusé", () => forbiddenDstBuckets({ prodDocs: "", backupBucket: B }));

// ═════════════════════════════ étapes contre le faux S3 ═══════════════════════
async function suite() {
  {
    const { s, manSha, dump } = fixture();
    const r = await step({ s, env: baseEnv({ BR_STEP: "resolve" }) });
    eq("resolve latest — exit 0, PIN, dump sha256 recalculé", [r.code, r.t.date, r.t.manifestSha256 === manSha, r.t.pgSha256 === sha(dump), r.t.dumpShaRecomputed], [0, D, true, true, true]);
    eq("validatePin — accepte le verdict", validatePin(r.t).date, D);
    eq("resolve latest > 24 h — refusé", (await step({ s, env: baseEnv({ BR_STEP: "resolve" }), now: NOW_STALE })).code, 2);
    eq("resolve latest > 24 h + ALLOW_STALE_BACKUP — accepté", (await step({ s, env: baseEnv({ BR_STEP: "resolve", ALLOW_STALE_BACKUP: "true" }), now: NOW_STALE })).code, 0);
    eq("resolve date explicite ancienne — acceptée", (await step({ s, env: baseEnv({ BR_STEP: "resolve", BACKUP_ID: D }), now: NOW_STALE })).code, 0);
    eq("resolve backup partial — refusé", (await step({ s, env: baseEnv({ BR_STEP: "resolve", BACKUP_ID: D1 }) })).code, 2);
    const l = await step({ s, env: baseEnv({ BR_STEP: "list" }) });
    eq("list — 2 backups, tenant geo", [l.code, l.t.count, l.t.tenant], [0, 2, "geo"]);
    ok("formatBackupTable — dernier complet marqué", formatBackupTable(validateListing(l.t)).text.includes(`${D} *`));
  }
  {
    const { s } = fixture({ tamperDump: true });
    eq("resolve — dump altéré (sha256 recalculé) ⇒ échec", (await step({ s, env: baseEnv({ BR_STEP: "resolve" }) })).code, 1);
  }
  // fetch-dump (initContainer de la restauration PG, S2)
  {
    const { s, manSha, dump } = fixture();
    const work = join(tmp, "fetch-ok");
    const r = await step({ s, env: baseEnv({ BR_STEP: "fetch-dump", BACKUP_DATE: D, PIN_MANIFEST_SHA256: manSha, PIN_PG_SHA256: sha(dump), WORK_DIR: work }) });
    eq("fetch-dump — exit 0, octets du dump identiques", [r.code, existsSync(join(work, `${DB}.dump`)) && readFileSync(join(work, `${DB}.dump`)).equals(dump)], [0, true]);
    const envf = readFileSync(join(work, "backup.env"), "utf8");
    ok("fetch-dump — backup.env : date, sha256, TOC attendu (24, manifeste), base, fichier", envf.includes(`BACKUP_DATE=${D}\n`) && envf.includes(`PG_SHA256=${sha(dump)}\n`) &&
      envf.includes("EXPECTED_TOC_ENTRIES=24\n") && envf.includes(`DUMP_DATABASE=${DB}\n`) && envf.includes(`DUMP_FILE=${DB}.dump\n`));
    eq("fetch-dump — message de fin (sha256, taille, TOC)", [r.t.ok, r.t.pgSha256 === sha(dump), r.t.expectedTocEntries], [true, true, 24]);
    eq("fetch-dump — manifeste modifié depuis resolve (PIN) ⇒ refus", (await step({ s, env: baseEnv({ BR_STEP: "fetch-dump", BACKUP_DATE: D, PIN_MANIFEST_SHA256: "c".repeat(64), PIN_PG_SHA256: sha(dump), WORK_DIR: join(tmp, "f2") }) })).code, 2);
    eq("fetch-dump — PIN du dump différent du manifeste ⇒ refus", (await step({ s, env: baseEnv({ BR_STEP: "fetch-dump", BACKUP_DATE: D, PIN_MANIFEST_SHA256: manSha, PIN_PG_SHA256: "d".repeat(64), WORK_DIR: join(tmp, "f3") }) })).code, 2);
    throwsCode("readConfig fetch-dump — PIN_PG_SHA256 invalide refusé", () => br.readConfig(baseEnv({ BACKUP_DATE: D, PIN_MANIFEST_SHA256: manSha, PIN_PG_SHA256: "x" }), "fetch-dump"), 2);
  }
  {
    const { s, manSha, dump } = fixture({ tamperDump: true });
    eq("fetch-dump — dump altéré (taille/sha256) ⇒ restauration refusée", (await step({ s, env: baseEnv({ BR_STEP: "fetch-dump", BACKUP_DATE: D, PIN_MANIFEST_SHA256: manSha, PIN_PG_SHA256: sha(dump), WORK_DIR: join(tmp, "f4") }) })).code, 1);
  }
  {
    const { s, manSha } = fixture();
    const dry = await step({ s, env: docsEnv(manSha, { DOCS_DRY: "1" }) });
    eq("docs DRY — plan normalized/ : 3 à copier, raw/ exclu du périmètre, 0 copie", [dry.code, dry.t.inventory, dry.t.toCopy, s.copies.length], [0, 3, 3, 0]);
    const r = await step({ s, env: docsEnv(manSha) });
    eq("docs — exit 0, 3 copies, recon ok", [r.code, r.t.copied, r.t.recon.ok], [0, 3, true]);
    ok("docs — montreal restauré à son contenu du jour D", s.latest(DST, `${P}montreal/zones.parquet`).body.toString() === "BBBB-at-D");
    const mp = s.copies.find((c) => c.key === `${P}qc/lots.pmtiles`);
    ok("docs — objet > 5 GiB copié en multipart (12 parts, version épinglée, grant)", mp && mp.multipart && mp.parts === 12 && mp.versionId && mp.grant === "id=1901410700457444:g");
    ok("docs — additif : objet préprod postérieur conservé", !!s.latest(DST, `${P}extra-newer.parquet`));
    ok("docs — correspondance des clés : geo-backup/docs/normalized/X → sentropic-geo-preprod/normalized/X (préfixe docs/ retiré)",
      s.copies.length === 3 && s.copies.every((c) => c.fromBucket === B && c.from === `docs/${c.key}` && c.key.startsWith(P) && !c.key.startsWith("docs/")) &&
      [...s.b.get(DST).keys()].every((k) => !k.startsWith("docs/")));
    ok("docs — grant = COPY_GRANTEE (paramètre), sur chaque copie", s.copies.every((c) => c.grant === "id=1901410700457444:g"));
    ok("docs — logs sans clé d'objet", !r.logs.join("\n").includes("zones.parquet"));
    eq("recon — préprod ⊇ inventaire(D) (normalized/)", (await step({ s, env: { ...docsEnv(manSha), BR_STEP: "recon" } })).code, 0);
  }
  {
    const { s, manSha } = fixture();
    const r = await step({ s, env: docsEnv(manSha), copier: copierNoVersions });
    eq("docs — sans listing de versions + objet réécrit depuis D ⇒ refus avant toute copie", [r.code, s.copies.length], [2, 0]);
  }
  {
    const { s, manSha } = fixture({ rewriteAfterD: false });
    const r = await step({ s, env: docsEnv(manSha), copier: copierNoVersions });
    eq("docs — sans listing, courant = contenu de D ⇒ versionIds enregistrés + HEAD vérifié", [r.code, r.t.copied], [0, 3]);
  }
  {
    const { s, manSha } = fixture();
    const wrong = await br.runStep({ env: { ...docsEnv(manSha), TERMINATION_LOG: join(tmp, "w.json") }, sdk,
      clients: { reader: client(s, readerPolicy), copier: client(s, readerPolicy) }, now: () => NOW_FRESH, log: () => {} }).then((x) => x.exitCode, (e) => e.exitCode ?? 1);
    eq("docs — lecteur (sans écriture préprod) comme signataire ⇒ échec (séparation des identités)", wrong, 1);
  }
}

// ═════════════════════════════ runner (fonctions pures) ═══════════════════════
eq("basculeMode — chain par défaut", basculeMode({}), "chain");
throws("validateBackupIdInput — guillemet refusé", () => validateBackupIdInput('2026-09-26"', D));
eq("validateCycleId — id orchestrateur", validateCycleId("iso-prod-2026-09-27-abc"), "iso-prod-2026-09-27-abc");
throws("assertYamlSafeVars — guillemet refusé", () => assertYamlSafeVars({ X: 'a"b' }));
ok("safeReason — ni commande workflow ni saut de ligne", !/::|\n/.test(safeReason("a\n::error::x")));
{
  const U1 = "11111111-1111-4111-8111-111111111111";
  const U0 = "00000000-0000-4000-8000-000000000000";
  const own = (uid) => [{ kind: "Job", uid, controller: true }];
  const pods = { items: [
    { metadata: { creationTimestamp: "1", ownerReferences: own(U1) }, status: { containerStatuses: [{ name: "read", state: { terminated: { message: '{"ok":false}' } } }] } },
    { metadata: { creationTimestamp: "2", ownerReferences: own(U1) }, status: { containerStatuses: [{ name: "read", state: { terminated: { message: '{"ok":true}' } } }] } },
    // pod d'une instance PRÉCÉDENTE du même Job (supprimée, encore listée), le plus récent de tous
    { metadata: { creationTimestamp: "3", ownerReferences: own(U0), labels: { "batch.kubernetes.io/controller-uid": U0 } }, status: { containerStatuses: [{ name: "read", state: { terminated: { message: '{"ok":true,"stale":1}' } } }] } }] };
  eq("pickTerminationMessage — pod le plus récent DE CETTE instance du Job", parseTermination(pickTerminationMessage(pods, "read", U1)), { ok: true });
  eq("pickTerminationMessage — pod d'une instance précédente jamais lu", pickTerminationMessage({ items: [pods.items[2]] }, "read", U1), null);
  eq("pickTerminationMessage — sans uid du Job ⇒ rien lu (aucun repli)", pickTerminationMessage(pods, "read", null), null);
  ok("podOfJob — label controller-uid (historique ou batch.kubernetes.io) accepté", podOfJob({ metadata: { labels: { "controller-uid": U1 } } }, U1) &&
    podOfJob({ metadata: { labels: { "batch.kubernetes.io/controller-uid": U1 } } }, U1) && !podOfJob({ metadata: { labels: { "controller-uid": U0 } } }, U1));
}
{
  const AK = "ABCDEFGH12345678abcd";
  const SK = "abc/DEF+ghi=1234567890xyz";
  const env = { GEO_BACKUP_READER_PREPROD_ACCESS_KEY: AK, GEO_BACKUP_READER_PREPROD_SECRET_KEY: SK, BACKUP_BUCKET: B, S3_ENDPOINT_RENDERED: PINNED_S3_ENDPOINT };
  eq("readerSecretValues — clés EXACTES du Secret pré-créé", Object.keys(readerSecretValues(env)).sort(), ["BACKUP_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"]);
  const denv = { ...env, GEO_BACKUP_RESTORE_DOCS_ACCESS_KEY: "ZZZZZZZZ12345678abcd", GEO_BACKUP_RESTORE_DOCS_SECRET_KEY: "zzz/YYY+xxx=0987654321abc" };
  eq("backupSecretValues — signataire S3' : mêmes clés, depuis GEO_BACKUP_RESTORE_DOCS_*", [Object.keys(backupSecretValues(denv, "restore-docs")).sort(), backupSecretValues(denv, "restore-docs").S3_ACCESS_KEY],
    [["BACKUP_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"], "ZZZZZZZZ12345678abcd"]);
  throws("backupSecretValues — signataire : secret GitHub absent ⇒ fail-closed", () => backupSecretValues(env, "restore-docs"));
  eq("specsForMode — list : lecteur ; restore : lecteur + signataire", [specsForMode("list"), specsForMode("restore"), specsForMode("chain")], [["reader"], ["reader", "restore-docs"], []]);
  eq("BACKUP_SECRET_SPECS — noms par défaut", Object.values(BACKUP_SECRET_SPECS).map((x) => x.defaultName), ["geo-backup-reader-preprod", "geo-backup-restore-docs"]);
  throws("readerSecretValues — secret GitHub absent ⇒ fail-closed", () => readerSecretValues({ ...env, GEO_BACKUP_READER_PREPROD_SECRET_KEY: "" }));
  throws("readerSecretValues — format #405 violé ⇒ fail-closed", () => readerSecretValues({ ...env, GEO_BACKUP_READER_PREPROD_ACCESS_KEY: "bad key!" }));
  throws("readerSecretValues — multi-ligne ⇒ fail-closed", () => readerSecretValues({ ...env, GEO_BACKUP_READER_PREPROD_SECRET_KEY: `${SK}\nx` }));
  throws("readerSecretValues — endpoint non figé ⇒ fail-closed", () => readerSecretValues({ ...env, S3_ENDPOINT_RENDERED: "https://other" }));
  try { readerSecretValues({ ...env, GEO_BACKUP_READER_PREPROD_ACCESS_KEY: "bad key!" }); } catch (e) { ok("readerSecretValues — l'erreur nomme la variable, jamais la valeur", !e.message.includes("bad key!")); }
  const man = buildSecretManifest({ name: "geo-backup-reader-preprod", namespace: "geo-preprod", values: readerSecretValues(env) });
  eq("buildSecretManifest — Opaque, base64, sans ownerReferences", [man.type, man.data.S3_ACCESS_KEY, !!man.metadata.ownerReferences], ["Opaque", Buffer.from(AK).toString("base64"), false]);
  eq("keysOfReplaced — noms des clés seulement", keysOfReplaced(JSON.stringify({ data: { S3_SECRET_KEY: "x", BACKUP_BUCKET: "y", S3_ACCESS_KEY: "z" } })), "BACKUP_BUCKET S3_ACCESS_KEY S3_SECRET_KEY");
}
{
  const leg = buildGeoLeg({ cycleId: "c1", runId: "9", gitSha: "abcdef0", t1: null, pgResult: "success", s3Result: "success", servedIdsSha256: null, mode: "restore",
    backup: { id: D, date: D, manifestSha256: "a".repeat(64), pgSha256: "b".repeat(64), dumpStartedAt: "2026-09-26T03:23:05Z" } });
  eq("buildGeoLeg — MODE=restore : backup.date + t1 = début du dump", [leg.mode, leg.backup.date, leg.t1], ["restore", D, "2026-09-26T03:23:05.000Z"]);
  eq("backupOfLeg — MODE=chain ⇒ null", backupOfLeg("chain", { date: D }), null);
  throws("buildGeoLeg — MODE=list refusé", () => buildGeoLeg({ cycleId: "c1", runId: "9", gitSha: "abcdef0", mode: "list" }));
}

// ═════════════════════════════ script sous `node -e` + templates ══════════════
const SCRIPT = readFileSync(join(DIR, "backup-restore.cjs"), "utf8");
ok("backup-restore.cjs — embarquable (aucun motif ${MAJ})", assertScriptEmbeddable(SCRIPT));
{
  const term = join(tmp, "node-e.json");
  const r = spawnSync(process.execPath, ["-e", SCRIPT], { cwd: tmp, env: { PATH: process.env.PATH, BR_STEP: "resolve", TERMINATION_LOG: term }, encoding: "utf8" });
  const t = existsSync(term) ? JSON.parse(readFileSync(term, "utf8")) : null;
  eq("node -e — main déclenché, exit 1 sans SDK, verdict écrit", [r.status, t && t.ok], [1, false]);
}
let YAML = null;
try { YAML = (await import("yaml")).default; } catch { YAML = null; }
function render(tmpl, vars) {
  let text = readFileSync(join(DIR, tmpl), "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.split(`\${${k}}`).join(v);
  return { text, leftover: text.match(/\$\{[A-Z0-9_]+\}/g) };
}
const common = { NAMESPACE: "geo-preprod", IMAGE: "ghcr.io/rhanka/geo-api@sha256:" + "a".repeat(64), READER_SECRET: "geo-backup-reader-preprod", S3_ENDPOINT: PINNED_S3_ENDPOINT,
  PINNED_S3_ENDPOINT, S3_REGION: "bhs", S3_FORCE_PATH_STYLE: "true", EXPECTED_BACKUP_BUCKET: B, EXPECTED_DATABASE: DB, TTL_SECONDS: "3600", BR_SCRIPT: indentBlock(SCRIPT, 14) };
for (const [tmpl, vars] of Object.entries({
  "backup-read-job.tmpl.yaml": { ...common, JOB_NAME: JOBS.resolve, BR_STEP: "resolve", BACKUP_ID: "latest", ALLOW_STALE_BACKUP: "false", MAX_AGE_HOURS: "24", VERIFY_DUMP_SHA256: "true" },
  "docs-restore-backup-job.tmpl.yaml": { ...common, JOB_NAME: JOBS.docs, BR_STEP: "docs", COPY_SECRET: "geo-backup-restore-docs", BACKUP_DATE: D, PIN_MANIFEST_SHA256: "a".repeat(64),
    DST_BUCKET: DST, FORBIDDEN_DST_BUCKETS: PROD, DOCS_RESTORE_PREFIX: P, COPY_GRANTEE: "g", COPY_CONCURRENCY: "8", DOCS_DRY: "0" },
})) {
  const { text, leftover } = render(tmpl, vars);
  ok(`${tmpl} — aucun placeholder résiduel`, !leftover);
  const m = text.match(/command: \["node", "-e"\]\n {10}args:\n {12}- \|\n([\s\S]*?)\n {10}env:/);
  ok(`${tmpl} — script embarqué récupéré à l'octet`, m && m[1].split("\n").map((l) => l.replace(/^ {14}/, "")).join("\n").trimEnd() === SCRIPT.trimEnd());
  ok(`${tmpl} — label geo-preprod-sync (netpol allow-geo-sync-egress)`, /app\.kubernetes\.io\/name: geo-preprod-sync/.test(text));
  if (YAML) {
    const pod = YAML.parse(text).spec.template.spec;
    ok(`${tmpl} — YAML valide, automount désactivé`, pod.containers[0].args[0].trimEnd() === SCRIPT.trimEnd() && pod.automountServiceAccountToken === false);
  }
}

// ═════════════════════════════ restauration PG (S2 + G1) ══════════════════════
{
  const q = pgParams({}, { namespace: "geo-preprod", db: DB });
  eq("pgParams — défauts = noms confirmés par k8s", [q.service, q.secret, q.statefulset, q.image, q.snapshotDb],
    ["geo-postgis", "geo-postgis-credentials", "postgis", "postgis/postgis:16-3.4", "geo_pra_rollback"]);
  throws("pgParams — namespace de PRODUCTION `geo` refusé", () => pgParams({}, { namespace: "geo", db: DB }));
  ok("PROD_NAMESPACES — `geo`", PROD_NAMESPACES.includes("geo"));
  throws("pgParams — PG_SERVICE en FQDN (geo-postgis.geo) refusé : nom court seulement", () => pgParams({ PG_SERVICE: "geo-postgis.geo" }, { namespace: "geo-preprod", db: DB }));
  throws("pgParams — snapshot = base cible refusé", () => pgParams({ PG_SNAPSHOT_DB: DB }, { namespace: "geo-preprod", db: DB }));
  throws("pgParams — image hors postgis/postgis refusée", () => pgParams({ PG_IMAGE: "evil/postgres:16" }, { namespace: "geo-preprod", db: DB }));
  throws("pgParams — PG_SECRET invalide refusé", () => pgParams({ PG_SECRET: "Bad_Name" }, { namespace: "geo-preprod", db: DB }));
  const PW = "Zx9!q-Long_Password=42";
  const penv = { GEO_POSTGIS_PREPROD_DB: DB, GEO_POSTGIS_PREPROD_USER: "geo", GEO_POSTGIS_PREPROD_PASSWORD: PW };
  eq("postgisSecretValues — clés EXACTES POSTGRES_DB/USER/PASSWORD depuis GEO_POSTGIS_PREPROD_*", Object.keys(postgisSecretValues(penv, DB)).sort(),
    ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"]);
  eq("POSTGIS_SECRET_KEYS — correspondance secrets GitHub", POSTGIS_SECRET_KEYS, { POSTGRES_DB: "GEO_POSTGIS_PREPROD_DB", POSTGRES_USER: "GEO_POSTGIS_PREPROD_USER", POSTGRES_PASSWORD: "GEO_POSTGIS_PREPROD_PASSWORD" });
  throws("postgisSecretValues — mot de passe absent ⇒ fail-closed", () => postgisSecretValues({ ...penv, GEO_POSTGIS_PREPROD_PASSWORD: "" }, DB));
  throws("postgisSecretValues — mot de passe trop court ⇒ fail-closed", () => postgisSecretValues({ ...penv, GEO_POSTGIS_PREPROD_PASSWORD: "short" }, DB));
  throws("postgisSecretValues — multi-ligne ⇒ fail-closed", () => postgisSecretValues({ ...penv, GEO_POSTGIS_PREPROD_PASSWORD: `${PW}\nx` }, DB));
  throws("postgisSecretValues — POSTGRES_DB ≠ EXPECTED_DATABASE ⇒ fail-closed", () => postgisSecretValues({ ...penv, GEO_POSTGIS_PREPROD_DB: "other" }, DB));
  try { postgisSecretValues({ ...penv, GEO_POSTGIS_PREPROD_PASSWORD: "bad pass with spaces" }, DB); } catch (e) {
    ok("postgisSecretValues — l'erreur nomme la variable, jamais la valeur", /GEO_POSTGIS_PREPROD_PASSWORD/.test(e.message) && !e.message.includes("bad pass"));
  }
  eq("secretSpecsForMode — restore : lecteur + signataire + postgis ; list : lecteur", [secretSpecsForMode("restore"), secretSpecsForMode("list")],
    [["reader", "restore-docs", "postgis"], ["reader"]]);
  const manifestText = readFileSync(join(DIR, PG_DEFAULTS.manifest), "utf8");
  eq("assertManifestNamespace — postgis-preprod.yaml : 4 ressources, toutes en geo-preprod", assertManifestNamespace(manifestText, "geo-preprod"),
    ["StatefulSet", "Service", "NetworkPolicy", "NetworkPolicy"]);
  throws("assertManifestNamespace — une ressource dans le ns prod `geo` ⇒ refus", () => assertManifestNamespace(manifestText.replace("namespace: geo-preprod", "namespace: geo"), "geo-preprod"));
  throws("assertManifestNamespace — cible ns prod ⇒ refus", () => assertManifestNamespace(manifestText.replaceAll("namespace: geo-preprod", "namespace: geo"), "geo"));
  ok("buildPgFailureSummary — base au jour D + commande pg-rollback", /jour D = 2026-09-26/.test(buildPgFailureSummary({ date: D, snapshotDb: "geo_pra_rollback", db: DB })) &&
    /bascule\.mjs pg-rollback/.test(buildPgFailureSummary({ date: D, snapshotDb: "geo_pra_rollback", db: DB })));
  // manifestes postgis préprod (StatefulSet, Service, NetworkPolicies)
  if (YAML) {
    const docs = YAML.parseAllDocuments(manifestText).map((d) => d.toJSON());
    const sts = docs.find((d) => d.kind === "StatefulSet");
    const c = sts.spec.template.spec.containers[0];
    eq("StatefulSet — postgis, ns geo-preprod, 1 réplica, label, image, serviceName", [sts.metadata.name, sts.metadata.namespace, sts.spec.replicas,
      sts.spec.template.metadata.labels["app.kubernetes.io/name"], c.image, sts.spec.serviceName], ["postgis", "geo-preprod", 1, "postgis", "postgis/postgis:16-3.4", "geo-postgis"]);
    eq("StatefulSet — requests 10m/128Mi, limits 250m/512Mi", c.resources, { requests: { cpu: "10m", memory: "128Mi" }, limits: { cpu: "250m", memory: "512Mi" } });
    const vct = sts.spec.volumeClaimTemplates[0];
    eq("StatefulSet — PVC pg-data 2Gi block-standard RWO", [vct.metadata.name, vct.spec.resources.requests.storage, vct.spec.storageClassName, vct.spec.accessModes],
      ["pg-data", "2Gi", "block-standard", ["ReadWriteOnce"]]);
    eq("StatefulSet — POSTGRES_* depuis geo-postgis-credentials", c.env.filter((e) => e.valueFrom).map((e) => [e.name, e.valueFrom.secretKeyRef.name, e.valueFrom.secretKeyRef.key]),
      [["POSTGRES_DB", "geo-postgis-credentials", "POSTGRES_DB"], ["POSTGRES_USER", "geo-postgis-credentials", "POSTGRES_USER"], ["POSTGRES_PASSWORD", "geo-postgis-credentials", "POSTGRES_PASSWORD"]]);
    const svc = docs.find((d) => d.kind === "Service");
    eq("Service — geo-postgis:5432 → postgis", [svc.metadata.name, svc.metadata.namespace, svc.spec.ports[0].port, svc.spec.selector], ["geo-postgis", "geo-preprod", 5432, { "app.kubernetes.io/name": "postgis" }]);
    const np = docs.find((d) => d.kind === "NetworkPolicy" && d.metadata.name === "geo-postgis-preprod");
    eq("netpol postgis — entrée 5432 UNIQUEMENT depuis role=pra-restore, aucune sortie", [np.spec.podSelector, np.spec.policyTypes, np.spec.ingress, np.spec.egress],
      [{ matchLabels: { "app.kubernetes.io/name": "postgis" } }, ["Ingress", "Egress"], [{ from: [{ podSelector: { matchLabels: { role: "pra-restore" } } }], ports: [{ protocol: "TCP", port: 5432 }] }], []]);
    const ne = docs.find((d) => d.kind === "NetworkPolicy" && d.metadata.name === "pra-restore-egress");
    eq("netpol pra-restore — sortie DNS kube-system + S3-BHS 54.39.60.208/32:443 + geo-postgis:5432, rien d'autre",
      [ne.spec.podSelector, ne.spec.policyTypes, ne.spec.egress.map((r) => JSON.stringify(r.to) + JSON.stringify(r.ports))],
      [{ matchLabels: { role: "pra-restore" } }, ["Egress"], [
        JSON.stringify([{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } }, podSelector: { matchLabels: { "k8s-app": "kube-dns" } } }]) + JSON.stringify([{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }]),
        JSON.stringify([{ ipBlock: { cidr: "54.39.60.208/32" } }]) + JSON.stringify([{ protocol: "TCP", port: 443 }]),
        JSON.stringify([{ podSelector: { matchLabels: { "app.kubernetes.io/name": "postgis" } } }]) + JSON.stringify([{ protocol: "TCP", port: 5432 }])]]);
    ok("netpol — geo-api n'est jamais une source autorisée", !JSON.stringify(np).includes("geo-api"));
    // RBAC geo-ci-bascule-preprod
    const rb = YAML.parseAllDocuments(readFileSync(join(DIR, "rbac-ci-bascule-preprod.yaml"), "utf8")).map((d) => d.toJSON()).find((d) => d.kind === "Role");
    const rules = rb.rules;
    const ruleFor = (group, res, verbs) => rules.find((r) => r.apiGroups[0] === group && r.resources[0] === res && JSON.stringify(r.verbs) === JSON.stringify(verbs));
    eq("RBAC — secrets get/update limités aux 3 Secrets pré-créés (dont geo-postgis-credentials)", ruleFor("", "secrets", ["get", "update"]).resourceNames,
      ["geo-backup-reader-preprod", "geo-backup-restore-docs", "geo-postgis-credentials"]);
    ok("RBAC — aucun autre verbe sur secrets (ni create, ni patch, ni list)", rules.filter((r) => r.resources.includes("secrets")).length === 1);
    eq("RBAC — statefulsets get/patch/list/watch limités à postgis", ruleFor("apps", "statefulsets", ["get", "patch", "list", "watch"]).resourceNames, ["postgis"]);
    eq("RBAC — services get/patch limités à geo-postgis", ruleFor("", "services", ["get", "patch"]).resourceNames, ["geo-postgis"]);
    eq("RBAC — networkpolicies get/patch limités aux 2 netpols", ruleFor("networking.k8s.io", "networkpolicies", ["get", "patch"]).resourceNames, ["geo-postgis-preprod", "pra-restore-egress"]);
    const creates = rules.filter((r) => r.verbs.includes("create") && !r.resources.includes("jobs"));
    eq("RBAC — create (non limitable par nom) : seulement statefulsets/services/networkpolicies, sans resourceNames", creates.map((r) => [r.resources[0], r.verbs, r.resourceNames ?? null]),
      [["statefulsets", ["create"], null], ["services", ["create"], null], ["networkpolicies", ["create"], null]]);
    ok("RBAC — aucun delete sur statefulsets/services/networkpolicies/pvc", !rules.some((r) => r.verbs.includes("delete") && r.resources.some((x) => ["statefulsets", "services", "networkpolicies", "persistentvolumeclaims"].includes(x))));
  }
  // templates de la restauration PG : rendu, labels, gardes, syntaxe bash
  const pgBase = { NAMESPACE: "geo-preprod", PG_IMAGE: "postgis/postgis:16-3.4", PG_SERVICE: "geo-postgis", PG_SECRET: "geo-postgis-credentials", EXPECTED_DATABASE: DB, TTL_SECONDS: "3600" };
  const pgRenders = {
    "pg-check-job.tmpl.yaml": { ...pgBase, JOB_NAME: PG_JOBS.check, PG_READY_TIMEOUT: "60" },
    "pg-snapshot-job.tmpl.yaml": { ...pgBase, JOB_NAME: PG_JOBS.snapshot, PG_SNAPSHOT_DB: "geo_pra_rollback" },
    "pg-rollback-job.tmpl.yaml": { ...pgBase, JOB_NAME: PG_JOBS.rollback, PG_SNAPSHOT_DB: "geo_pra_rollback" },
    "db-restore-backup-job.tmpl.yaml": { ...common, ...pgBase, JOB_NAME: PG_JOBS.restore, BACKUP_DATE: D, PIN_MANIFEST_SHA256: "a".repeat(64), PIN_PG_SHA256: "b".repeat(64) },
  };
  for (const [tmpl, vars] of Object.entries(pgRenders)) {
    const { text, leftover } = render(tmpl, vars);
    ok(`${tmpl} — aucun placeholder résiduel`, !leftover);
    ok(`${tmpl} — Job et pod labellisés role=pra-restore (netpols), jamais geo-preprod-sync`, (text.match(/\n {4,8}role: pra-restore\n/g) || []).length === 2 && !text.includes("geo-preprod-sync"));
    ok(`${tmpl} — PGHOST = Service court geo-postgis, identifiants depuis geo-postgis-credentials (jamais en clair)`, /PGHOST, value: "geo-postgis"/.test(text) &&
      /PGPASSWORD, valueFrom: \{ secretKeyRef: \{ name: geo-postgis-credentials, key: POSTGRES_PASSWORD \} \}/.test(text) && !/postgres(ql)?:\/\//.test(text));
    if (YAML) {
      const job = YAML.parse(text);
      const pod = job.spec.template.spec;
      ok(`${tmpl} — YAML valide, backoffLimit 0, automount désactivé, activeDeadlineSeconds`, job.kind === "Job" && job.spec.backoffLimit === 0 && pod.automountServiceAccountToken === false &&
        Number(job.spec.activeDeadlineSeconds) > 0);
      for (const ctr of pod.containers.filter((x) => x.command[0] === "bash")) {
        const n = spawnSync("bash", ["-n", "-c", ctr.args[0]], { encoding: "utf8" });
        ok(`${tmpl} — script bash du conteneur ${ctr.name} syntaxiquement valide (bash -n)`, n.status === 0);
      }
    }
  }
  const chk = render("pg-check-job.tmpl.yaml", pgRenders["pg-check-job.tmpl.yaml"]).text;
  const chkArgs = YAML ? YAML.parse(chk).spec.template.spec.containers[0].args[0] : chk;
  ok("pg-check — pg_isready PUIS SELECT 1 authentifié PUIS base == EXPECTED_DATABASE, sortie 2 sinon, aucune commande destructive",
    chkArgs.indexOf("pg_isready -h") < chkArgs.indexOf("'SELECT 1'") && chkArgs.indexOf("'SELECT 1'") < chkArgs.indexOf("current_database()") &&
    (chkArgs.match(/exit 2/g) || []).length === 3 && !/pg_restore --|drop database|create database|pg_dump/i.test(chkArgs));
  const snp = render("pg-snapshot-job.tmpl.yaml", pgRenders["pg-snapshot-job.tmpl.yaml"]).text;
  ok("G1 snapshot — G2 (aucune session) AVANT drop/create, CREATE DATABASE … TEMPLATE", snp.indexOf("pg_stat_activity") < snp.indexOf("drop database if exists") &&
    /create database \\"\$PG_SNAPSHOT_DB\\" template \\"\$EXPECTED_DATABASE\\"/.test(snp));
  const rst = render("db-restore-backup-job.tmpl.yaml", pgRenders["db-restore-backup-job.tmpl.yaml"]).text;
  ok("S2 — fetch-dump (script embarqué) puis pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction",
    /BR_STEP, value: "fetch-dump"/.test(rst) && /pg_restore --clean --if-exists --no-owner --no-privileges \\\n\s+--exit-on-error --single-transaction/.test(rst));
  const ra = YAML ? YAML.parse(rst).spec.template.spec.containers.find((x) => x.name === "restore").args[0] : rst;
  ok("S2 — gardes avant pg_restore : base du Secret, G2 sessions, TOC == manifeste, dbname de l'archive", ra.indexOf('"$PGDATABASE" != "$EXPECTED_DATABASE"') > -1 &&
    ra.indexOf('"$PGDATABASE" != "$EXPECTED_DATABASE"') < ra.indexOf("pg_stat_activity") &&
    ra.indexOf("pg_stat_activity") < ra.indexOf("EXPECTED_TOC_ENTRIES") && ra.indexOf("EXPECTED_TOC_ENTRIES") < ra.indexOf("dbname:") &&
    ra.indexOf("dbname:") < ra.indexOf("pg_restore --clean"));
  const m = rst.match(/command: \["node", "-e"\]\n {10}args:\n {12}- \|\n([\s\S]*?)\n {10}env:/);
  ok("S2 — script fetch embarqué à l'octet", m && m[1].split("\n").map((l) => l.replace(/^ {14}/, "")).join("\n").trimEnd() === SCRIPT.trimEnd());
  const rbk = render("pg-rollback-job.tmpl.yaml", pgRenders["pg-rollback-job.tmpl.yaml"]).text;
  ok("rollback G1 — refus sans snapshot ou avec session, puis drop + create TEMPLATE snapshot", rbk.indexOf("no G1 snapshot") < rbk.indexOf("drop database") &&
    rbk.indexOf("pg_stat_activity") < rbk.indexOf("drop database") && /create database \\"\$EXPECTED_DATABASE\\" template \\"\$PG_SNAPSHOT_DB\\"/.test(rbk));
  ok("S2c migrate — N/A : aucun fichier de migration/ORM dans le dépôt geo (vérifié)", !existsSync(join(DIR, "..", "..", "..", "drizzle")) && !existsSync(join(DIR, "..", "..", "..", "migrations")));
}

// ═════════════════════════════ câblage du workflow ════════════════════════════
{
  const wf = readFileSync(join(DIR, "..", "..", "..", ".github", "workflows", "bascule-preprod.yml"), "utf8");
  ok("workflow — run-name MODE + CYCLE_ID", wf.includes("run-name: \"bascule-preprod ${{ inputs.MODE || 'chain' }} ${{ inputs.CYCLE_ID }}\""));
  ok("workflow — input MODE chain|restore|list", /MODE:\n[^\n]*\n\s+required: false\n\s+type: choice\n\s+options: \[chain, restore, list\]/.test(wf));
  ok("workflow — jambes pg/s3 limitées à MODE=chain (armement planifié inchangé)", (wf.match(/\(github\.event_name != 'schedule' \|\| vars\.BASCULE_SCHEDULE_ENABLED == 'true'\) && \(inputs\.MODE \|\| 'chain'\) == 'chain'/g) || []).length === 2);
  for (const c of ["preflight-backup", "backup-secret-fill", "backup-resolve", "backup-list", "docs-restore", "recon-backup"]) ok(`workflow — étape '${c}'`, wf.includes(`node "$CLI" ${c}`));
  ok("workflow — resolve avant la copie", wf.indexOf('node "$CLI" backup-resolve') < wf.indexOf('run: node "$CLI" docs-restore'));
  const runs = [...wf.matchAll(/run: (?:\|\n((?: {10,}.*\n?)+)|(.*))/g)].map((m) => m[1] || m[2]);
  ok("workflow — aucun ${{ secrets./inputs. }} interpolé dans un run:", runs.every((r) => !/\$\{\{\s*(secrets|inputs)\./.test(r)));
  ok("workflow — aucun ${{ github.* }} interpolé dans un run: (event_name passé par env:)", runs.every((r) => !/\$\{\{\s*github\./.test(r)));
  if (YAML) {
    const doc = YAML.parse(wf);
    ok("workflow — job list : CONFIRM dans l'env + CONFIRM_EXPECTED calculé AVANT preflight-backup (G3)", doc.jobs.list.env.CONFIRM === "${{ inputs.CONFIRM }}" &&
      doc.jobs.list.steps.findIndex((s) => /CONFIRM_EXPECTED=/.test(String(s.run ?? ""))) > -1 &&
      doc.jobs.list.steps.findIndex((s) => /CONFIRM_EXPECTED=/.test(String(s.run ?? ""))) < doc.jobs.list.steps.findIndex((s) => /preflight-backup/.test(String(s.run ?? ""))));
    for (const j of ["list", "restore"]) {
      const idx = (re) => doc.jobs[j].steps.findIndex((s) => re.test(String(s.run ?? "")));
      ok(`workflow — job ${j} : preflight-backup (G3) avant l'écriture des Secrets et tout Job`, idx(/preflight-backup/) > -1 && idx(/preflight-backup/) < idx(/backup-secret-fill/) &&
        idx(/backup-secret-fill/) < Math.max(idx(/backup-resolve/), idx(/backup-list/)));
    }
    // Budget : somme des attentes runner des étapes du job restore (défauts) < timeout-minutes < 360.
    const stepsMin = { r0: 2700 / 60, apply: 300 / 60, check: 300 / 60, snapshot: 600 / 60, restorePg: 1800 / 60,
      docs: Number(/'(\d+)'/.exec(doc.jobs.restore.env.DOCS_RESTORE_TIMEOUT)[1]) / 60, recon: 15, g4: 15, rollout: 10, servedIds: 45 };
    const sum = Object.values(stepsMin).reduce((a, b) => a + b, 0);
    ok(`workflow — job restore : budget 350 min > somme des attentes d'étapes (${sum} min), plafond 360`, doc.jobs.restore["timeout-minutes"] === 350 && sum < 350 - 15);
    const idx = (re) => doc.jobs.restore.steps.findIndex((s) => re.test(String(s.run ?? "")) && !s["continue-on-error"]);
    ok("workflow — restauration PG : R0 < pg-apply < pg-check (fatal) < G1 snapshot < S2 pg-restore < S3' docs-restore",
      idx(/backup-resolve/) < idx(/pg-apply/) && idx(/pg-apply/) < idx(/pg-check/) && idx(/pg-check/) < idx(/pg-snapshot/) &&
      idx(/pg-snapshot/) < idx(/pg-restore/) && idx(/pg-restore/) < doc.jobs.restore.steps.findIndex((s) => /docs-restore/.test(String(s.run ?? "")) && s.id === "docs_backup"));
    const stepOf = (re, dry) => doc.jobs.restore.steps.find((s) => re.test(String(s.run ?? "")) && (dry ? /inputs\.DRY_RUN }}$/.test(String(s.if)) : /!inputs\.DRY_RUN/.test(String(s.if))));
    ok("workflow — DRY : pg-check seul, informatif (continue-on-error) ; hors DRY : apply, check, snapshot, restore", !!stepOf(/pg-check/, true) && stepOf(/pg-check/, true)["continue-on-error"] === true &&
      ["pg-apply", "pg-check", "pg-snapshot", "pg-restore"].every((c) => !!stepOf(new RegExp(`${c}$`), false)) &&
      !doc.jobs.restore.steps.some((s) => /pg-(apply|snapshot|restore)$/.test(String(s.run ?? "")) && !/!inputs\.DRY_RUN/.test(String(s.if))));
    const fillR = doc.jobs.restore.steps.find((s) => /backup-secret-fill/.test(String(s.run ?? "")));
    ok("workflow — job restore : secrets GEO_POSTGIS_PREPROD_* via env: de l'étape d'écriture", ["DB", "USER", "PASSWORD"].every((k) => fillR.env[`GEO_POSTGIS_PREPROD_${k}`] === `\${{ secrets.GEO_POSTGIS_PREPROD_${k} }}`));
    ok("workflow — job list : aucun secret postgis", !JSON.stringify(doc.jobs.list).includes("GEO_POSTGIS_PREPROD"));
    eq("workflow — noms PG paramétrés, défauts k8s", [doc.jobs.restore.env.PG_SERVICE, doc.jobs.restore.env.PG_SECRET, doc.jobs.restore.env.PG_STATEFULSET, doc.jobs.restore.env.PG_IMAGE],
      ["${{ vars.BASCULE_PG_SERVICE || 'geo-postgis' }}", "${{ vars.BASCULE_PG_SECRET || 'geo-postgis-credentials' }}", "${{ vars.BASCULE_PG_STATEFULSET || 'postgis' }}",
        "${{ vars.BASCULE_PG_IMAGE || 'postgis/postgis:16-3.4' }}"]);
    ok("workflow — échec après S2 réussi ⇒ résumé + rollback G1", doc.jobs.restore.steps.some((s) => /pg-failure-summary/.test(String(s.run ?? "")) &&
      /failure\(\) && !inputs\.DRY_RUN && steps\.restore_pg\.outcome == 'success'/.test(String(s.if))));
    ok("workflow — cycle-leg : verdict.pg = S2 (o_restore_pg) en MODE=restore (R0 en DRY)", doc.jobs.restore.outputs.o_restore_pg === "${{ steps.restore_pg.outcome }}" &&
      /needs\.restore\.outputs\.o_restore_pg/.test(doc.jobs["cycle-leg"].env.PG_RESULT));
    ok("workflow — les jobs pg/s3 (chain) ne touchent pas au postgis préprod", !/pg-(apply|check|snapshot|restore|rollback)/.test(JSON.stringify(doc.jobs.pg) + JSON.stringify(doc.jobs.s3)));
  }
  if (YAML) {
    const doc = YAML.parse(wf);
    for (const j of ["list", "restore"]) ok(`workflow — job ${j} : environment geo-bascule, secrets lecteur via env:`, doc.jobs[j].environment === "geo-bascule" &&
      doc.jobs[j].steps.some((s) => s.env && s.env.GEO_BACKUP_READER_PREPROD_ACCESS_KEY === "${{ secrets.GEO_BACKUP_READER_PREPROD_ACCESS_KEY }}" && /backup-secret-fill/.test(s.run)));
    ok("workflow — cycle-leg : needs [pg, s3, restore], backup du job restore", JSON.stringify(doc.jobs["cycle-leg"].needs) === '["pg","s3","restore"]' &&
      /needs\.restore\.outputs\.backup_date/.test(JSON.stringify(doc.jobs["cycle-leg"].env)));
    const fill = doc.jobs.restore.steps.find((s) => /backup-secret-fill/.test(String(s.run ?? "")));
    ok("workflow — job restore : secrets du signataire S3' via env: (GEO_BACKUP_RESTORE_DOCS_*)",
      !!fill && fill.env.GEO_BACKUP_RESTORE_DOCS_ACCESS_KEY === "${{ secrets.GEO_BACKUP_RESTORE_DOCS_ACCESS_KEY }}" && fill.env.GEO_BACKUP_RESTORE_DOCS_SECRET_KEY === "${{ secrets.GEO_BACKUP_RESTORE_DOCS_SECRET_KEY }}");
    const listFill = doc.jobs.list.steps.find((s) => /backup-secret-fill/.test(String(s.run ?? "")));
    ok("workflow — job list : lecteur seulement (pas de secret du signataire)", !!listFill && !("GEO_BACKUP_RESTORE_DOCS_ACCESS_KEY" in listFill.env));
    ok("workflow — grant S3' aligné sur docs-sync (même variable, même défaut)", doc.jobs.restore.env.DOCS_SYNC_GRANTEE === doc.jobs.s3.env.DOCS_SYNC_GRANTEE &&
      /vars\.BASCULE_DOCS_SYNC_GRANTEE/.test(doc.jobs.restore.env.DOCS_SYNC_GRANTEE));
    ok("workflow — signataire S3' par défaut geo-backup-restore-docs, sans repli sur le lecteur", doc.jobs.restore.env.BACKUP_DOCS_COPY_SECRET === "${{ vars.BASCULE_BACKUP_DOCS_COPY_SECRET || 'geo-backup-restore-docs' }}");
    ok(`workflow — ${Object.keys(doc.on.workflow_dispatch.inputs).length} inputs (<= 25)`, Object.keys(doc.on.workflow_dispatch.inputs).length <= 25);
  }
  const rbac = readFileSync(join(DIR, "rbac-ci-bascule-preprod.yaml"), "utf8");
  ok("RBAC — secrets get/update limités aux 3 Secrets pré-créés (ni create/patch/list)", /resources: \["secrets"\]\n\s+verbs: \["get", "update"\][^\n]*\n\s+resourceNames: \["geo-backup-reader-preprod", "geo-backup-restore-docs", "geo-postgis-credentials"\]/.test(rbac) &&
    !/resources: \["secrets"\]\n\s+verbs: \[[^\]]*(create|patch|list)/.test(rbac));
}

// ═════════════════════════════ CLI de bout en bout (faux kubectl) ═════════════
async function cliSuite() {
  const { s, manSha } = fixture();
  const resolved = await step({ s, env: baseEnv({ BR_STEP: "resolve" }) });
  const bin = join(tmp, "fakebin");
  mkdirSync(bin, { recursive: true });
  // Chaque Job appliqué reçoit JOB_UID ; chaque liste de pods contient aussi un pod PLUS
  // RÉCENT d'une instance précédente (autre uid) dont le verdict ne doit jamais être lu.
  const JOB_UID = "22222222-2222-4222-8222-222222222222";
  const podOf = (uid, ts, c, msg) => ({ metadata: { creationTimestamp: ts, ownerReferences: [{ kind: "Job", uid, controller: true }] }, status: { containerStatuses: [{ name: c, state: { terminated: { message: msg } } }] } });
  const pods = (c, msg) => JSON.stringify({ items: [podOf(JOB_UID, "2026-09-26T12:00:00Z", c, msg),
    podOf("99999999-9999-4999-8999-999999999999", "2026-09-26T13:00:00Z", c, '{"ok":false,"reason":"pod périmé d\'une instance précédente"}')] });
  writeFileSync(join(tmp, "pods-read.json"), pods("read", JSON.stringify(resolved.t)));
  writeFileSync(join(tmp, "pods-docs.json"), pods("docs", JSON.stringify({ ok: true, step: "docs", copied: 3 })));
  writeFileSync(join(tmp, "replaced.json"), JSON.stringify({ kind: "Secret", data: { S3_ACCESS_KEY: "eA==", S3_SECRET_KEY: "eA==", BACKUP_BUCKET: "eA==" } }));
  writeFileSync(join(tmp, "replaced-pg.json"), JSON.stringify({ kind: "Secret", data: { POSTGRES_DB: "eA==", POSTGRES_USER: "eA==", POSTGRES_PASSWORD: "eA==" } }));
  writeFileSync(join(tmp, "pods-check.json"), pods("check", JSON.stringify({ ok: true, step: "pg-check", ready: true, auth: true, database: DB })));
  writeFileSync(join(tmp, "pods-check-ko.json"), pods("check", JSON.stringify({ ok: false, step: "pg-check", ready: true, auth: false, database: "",
    reason: "authenticated connection refused (SELECT 1): nothing destructive done, no pg_restore" })));
  writeFileSync(join(tmp, "pods-snapshot.json"), pods("snapshot", JSON.stringify({ ok: true, step: "pg-snapshot", snapshot: "geo_pra_rollback", sizeBytes: 12345 })));
  const podsRestore = (uid) => ({ metadata: { creationTimestamp: "2026-09-26T12:00:00Z", ownerReferences: [{ kind: "Job", uid, controller: true }] }, status: {
    initContainerStatuses: [{ name: "fetch", state: { terminated: { message: JSON.stringify({ ok: true, step: "fetch-dump", date: D }) } } }],
    containerStatuses: [{ name: "restore", state: { terminated: { message: JSON.stringify({ ok: true, step: "pg-restore", date: D, tocEntries: 24 }) } } }] } });
  writeFileSync(join(tmp, "pods-restore.json"), JSON.stringify({ items: [podsRestore(JOB_UID)] }));
  const klog = join(tmp, "kubectl.log");
  writeFileSync(join(bin, "kubectl"), ["#!/usr/bin/env bash", `echo "$*" >> "${klog}"`,
    'if [ -n "${FAKE_FAIL_JOB:-}" ] && [[ "$*" == *"get job $FAKE_FAIL_JOB -o jsonpath={.status}"* ]]; then printf \'{"failed":1}\'; exit 0; fi',
    'case "$*" in',
    '  *"containers[0].image"*) printf "ghcr.io/rhanka/geo-api@sha256:%064d" 0 ;;',
    '  *"get job "*"jsonpath={.status}"*) printf \'{"succeeded":1}\' ;;',
    `  *"get job "*"jsonpath={.metadata.uid}"*) printf "${JOB_UID}" ;;`,
    `  *"replace"*"postgis.json"*) cat "${join(tmp, "replaced-pg.json")}" ;;`,
    `  *"replace"*) cat "${join(tmp, "replaced.json")}" ;;`,
    `  *"job-name=${JOBS.resolve}"*) cat "${join(tmp, "pods-read.json")}" ;;`,
    `  *"job-name=${JOBS.docs}"*|*"job-name=${JOBS.recon}"*) cat "${join(tmp, "pods-docs.json")}" ;;`,
    `  *"job-name=${PG_JOBS.check}"*) if [ -n "\${FAKE_FAIL_JOB:-}" ]; then cat "${join(tmp, "pods-check-ko.json")}"; else cat "${join(tmp, "pods-check.json")}"; fi ;;`,
    `  *"job-name=${PG_JOBS.snapshot}"*) cat "${join(tmp, "pods-snapshot.json")}" ;;`,
    `  *"job-name=${PG_JOBS.restore}"*) cat "${join(tmp, "pods-restore.json")}" ;;`,
    "  *) : ;;", "esac", "exit 0", ""].join("\n"), { mode: 0o755 });
  const work = join(tmp, "work");
  const t = new Date().toISOString().slice(0, 10);
  const env = { PATH: `${bin}:${process.env.PATH}`, MODE: "restore", BACKUP_ID: "latest", BHS: "s3.bhs.io.cloud.ovh.net", S3_REGION: "bhs", EXPECTED_DATABASE: DB,
    PREPROD_DOCS: DST, PROD_DOCS: PROD, PREPROD_API_URL: "https://pre", PROD_API_URL: "https://prod", CONFIRM: `iso-prod-${t}`, CONFIRM_EXPECTED: `iso-prod-${t}`,
    BASCULE_WORKDIR: work, DOCS_SYNC_GRANTEE: "1901410700457444:g", GITHUB_OUTPUT: join(tmp, "out") };
  writeFileSync(env.GITHUB_OUTPUT, "");
  const cli = (cmd, extra = {}) => spawnSync(process.execPath, [join(DIR, "bascule.mjs"), cmd], { env: { ...env, ...extra }, encoding: "utf8" });
  eq("CLI preflight-backup — exit 0", cli("preflight-backup").status, 0);
  const PGPW = "Zx9!q-Long_Password=42";
  const both = { GEO_BACKUP_READER_PREPROD_ACCESS_KEY: "ABCDEFGH12345678abcd", GEO_BACKUP_READER_PREPROD_SECRET_KEY: "abc/DEF+ghi=1234567890xyz",
    GEO_BACKUP_RESTORE_DOCS_ACCESS_KEY: "ZZZZZZZZ12345678abcd", GEO_BACKUP_RESTORE_DOCS_SECRET_KEY: "zzz/YYY+xxx=0987654321abc",
    GEO_POSTGIS_PREPROD_DB: DB, GEO_POSTGIS_PREPROD_USER: "geo", GEO_POSTGIS_PREPROD_PASSWORD: PGPW };
  const fill = cli("backup-secret-fill", both);
  const log1 = readFileSync(klog, "utf8");
  const dryIdx = [...log1.matchAll(/replace --dry-run=server -f \S+ -o json/g)].map((m) => m.index);
  const realIdx = [...log1.matchAll(/replace -f \S+ -o json/g)].map((m) => m.index);
  ok("CLI backup-secret-fill (restore) — lecteur + signataire + postgis : 3 dry-run serveur AVANT les 3 replace, valeurs jamais en argv/stdout",
    fill.status === 0 && dryIdx.length === 3 && realIdx.length === 3 && Math.max(...dryIdx) < Math.min(...realIdx) &&
    /get secret geo-backup-reader-preprod/.test(log1) && /get secret geo-backup-restore-docs/.test(log1) && /get secret geo-postgis-credentials/.test(log1) &&
    !["abc/DEF+ghi", "zzz/YYY+xxx", PGPW].some((v) => log1.includes(v) || fill.stdout.includes(v)));
  ok("CLI backup-secret-fill (restore) — secret du signataire absent ⇒ fail-closed, rien écrit",
    cli("backup-secret-fill", { GEO_BACKUP_READER_PREPROD_ACCESS_KEY: both.GEO_BACKUP_READER_PREPROD_ACCESS_KEY, GEO_BACKUP_READER_PREPROD_SECRET_KEY: both.GEO_BACKUP_READER_PREPROD_SECRET_KEY }).status === 1);
  const beforePgFill = readFileSync(klog, "utf8").length;
  const noPg = cli("backup-secret-fill", { ...both, GEO_POSTGIS_PREPROD_PASSWORD: "" });
  ok("CLI backup-secret-fill (restore) — mot de passe postgis absent ⇒ fail-closed AVANT tout replace",
    noPg.status === 1 && /GEO_POSTGIS_PREPROD_PASSWORD/.test(noPg.stdout) && !/replace/.test(readFileSync(klog, "utf8").slice(beforePgFill)));
  ok("CLI backup-secret-fill (list) — lecteur seul, secrets du signataire non requis",
    cli("backup-secret-fill", { MODE: "list", GEO_BACKUP_READER_PREPROD_ACCESS_KEY: both.GEO_BACKUP_READER_PREPROD_ACCESS_KEY, GEO_BACKUP_READER_PREPROD_SECRET_KEY: both.GEO_BACKUP_READER_PREPROD_SECRET_KEY }).status === 0);
  ok("CLI backup-secret-fill — secret GitHub absent ⇒ fail-closed", cli("backup-secret-fill").status === 1);
  eq("CLI backup-resolve — exit 0 + PIN", [cli("backup-resolve").status, JSON.parse(readFileSync(join(work, "backup-pin.json"), "utf8")).manifestSha256 === manSha], [0, true]);
  ok("CLI backup-resolve — GITHUB_OUTPUT backup_date", readFileSync(env.GITHUB_OUTPUT, "utf8").includes(`backup_date=${D}`));
  // ── restauration PG (S2 + G1) ──
  const beforePg = readFileSync(klog, "utf8").length;
  eq("CLI pg-apply — exit 0", cli("pg-apply").status, 0);
  const klogApply = readFileSync(klog, "utf8").slice(beforePg);
  ok("CLI pg-apply — kubectl apply de postgis-preprod.yaml puis rollout status statefulset/postgis (ns geo-preprod)",
    /-n geo-preprod apply -f \S+postgis-preprod\.yaml/.test(klogApply) && /-n geo-preprod rollout status statefulset\/postgis --timeout=300s/.test(klogApply) &&
    klogApply.indexOf(" apply -f ") < klogApply.indexOf("rollout status"));
  eq("CLI pg-check — exit 0 (pg_isready + SELECT 1 verts)", cli("pg-check").status, 0);
  const rc = readFileSync(join(work, `${PG_JOBS.check}.rendered.yaml`), "utf8");
  ok("CLI pg-check — Job rendu : role=pra-restore, PGHOST geo-postgis, Secret geo-postgis-credentials", /role: pra-restore/.test(rc) && /PGHOST, value: "geo-postgis"/.test(rc) &&
    /name: geo-postgis-credentials, key: POSTGRES_PASSWORD/.test(rc));
  const beforeKo = readFileSync(klog, "utf8").length;
  const ko = cli("pg-check", { FAKE_FAIL_JOB: PG_JOBS.check });
  ok("CLI pg-check — connexion refusée ⇒ exit 1, message clair (raison du pod), aucune action destructive",
    ko.status === 1 && /pg-check refusé/.test(ko.stdout) && /aucune action destructive/.test(ko.stdout) && /SELECT 1/.test(ko.stdout) &&
    !new RegExp(`${PG_JOBS.snapshot}|${PG_JOBS.restore}`).test(readFileSync(klog, "utf8").slice(beforeKo)));
  eq("CLI pg-snapshot (G1) — exit 0", cli("pg-snapshot").status, 0);
  ok("CLI pg-snapshot — snapshot geo_pra_rollback rendu", readFileSync(join(work, `${PG_JOBS.snapshot}.rendered.yaml`), "utf8").includes('PG_SNAPSHOT_DB, value: "geo_pra_rollback"'));
  eq("CLI pg-restore (S2) — exit 0", cli("pg-restore").status, 0);
  const rr = readFileSync(join(work, `${PG_JOBS.restore}.rendered.yaml`), "utf8");
  const pinNow = JSON.parse(readFileSync(join(work, "backup-pin.json"), "utf8"));
  ok("CLI pg-restore — Job épinglé à D + sha256 manifeste/dump, fetch-dump, lecteur geo-backup-reader-preprod", rr.includes(`BACKUP_DATE, value: "${D}"`) &&
    rr.includes(pinNow.manifestSha256) && rr.includes(pinNow.pgSha256) && /BR_STEP, value: "fetch-dump"/.test(rr) && /name: geo-backup-reader-preprod, key: S3_ACCESS_KEY/.test(rr));
  const nsProd = cli("pg-apply", { PREPROD_NAMESPACE: "geo" });
  ok("CLI pg-apply — namespace de PRODUCTION `geo` refusé avant tout kubectl apply", nsProd.status === 1 && /PRODUCTION/.test(nsProd.stdout));
  const stalePg = ["pg-apply", "pg-check", "pg-snapshot", "pg-restore", "pg-rollback"].map((c) => cli(c, { CONFIRM: "iso-prod-2020-01-01" }));
  ok("CLI restauration PG — G3 (CONFIRM périmé) refusé pour apply/check/snapshot/restore/rollback", stalePg.every((r) => r.status === 1 && /GARDE G3/.test(r.stdout)));
  eq("CLI pg-restore — refusé hors MODE=restore", cli("pg-restore", { MODE: "chain" }).status, 1);
  const sumFile = join(tmp, "pg-summary.md");
  writeFileSync(sumFile, "");
  const fsum = cli("pg-failure-summary", { GITHUB_STEP_SUMMARY: sumFile });
  ok("CLI pg-failure-summary — base au jour D + rollback G1 dans le résumé", fsum.status === 0 && readFileSync(sumFile, "utf8").includes(`jour D = ${D}`) &&
    readFileSync(sumFile, "utf8").includes("pg-rollback"));
  eq("CLI docs-restore — exit 0", cli("docs-restore").status, 0);
  const rd = readFileSync(join(work, `${JOBS.docs}.rendered.yaml`), "utf8");
  ok("CLI docs-restore — Job : préfixe normalized/, prod + backup interdits, signataire dédié", rd.includes(`DOCS_RESTORE_PREFIX, value: "${P}"`) && rd.includes(`FORBIDDEN_DST_BUCKETS, value: "${PROD},${B}"`) && rd.includes("name: geo-backup-restore-docs"));
  ok("CLI preflight-backup (restore) — PREPROD_DOCS = bucket prod figé ⇒ refusé", cli("preflight-backup", { PROD_DOCS: "autre-prod", PREPROD_DOCS: PROD }).status === 1);
  // G3 dans TOUS les MODE (list compris), avant toute écriture de Secret ou tout Job
  const beforeG3 = readFileSync(klog, "utf8").length;
  const stale = { CONFIRM: "iso-prod-2020-01-01" };
  const g3 = [cli("preflight-backup", { ...stale, MODE: "list" }), cli("backup-secret-fill", { ...stale, MODE: "list", ...both }), cli("backup-list", { ...stale, MODE: "list" }), cli("backup-resolve", stale)];
  ok("CLI G3 — CONFIRM périmé refusé en MODE=list/restore : preflight, écriture de Secret, Jobs — 0 appel kubectl",
    g3.every((r) => r.status === 1 && /GARDE G3/.test(r.stdout)) && readFileSync(klog, "utf8").length === beforeG3);
  eq("CLI recon-backup — exit 0 + sentinel", [cli("recon-backup").status, JSON.parse(readFileSync(join(work, "recon.ok.json"), "utf8")).backupDate], [0, D]);
  const ro = cli("rollout");
  ok("CLI rollout — G4 = recon vs inventaire(D) rejouée, puis rollout restart", ro.status === 0 && /rollout restart deployment\/geo-api/.test(readFileSync(klog, "utf8")));
  ok("CLI — jamais de kubeconfig PROD ni de trigger de dump en MODE=restore", !/--kubeconfig|geo-db-backup-prod/.test(readFileSync(klog, "utf8")));
  eq("CLI backup-resolve — refusé en MODE=chain", cli("backup-resolve", { MODE: "chain" }).status, 1);
}

await suite();
await cliSuite();
console.log(`\nrestore-mode.selftest (geo) — ${passed} passés, ${failed} échoués`);
process.exit(failed ? 1 : 0);
