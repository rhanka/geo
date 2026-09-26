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
  assertScriptEmbeddable, assertYamlSafeVars, basculeMode, buildSecretManifest, formatBackupTable, indentBlock, JOBS, keysOfReplaced,
  parseTermination, pickTerminationMessage, PINNED_S3_ENDPOINT, readerSecretValues, safeReason, validateBackupIdInput, validateCycleId,
  validateListing, validatePin,
} from "./restore-mode.mjs";
import { backupOfLeg, buildGeoLeg } from "./served-ids.mjs";

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
        store.copies.push({ key: i.Key, versionId: s.v, grant: i.GrantFullControl || null, multipart: false });
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
        store.copies.push({ key: i.Key, versionId: u.src.v, grant: u.grant, multipart: true, parts: i.MultipartUpload.Parts.length });
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
    pg: { database: DB, key: `pg/${D}/${DB}.dump`, sha256: sha(dump), sizeBytes: dump.length, versionId: dumpV.VersionId, dumpStartedAt: "2026-09-26T03:23:05Z" },
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
eq("pickTerminationMessage — conteneur du pod le plus récent", parseTermination(pickTerminationMessage({ items: [
  { metadata: { creationTimestamp: "1" }, status: { containerStatuses: [{ name: "read", state: { terminated: { message: '{"ok":false}' } } }] } },
  { metadata: { creationTimestamp: "2" }, status: { containerStatuses: [{ name: "read", state: { terminated: { message: '{"ok":true}' } } }] } }] }, "read")), { ok: true });
{
  const AK = "ABCDEFGH12345678abcd";
  const SK = "abc/DEF+ghi=1234567890xyz";
  const env = { GEO_BACKUP_READER_PREPROD_ACCESS_KEY: AK, GEO_BACKUP_READER_PREPROD_SECRET_KEY: SK, BACKUP_BUCKET: B, S3_ENDPOINT_RENDERED: PINNED_S3_ENDPOINT };
  eq("readerSecretValues — clés EXACTES du Secret pré-créé", Object.keys(readerSecretValues(env)).sort(), ["BACKUP_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"]);
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
  if (YAML) {
    const doc = YAML.parse(wf);
    for (const j of ["list", "restore"]) ok(`workflow — job ${j} : environment geo-bascule, secrets lecteur via env:`, doc.jobs[j].environment === "geo-bascule" &&
      doc.jobs[j].steps.some((s) => s.env && s.env.GEO_BACKUP_READER_PREPROD_ACCESS_KEY === "${{ secrets.GEO_BACKUP_READER_PREPROD_ACCESS_KEY }}" && /backup-secret-fill/.test(s.run)));
    ok("workflow — cycle-leg : needs [pg, s3, restore], backup du job restore", JSON.stringify(doc.jobs["cycle-leg"].needs) === '["pg","s3","restore"]' &&
      /needs\.restore\.outputs\.backup_date/.test(JSON.stringify(doc.jobs["cycle-leg"].env)));
    ok(`workflow — ${Object.keys(doc.on.workflow_dispatch.inputs).length} inputs (<= 25)`, Object.keys(doc.on.workflow_dispatch.inputs).length <= 25);
  }
  const rbac = readFileSync(join(DIR, "rbac-ci-bascule-preprod.yaml"), "utf8");
  ok("RBAC — secrets get/update limités à geo-backup-reader-preprod (ni create/patch/list)", /resources: \["secrets"\]\n\s+verbs: \["get", "update"\][^\n]*\n\s+resourceNames: \["geo-backup-reader-preprod"\]/.test(rbac) &&
    !/resources: \["secrets"\]\n\s+verbs: \[[^\]]*(create|patch|list)/.test(rbac));
}

// ═════════════════════════════ CLI de bout en bout (faux kubectl) ═════════════
async function cliSuite() {
  const { s, manSha } = fixture();
  const resolved = await step({ s, env: baseEnv({ BR_STEP: "resolve" }) });
  const bin = join(tmp, "fakebin");
  mkdirSync(bin, { recursive: true });
  const pods = (c, msg) => JSON.stringify({ items: [{ metadata: { creationTimestamp: "x" }, status: { containerStatuses: [{ name: c, state: { terminated: { message: msg } } }] } }] });
  writeFileSync(join(tmp, "pods-read.json"), pods("read", JSON.stringify(resolved.t)));
  writeFileSync(join(tmp, "pods-docs.json"), pods("docs", JSON.stringify({ ok: true, step: "docs", copied: 3 })));
  writeFileSync(join(tmp, "replaced.json"), JSON.stringify({ kind: "Secret", data: { S3_ACCESS_KEY: "eA==", S3_SECRET_KEY: "eA==", BACKUP_BUCKET: "eA==" } }));
  const klog = join(tmp, "kubectl.log");
  writeFileSync(join(bin, "kubectl"), ["#!/usr/bin/env bash", `echo "$*" >> "${klog}"`, 'case "$*" in',
    '  *"containers[0].image"*) printf "ghcr.io/rhanka/geo-api@sha256:%064d" 0 ;;',
    '  *"get job "*"jsonpath={.status}"*) printf \'{"succeeded":1}\' ;;',
    `  *"replace"*) cat "${join(tmp, "replaced.json")}" ;;`,
    `  *"job-name=${JOBS.resolve}"*) cat "${join(tmp, "pods-read.json")}" ;;`,
    `  *"job-name=${JOBS.docs}"*|*"job-name=${JOBS.recon}"*) cat "${join(tmp, "pods-docs.json")}" ;;`,
    "  *) : ;;", "esac", "exit 0", ""].join("\n"), { mode: 0o755 });
  const work = join(tmp, "work");
  const t = new Date().toISOString().slice(0, 10);
  const env = { PATH: `${bin}:${process.env.PATH}`, MODE: "restore", BACKUP_ID: "latest", BHS: "s3.bhs.io.cloud.ovh.net", S3_REGION: "bhs", EXPECTED_DATABASE: DB,
    PREPROD_DOCS: DST, PROD_DOCS: PROD, PREPROD_API_URL: "https://pre", PROD_API_URL: "https://prod", CONFIRM: `iso-prod-${t}`, CONFIRM_EXPECTED: `iso-prod-${t}`,
    BASCULE_WORKDIR: work, DOCS_SYNC_GRANTEE: "1901410700457444:g", GITHUB_OUTPUT: join(tmp, "out") };
  writeFileSync(env.GITHUB_OUTPUT, "");
  const cli = (cmd, extra = {}) => spawnSync(process.execPath, [join(DIR, "bascule.mjs"), cmd], { env: { ...env, ...extra }, encoding: "utf8" });
  eq("CLI preflight-backup — exit 0", cli("preflight-backup").status, 0);
  const fill = cli("backup-secret-fill", { GEO_BACKUP_READER_PREPROD_ACCESS_KEY: "ABCDEFGH12345678abcd", GEO_BACKUP_READER_PREPROD_SECRET_KEY: "abc/DEF+ghi=1234567890xyz" });
  const log1 = readFileSync(klog, "utf8");
  ok("CLI backup-secret-fill — dry-run serveur puis replace, jeu de clés vérifié, valeurs jamais en argv/stdout",
    fill.status === 0 && /replace --dry-run=server -f \S+ -o json/.test(log1) && /replace -f \S+ -o json/.test(log1) &&
    !log1.includes("abc/DEF+ghi") && !fill.stdout.includes("abc/DEF+ghi"));
  ok("CLI backup-secret-fill — secret GitHub absent ⇒ fail-closed", cli("backup-secret-fill").status === 1);
  eq("CLI backup-resolve — exit 0 + PIN", [cli("backup-resolve").status, JSON.parse(readFileSync(join(work, "backup-pin.json"), "utf8")).manifestSha256 === manSha], [0, true]);
  ok("CLI backup-resolve — GITHUB_OUTPUT backup_date", readFileSync(env.GITHUB_OUTPUT, "utf8").includes(`backup_date=${D}`));
  eq("CLI docs-restore — exit 0", cli("docs-restore").status, 0);
  const rd = readFileSync(join(work, `${JOBS.docs}.rendered.yaml`), "utf8");
  ok("CLI docs-restore — Job : préfixe normalized/, prod interdite, signataire dédié", rd.includes(`DOCS_RESTORE_PREFIX, value: "${P}"`) && rd.includes(`FORBIDDEN_DST_BUCKETS, value: "${PROD}"`) && rd.includes("name: geo-backup-restore-docs"));
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
