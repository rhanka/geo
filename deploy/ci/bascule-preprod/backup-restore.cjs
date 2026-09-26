'use strict';
// =============================================================================
// backup-restore.cjs — étapes IN-POD de la bascule geo MODE=restore|list :
// restaurer la préprod geo DEPUIS un backup quotidien de geo-backup
// (deploy/ci/backup/ : pg/<D>/geo.dump, docs/, docs-inventory/<D>.json,
// manifests/<D>.json, manifests/latest.json). Port du script immo
// (rhanka/radar-immobilier#777), mêmes gardes ; écarts geo : formats
// `geo-backup-*/v1`, dump `pg/<D>/<EXPECTED_DATABASE>.dump` (vérifié par resolve —
// sha256 recalculé en flux — puis restauré dans le postgis préprod par fetch-dump +
// pg_restore, S2), objets servis = sous-préfixe `normalized/` des docs, copie
// multipart au-delà de 5 GiB.
//
// Ce fichier ne tourne JAMAIS sur le runner GitHub : restore-mode.mjs l'embarque
// tel quel dans les templates de Job (`node -e`, image geo-api = Node +
// @aws-sdk/client-s3, 0 python, 0 image nouvelle). Étape choisie par BR_STEP :
//   resolve  Job de lecture, AVANT toute mutation : BACKUP_ID (latest | AAAA-MM-JJ)
//            → date D ; gardes : manifeste `complete`, garde 24 h pour `latest`
//            (ALLOW_STALE_BACKUP), sidecar sha256 du dump == manifeste, taille,
//            sha256 du dump RECALCULÉ en flux (VERIFY_DUMP_SHA256), inventaire
//            présent. Émet le PIN (D + sha256 manifeste/dump) revérifié ensuite.
//   list     Job de lecture : chaque manifeste daté encore listé.
//   fetch-dump initContainer du Job de restauration PG (S2, lecteur) : relit
//            manifests/D.json (sha256 = PIN de resolve), télécharge pg/D/<db>.dump
//            (version du manifeste) en calculant son sha256 et REFUSE sauf égalité
//            manifeste = sidecar = PIN ; écrit WORK_DIR/<db>.dump + WORK_DIR/backup.env
//            (date, sha256, nombre d'entrées TOC attendu, base du dump).
//   docs     Job de restauration des objets servis : lecteur = manifeste +
//            inventaire ; identité de copie = listing des versions de
//            <backup>/docs/<préfixe>, listing préprod et copies. Restaure dans le
//            bucket préprod l'état AU JOUR D du préfixe servi d'après
//            docs-inventory/D.json par CopyObject CÔTÉ SERVEUR depuis
//            <backup>/docs/<clé>?versionId=<v> (UploadPartCopy au-delà de 5 GiB),
//            ADDITIF (aucune suppression), puis recon dest ⊇ inventaire(D).
//            DOCS_DRY=1 = plan seul, 0 copie.
//   recon    même template, recon seule (G4 avant le rollout).
//
// VERDICT SEUL : logs et message de fin (/dev/termination-log, lu par le runner
// dans le .status du pod — jamais `kubectl logs`) portent dates, statuts, tailles,
// sha256 et COMPTES. Jamais une clé d'objet ni un identifiant.
// OVH : `s3:GetObjectVersion` est refusé dans les policies ; une lecture versionnée
// est un GetObject / CopyObject avec versionId, couverte par GetObject.
//
// SORTIE : 0 ok · 1 erreur (réseau, S3, intégrité) · 2 refus (garde).
// =============================================================================
/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const crypto = require('node:crypto');
const process = require('node:process');
const console = require('node:console');
const { Buffer } = require('node:buffer');

const EXIT = Object.freeze({ OK: 0, ERROR: 1, REFUSED: 2 });
class RestoreError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = 'RestoreError';
    this.exitCode = exitCode;
  }
}
const refused = (message) => new RestoreError(EXIT.REFUSED, message);
const failed = (message) => new RestoreError(EXIT.ERROR, message);

const HOUR_MS = 3600000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const DB_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const TERMINATION_MAX_BYTES = 3900; // k8s plafonne le message de fin à 4096 octets
const COPY_OBJECT_MAX = 5 * 1024 * 1024 * 1024; // S3 plafonne CopyObject à 5 GiB
const PART_BYTES = 512 * 1024 * 1024;
const LAYOUT = Object.freeze({ docsPrefix: 'docs/', manifestsPrefix: 'manifests/', latestKey: 'manifests/latest.json' });
// Buckets prod et backup de geo : destinations TOUJOURS interdites de la copie S3',
// quelles que soient les variables rendues dans le Job.
const HARD_FORBIDDEN_DST_BUCKETS = Object.freeze(['sentropic-geo', 'geo-backup']);
const formatId = (db, kind) => `${db}-backup-${kind}/v1`;

// ── fonctions pures ──────────────────────────────────────────────────────────
function isValidDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const ms = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}
function keysFor(date, db) {
  if (!DB_NAME_RE.test(String(db || ''))) throw refused('nom de base invalide');
  return {
    dump: `pg/${date}/${db}.dump`,
    dumpSha: `pg/${date}/${db}.dump.sha256`,
    inventory: `docs-inventory/${date}.json`,
    manifest: `manifests/${date}.json`,
  };
}
function withScheme(endpoint) {
  const e = String(endpoint || '').trim();
  if (!e) return '';
  return /^https?:\/\//i.test(e) ? e : 'https://' + e;
}
function encodeKey(k) { return encodeURIComponent(k).replace(/%2F/g, '/'); }
function normEtag(e) { return e ? String(e).replace(/"/g, '').trim() : ''; }
function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function safeToken(v) { const s = String(v ?? ''); return /^[a-z0-9._-]{1,32}$/i.test(s) ? s : 'invalid'; }
function parseSha256Line(text) {
  const m = /^([0-9a-f]{64})\s+\*?(\S.*)$/.exec(String(text || '').trim());
  return m ? m[1] : null;
}
function errName(e) {
  const status = e && e.$metadata && e.$metadata.httpStatusCode;
  return `${(e && (e.name || e.Code || e.code)) || 'Error'}${status ? '/' + status : ''}`;
}
function isNotFound(e) {
  const status = e && e.$metadata && e.$metadata.httpStatusCode;
  return status === 404 || (e && ['NoSuchKey', 'NotFound', 'NoSuchVersion'].includes(e.name));
}
function isAccessDenied(e) {
  return !!(e && (e.name === 'AccessDenied' || (e.$metadata && e.$metadata.httpStatusCode === 403)));
}

// BACKUP_ID = 'latest' (défaut) ou une date UTC. La valeur brute n'est jamais répétée.
function parseBackupId(raw, today) {
  const id = String(raw ?? '').trim();
  if (id === '' || id === 'latest') return { kind: 'latest', id: 'latest' };
  if (!isValidDate(id)) throw refused("BACKUP_ID doit valoir 'latest' ou une date AAAA-MM-JJ valide");
  if (today && id > today) throw refused(`BACKUP_ID ${id} est dans le futur (aujourd'hui ${today} UTC)`);
  return { kind: 'date', id, date: id };
}

// latest → manifests/latest.json latestComplete (jamais le dernier partiel).
function chooseDate(parsed, latest, db) {
  if (parsed.kind === 'date') return { date: parsed.date, source: 'explicit', pointerSha256: null };
  if (!latest || typeof latest !== 'object') throw refused('manifests/latest.json absent ou illisible : aucun backup à résoudre');
  const lc = latest.latestComplete;
  if (!lc || !isValidDate(lc.date)) throw refused('manifests/latest.json ne référence aucun backup complet (latestComplete vide)');
  const k = keysFor(lc.date, db);
  if (lc.manifestKey && lc.manifestKey !== k.manifest) throw refused('latestComplete.manifestKey ne correspond pas à sa date');
  // geo : latestComplete porte son propre manifestSha256 ; sinon celui du pointeur quand il décrit D.
  let pointerSha256 = SHA_RE.test(String(lc.manifestSha256 || '')) ? lc.manifestSha256 : null;
  if (!pointerSha256 && latest.date === lc.date && latest.manifestKey === k.manifest && SHA_RE.test(String(latest.manifestSha256 || ''))) {
    pointerSha256 = latest.manifestSha256;
  }
  return { date: lc.date, source: 'latestComplete', pointerSha256 };
}

// Un manifeste n'est restaurable que s'il est l'enregistrement complet du jour D.
function checkManifest(m, date, db) {
  if (!m || typeof m !== 'object') throw refused(`manifeste du ${date} absent ou illisible (jamais écrit, ou purgé par la rétention)`);
  if (m.status !== 'complete') throw refused(`le backup ${date} a le statut '${safeToken(m.status)}' — la restauration exige 'complete'`);
  const k = keysFor(date, db);
  const problems = [];
  if (m.format !== formatId(db, 'manifest')) problems.push('format de manifeste inconnu');
  if (m.date !== date) problems.push('date du manifeste différente de la date demandée');
  if (!m.pg || m.pg.key !== k.dump) problems.push(`pg.key n'est pas pg/<date>/${db}.dump`);
  if (!m.pg || !SHA_RE.test(String(m.pg.sha256 || ''))) problems.push('pg.sha256 absent');
  if (!m.pg || !(Number(m.pg.sizeBytes) > 0)) problems.push('pg.sizeBytes absent');
  if (!m.docs || m.docs.inventoryKey !== k.inventory) problems.push("docs.inventoryKey n'est pas docs-inventory/<date>.json");
  if (!m.docs || !SHA_RE.test(String(m.docs.inventorySha256 || ''))) problems.push('docs.inventorySha256 absent');
  if (problems.length) throw refused(`manifeste ${date} refusé : ${problems.join(' ; ')}`);
  return m;
}

// Référence d'âge = point de données : début du dump, puis début/fin du backup, puis D à 00:00 UTC.
function backupReferenceTime(m) {
  const candidates = [
    ['pg.dumpStartedAt', m && m.pg && m.pg.dumpStartedAt],
    ['startedAt', m && m.startedAt],
    ['completedAt', m && m.completedAt],
    ['date', m && isValidDate(m.date) ? m.date + 'T00:00:00Z' : null],
  ];
  for (const [source, at] of candidates) {
    if (at && Number.isFinite(Date.parse(at))) return { source, at: new Date(Date.parse(at)).toISOString() };
  }
  return { source: 'unknown', at: null };
}

// `latest` plus vieux que maxAgeHours → refus sauf allowStale ; une date explicite
// n'est jamais bloquée par son âge (seulement journalisé).
function staleGuard({ parsed, manifest, nowMs, maxAgeHours = 24, allowStale = false }) {
  const ref = backupReferenceTime(manifest);
  const ageHours = ref.at ? Math.round(((nowMs - Date.parse(ref.at)) / HOUR_MS) * 10) / 10 : null;
  const stale = ageHours === null || ageHours > maxAgeHours;
  if (parsed.kind === 'latest' && stale && !allowStale) {
    throw refused(`le dernier backup complet ${manifest.date} a ${ageHours === null ? 'un âge inconnu' : ageHours + ' h'} ` +
      `(> ${maxAgeHours} h, référence ${ref.source}) ; ALLOW_STALE_BACKUP=true ou BACKUP_ID=${manifest.date} explicite`);
  }
  return { ageHours, stale, reference: ref.source, referenceAt: ref.at, overridden: parsed.kind === 'latest' && stale && !!allowStale, blocking: parsed.kind === 'latest' };
}

function checkInventory(inv, { manifest, date, sha256, db }) {
  if (sha256 !== manifest.docs.inventorySha256) throw failed(`sha256 de docs-inventory/${date}.json différent du manifeste`);
  const problems = [];
  if (!inv || typeof inv !== 'object') throw failed(`docs-inventory/${date}.json illisible`);
  if (inv.format !== formatId(db, 'docs-inventory')) problems.push("format d'inventaire inconnu");
  if (inv.date !== date) problems.push("date d'inventaire différente");
  if (!Array.isArray(inv.objects)) problems.push('objects absent');
  else {
    if (inv.counts && Number(inv.counts.objects) !== inv.objects.length) problems.push('counts.objects différent de objects');
    if (Number.isFinite(Number(manifest.docs.objects)) && Number(manifest.docs.objects) !== inv.objects.length) problems.push('docs.objects du manifeste différent de l\'inventaire');
  }
  if (!Number.isFinite(Date.parse(inv.createdAt))) problems.push('createdAt absent');
  if (problems.length) throw failed(`docs-inventory/${date}.json refusé : ${problems.join(' ; ')}`);
  return inv;
}

// Sous-ensemble servi de l'inventaire (préfixe, ex. normalized/).
function servedEntries(inventory, prefix) {
  return inventory.objects.filter((e) => typeof e.key === 'string' && e.key.startsWith(prefix));
}

function indexVersions(versions, prefix = LAYOUT.docsPrefix) {
  const idx = new Map();
  for (const v of versions || []) {
    if (!v || typeof v.Key !== 'string' || !v.Key.startsWith(prefix)) continue;
    const key = v.Key.slice(prefix.length);
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push({
      versionId: v.VersionId === undefined || v.VersionId === null ? null : String(v.VersionId),
      etag: normEtag(v.ETag), size: Number(v.Size),
      lastModified: v.LastModified ? new Date(v.LastModified).getTime() : NaN,
    });
  }
  return idx;
}

// Version du backup qui porte le contenu de D : versionId enregistré (taille + ETag
// concordants), sinon une version d'ETag = backupEtag de l'inventaire et de même
// taille (la plus récente non postérieure à l'inventaire, sinon la plus ancienne
// identique écrite après — même ETag + taille = même contenu).
function chooseVersion(entry, versions, inventoryCreatedAtMs) {
  const list = versions || [];
  const want = normEtag(entry.backupEtag);
  const size = Number(entry.size);
  if (entry.versionId) {
    const exact = list.find((v) => v.versionId === String(entry.versionId));
    if (exact) {
      if (exact.size !== size) return { error: 'size-mismatch' };
      if (want && exact.etag && exact.etag !== want) return { error: 'etag-mismatch' };
      return { versionId: exact.versionId, how: 'version-id' };
    }
  }
  if (!want) return { error: entry.versionId ? 'version-gone' : 'no-backup-etag' };
  const same = list.filter((v) => v.etag === want && v.size === size);
  if (!same.length) return { error: list.length ? 'etag-not-found' : 'no-version' };
  const before = same.filter((v) => Number.isFinite(v.lastModified) && v.lastModified <= inventoryCreatedAtMs).sort((a, b) => b.lastModified - a.lastModified);
  if (before.length) return { versionId: before[0].versionId, how: 'etag-before-inventory' };
  const later = [...same].sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0));
  return { versionId: later[0].versionId, how: 'etag-identical-later' };
}

function destUpToDate(entry, d) {
  if (!d || Number(d.Size) !== Number(entry.size)) return false;
  const de = normEtag(d.ETag);
  return !!de && (de === normEtag(entry.etag) || de === normEtag(entry.backupEtag));
}

// versionsIndex = null quand le listing des versions est refusé : versionId
// enregistré utilisé tel quel, les autres vérifiés par HEAD (needsHead).
// Entrées `excluded` (préfixes que le backup écarte volontairement, backup
// toujours `complete`) : traitées comme le backup les traite — non exigées,
// comptées à part (`excluded`) et journalisées. Tout autre état ≠ `backed-up`
// (pending, failed : jamais dans un backup complet) reste `notInBackup` et bloque.
function planDocsRestore({ entries, createdAt, versionsIndex, destIndex }) {
  const createdAtMs = Date.parse(createdAt);
  const plan = { objects: 0, upToDate: 0, excluded: 0, notInBackup: 0, unresolved: 0, unresolvedReasons: {}, toCopy: [], needsHead: [], bytesToCopy: 0, how: {} };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const e of entries) {
    plan.objects += 1;
    if (e.state === 'excluded') { plan.excluded += 1; continue; }
    if (e.state !== 'backed-up') { plan.notInBackup += 1; continue; }
    if (destUpToDate(e, destIndex.get(e.key))) { plan.upToDate += 1; continue; }
    if (!versionsIndex) {
      if (e.versionId) { plan.toCopy.push({ key: e.key, versionId: String(e.versionId), size: Number(e.size) }); plan.bytesToCopy += Number(e.size) || 0; bump(plan.how, 'version-id-unlisted'); }
      else if (normEtag(e.backupEtag)) plan.needsHead.push({ key: e.key, size: Number(e.size), backupEtag: normEtag(e.backupEtag) });
      else { plan.unresolved += 1; bump(plan.unresolvedReasons, 'no-backup-etag'); }
      continue;
    }
    const c = chooseVersion(e, versionsIndex.get(e.key), createdAtMs);
    if (c.error) { plan.unresolved += 1; bump(plan.unresolvedReasons, c.error); continue; }
    plan.toCopy.push({ key: e.key, versionId: c.versionId, size: Number(e.size) });
    plan.bytesToCopy += Number(e.size) || 0;
    bump(plan.how, c.how);
  }
  return plan;
}

// dest ⊇ inventaire(D) sur le préfixe servi, Key + Size ; objets préprod en plus tolérés (additif).
// Entrées `excluded` non exigées (comptées à part), comme dans planDocsRestore.
function reconInventory(entries, destIndex, prefix) {
  const r = { checked: 0, missing: 0, sizeMismatch: 0, excluded: 0, notInBackup: 0, extra: 0 };
  const keys = new Set();
  for (const e of entries) {
    keys.add(e.key);
    if (e.state === 'excluded') { r.excluded += 1; continue; }
    if (e.state !== 'backed-up') { r.notInBackup += 1; continue; }
    r.checked += 1;
    const d = destIndex.get(e.key);
    if (!d) r.missing += 1;
    else if (Number(d.Size) !== Number(e.size)) r.sizeMismatch += 1;
  }
  for (const k of destIndex.keys()) if (k.startsWith(prefix) && !keys.has(k)) r.extra += 1;
  r.ok = r.missing === 0 && r.sizeMismatch === 0 && r.notInBackup === 0;
  return r;
}

function copySourceFor(bucket, key, versionId) {
  const base = '/' + bucket + '/' + encodeKey(LAYOUT.docsPrefix + key);
  return versionId ? base + '?versionId=' + encodeURIComponent(versionId) : base;
}

function partRanges(size, partBytes = PART_BYTES) {
  const out = [];
  for (let start = 0, n = 1; start < size; start += partBytes, n += 1) out.push({ n, range: `bytes=${start}-${Math.min(size, start + partBytes) - 1}` });
  return out;
}

function buildListing({ bucket, latest, manifests, maxBytes = TERMINATION_MAX_BYTES }) {
  const backups = [...manifests].filter((m) => m && isValidDate(m.date))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((m) => ({
      date: m.date,
      status: safeToken(m.status),
      pgBytes: Number(m.pg && m.pg.sizeBytes) || null,
      pgSha256: m.pg && SHA_RE.test(String(m.pg.sha256 || '')) ? m.pg.sha256.slice(0, 16) : null,
      docs: m.docs && Number.isFinite(Number(m.docs.objects)) ? Number(m.docs.objects) : null,
      startedAt: backupReferenceTime(m).at,
    }));
  const out = {
    v: 1, tenant: 'geo', bucket,
    latest: latest && isValidDate(latest.date) ? latest.date : null,
    latestComplete: latest && latest.latestComplete && isValidDate(latest.latestComplete.date) ? latest.latestComplete.date : null,
    count: backups.length, truncated: false, backups,
  };
  while (Buffer.byteLength(JSON.stringify(out)) > maxBytes && out.backups.length > 1) { out.backups.pop(); out.truncated = true; }
  return out;
}

// ── configuration ────────────────────────────────────────────────────────────
function readConfig(env, step) {
  const req = (name) => {
    const v = String(env[name] || '').trim();
    if (!v) throw refused(`${name} absent`);
    return v;
  };
  const cfg = {
    step,
    endpoint: withScheme(req('S3_ENDPOINT')),
    region: String(env.S3_REGION || '').trim() || 'us-east-1',
    forcePathStyle: String(env.S3_FORCE_PATH_STYLE || 'true').trim() !== 'false',
    reader: { accessKeyId: req('READER_ACCESS_KEY'), secretAccessKey: req('READER_SECRET_KEY') },
    backupBucket: req('BACKUP_BUCKET'),
    expectedBackupBucket: String(env.EXPECTED_BACKUP_BUCKET || '').trim(),
    db: req('EXPECTED_DATABASE'),
    pinnedEndpoint: String(env.PINNED_S3_ENDPOINT || '').trim(),
  };
  if (!DB_NAME_RE.test(cfg.db)) throw refused('EXPECTED_DATABASE invalide');
  // Garde positive : un Secret mal provisionné ne doit jamais faire lire un autre bucket.
  if (cfg.expectedBackupBucket && cfg.backupBucket !== cfg.expectedBackupBucket) throw refused('BACKUP_BUCKET (Secret lecteur) différent de EXPECTED_BACKUP_BUCKET');
  // Endpoint figé (egress autorisé vers S3-BHS seulement).
  if (cfg.pinnedEndpoint && cfg.endpoint !== cfg.pinnedEndpoint) throw refused('S3_ENDPOINT différent de l\'endpoint figé');
  if (step === 'resolve') {
    cfg.backupId = String(env.BACKUP_ID || 'latest');
    cfg.allowStale = String(env.ALLOW_STALE_BACKUP || 'false').trim() === 'true';
    cfg.verifyDumpSha = String(env.VERIFY_DUMP_SHA256 || 'true').trim() !== 'false';
    const h = Number(String(env.MAX_AGE_HOURS || '24').trim());
    if (!Number.isFinite(h) || h <= 0) throw refused('MAX_AGE_HOURS invalide');
    cfg.maxAgeHours = h;
  }
  if (step === 'fetch-dump') {
    cfg.date = req('BACKUP_DATE');
    if (!isValidDate(cfg.date)) throw refused('BACKUP_DATE invalide');
    cfg.pinManifestSha256 = req('PIN_MANIFEST_SHA256');
    if (!SHA_RE.test(cfg.pinManifestSha256)) throw refused('PIN_MANIFEST_SHA256 invalide');
    cfg.pinPgSha256 = req('PIN_PG_SHA256');
    if (!SHA_RE.test(cfg.pinPgSha256)) throw refused('PIN_PG_SHA256 invalide');
    cfg.workDir = String(env.WORK_DIR || '/work');
  }
  if (step === 'docs' || step === 'recon') {
    cfg.date = req('BACKUP_DATE');
    if (!isValidDate(cfg.date)) throw refused('BACKUP_DATE invalide');
    cfg.pinManifestSha256 = req('PIN_MANIFEST_SHA256');
    if (!SHA_RE.test(cfg.pinManifestSha256)) throw refused('PIN_MANIFEST_SHA256 invalide');
    cfg.copier = { accessKeyId: req('COPIER_ACCESS_KEY'), secretAccessKey: req('COPIER_SECRET_KEY') };
    cfg.dstBucket = req('DST_BUCKET');
    cfg.prefix = req('DOCS_RESTORE_PREFIX');
    if (!/^[a-z0-9][a-z0-9._-]*\/$/.test(cfg.prefix)) throw refused('DOCS_RESTORE_PREFIX invalide (ex. normalized/)');
    cfg.grantee = String(env.COPY_GRANTEE || '').trim();
    cfg.dry = String(env.DOCS_DRY || '0').trim() === '1';
    const c = Math.floor(Number(env.COPY_CONCURRENCY || '8'));
    cfg.concurrency = Number.isFinite(c) ? Math.max(1, Math.min(32, c)) : 8;
    const forbidden = String(env.FORBIDDEN_DST_BUCKETS || '').split(',').map((s) => s.trim()).filter(Boolean);
    // Le runner nomme toujours le bucket prod : une liste vide = Job mal rendu, jamais
    // « rien d'interdit ».
    if (!forbidden.length) throw refused('FORBIDDEN_DST_BUCKETS vide : le bucket prod doit être nommé');
    // Jamais d'écriture dans le bucket de backup ni dans un bucket de prod — les
    // buckets prod et backup de geo sont en plus figés ici, quelles que soient les variables.
    const hard = [...HARD_FORBIDDEN_DST_BUCKETS, cfg.backupBucket];
    if (hard.includes(cfg.dstBucket) || forbidden.includes(cfg.dstBucket)) throw refused('DST_BUCKET est le bucket de backup ou un bucket interdit (prod)');
  }
  return cfg;
}

// ── S3 (client + sdk injectés : le selftest passe un faux en mémoire) ────────
async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  const chunks = [];
  for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}
async function getBufferOrNull(c, Bucket, Key) {
  try {
    const got = await c.s3.send(new c.sdk.GetObjectCommand({ Bucket, Key }));
    return { buf: await bodyToBuffer(got.Body) };
  } catch (e) { if (isNotFound(e)) return null; throw e; }
}
async function getJsonWithSha(c, Bucket, Key) {
  const got = await getBufferOrNull(c, Bucket, Key);
  if (!got) return null;
  let json = null;
  try { json = JSON.parse(got.buf.toString('utf8')); } catch { json = null; }
  return { json, sha256: sha256Hex(got.buf) };
}
async function headOrNull(c, Bucket, Key) {
  try { return await c.s3.send(new c.sdk.HeadObjectCommand({ Bucket, Key })); } catch (e) { if (isNotFound(e)) return null; throw e; }
}
async function listAll(c, Bucket, Prefix) {
  const all = [];
  let ContinuationToken;
  do {
    const out = await c.s3.send(new c.sdk.ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
    for (const o of out.Contents || []) all.push(o);
    ContinuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return all;
}
async function listAllVersions(c, Bucket, Prefix) {
  const all = [];
  let KeyMarker; let VersionIdMarker;
  do {
    const out = await c.s3.send(new c.sdk.ListObjectVersionsCommand({ Bucket, Prefix, KeyMarker, VersionIdMarker }));
    for (const v of out.Versions || []) all.push(v);
    const more = !!out.IsTruncated;
    KeyMarker = more ? out.NextKeyMarker : undefined;
    VersionIdMarker = more ? out.NextVersionIdMarker : undefined;
  } while (KeyMarker);
  return all;
}
// sha256 + taille d'un objet en flux, octets jetés (vérification de resolve ; la
// restauration PG télécharge le dump avec fetch-dump).
async function streamSha(c, Bucket, Key, VersionId) {
  const got = await c.s3.send(new c.sdk.GetObjectCommand(VersionId ? { Bucket, Key, VersionId } : { Bucket, Key }));
  const h = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of got.Body) { const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); h.update(b); size += b.length; }
  return { sha256: h.digest('hex'), size };
}
function writeTermination(file, obj) {
  let text = JSON.stringify(obj);
  if (Buffer.byteLength(text) > TERMINATION_MAX_BYTES) text = JSON.stringify({ ok: obj.ok, step: obj.step, truncated: true });
  try { fs.writeFileSync(file, text); } catch { /* best-effort : le code de sortie reste le verdict */ }
}

async function loadPinnedManifest(c, cfg) {
  const got = await getJsonWithSha(c, cfg.backupBucket, keysFor(cfg.date, cfg.db).manifest);
  if (!got) throw refused(`manifeste ${cfg.date} plus lisible`);
  if (got.sha256 !== cfg.pinManifestSha256) throw refused(`manifeste ${cfg.date} modifié depuis resolve (sha256 ≠ PIN) : relancer la bascule`);
  return checkManifest(got.json, cfg.date, cfg.db);
}
async function loadInventory(c, cfg, manifest) {
  const got = await getBufferOrNull(c, cfg.backupBucket, manifest.docs.inventoryKey);
  if (!got) throw failed(`docs-inventory/${cfg.date}.json illisible`);
  let inv = null;
  try { inv = JSON.parse(got.buf.toString('utf8')); } catch { inv = null; }
  return checkInventory(inv, { manifest, date: cfg.date, sha256: sha256Hex(got.buf), db: cfg.db });
}
async function destIndexOf(c, bucket, prefix) {
  const idx = new Map();
  for (const o of await listAll(c, bucket, prefix)) idx.set(o.Key, o);
  return idx;
}

// ── étapes ───────────────────────────────────────────────────────────────────
async function runResolve({ cfg, reader, now, log }) {
  const today = new Date(now()).toISOString().slice(0, 10);
  const parsed = parseBackupId(cfg.backupId, today);
  const latestGot = await getJsonWithSha(reader, cfg.backupBucket, LAYOUT.latestKey);
  const choice = chooseDate(parsed, latestGot && latestGot.json, cfg.db);
  const date = choice.date;
  const k = keysFor(date, cfg.db);
  const got = await getJsonWithSha(reader, cfg.backupBucket, k.manifest);
  const manifest = checkManifest(got && got.json, date, cfg.db);
  if (choice.pointerSha256 && choice.pointerSha256 !== got.sha256) throw failed(`sha256 du manifeste ${date} différent de manifests/latest.json`);
  const guard = staleGuard({ parsed, manifest, nowMs: now(), maxAgeHours: cfg.maxAgeHours, allowStale: cfg.allowStale });
  const side = await getBufferOrNull(reader, cfg.backupBucket, k.dumpSha);
  if ((side ? parseSha256Line(side.buf.toString('utf8')) : null) !== manifest.pg.sha256) throw failed(`${k.dumpSha} absent ou différent du manifeste`);
  const head = await headOrNull(reader, cfg.backupBucket, k.dump);
  if (!head || Number(head.ContentLength) !== Number(manifest.pg.sizeBytes)) throw failed(`${k.dump} absent ou de taille différente du manifeste`);
  let dumpVerified = false;
  if (cfg.verifyDumpSha) {
    const s = await streamSha(reader, cfg.backupBucket, k.dump, manifest.pg.versionId || null);
    if (s.size !== Number(manifest.pg.sizeBytes) || s.sha256 !== manifest.pg.sha256) throw failed(`sha256 recalculé de ${k.dump} différent du manifeste`);
    dumpVerified = true;
  }
  const inv = await headOrNull(reader, cfg.backupBucket, k.inventory);
  if (!inv || !(Number(inv.ContentLength) > 0)) throw failed(`docs-inventory/${date}.json absent`);
  const pin = {
    ok: true, step: 'resolve', v: 1, tenant: 'geo',
    backupId: parsed.id, date, source: choice.source, status: manifest.status,
    manifestKey: k.manifest, manifestSha256: got.sha256,
    pgKey: k.dump, pgSha256: manifest.pg.sha256, pgSizeBytes: Number(manifest.pg.sizeBytes), dumpShaRecomputed: dumpVerified,
    inventoryKey: k.inventory, inventorySha256: manifest.docs.inventorySha256,
    docsObjects: Number.isFinite(Number(manifest.docs.objects)) ? Number(manifest.docs.objects) : null,
    dumpStartedAt: guard.referenceAt, ageHours: guard.ageHours, ageReference: guard.reference,
    stale: guard.stale, staleOverridden: guard.overridden, ageBlocking: guard.blocking,
  };
  if (guard.stale && !guard.blocking) log(`WARN backup ${date} vieux de ${guard.ageHours} h (BACKUP_ID explicite : âge non bloquant)`);
  if (guard.overridden) log(`WARN dernier backup ${date} vieux de ${guard.ageHours} h — accepté par ALLOW_STALE_BACKUP=true`);
  log(`RESOLVE OK backup_id=${parsed.id} date=${date} status=complete age_h=${guard.ageHours} pg.bytes=${pin.pgSizeBytes} ` +
    `pg.sha256=${pin.pgSha256} recalculé=${dumpVerified} manifest.sha256=${pin.manifestSha256} docs.objects=${pin.docsObjects}`);
  return { exitCode: EXIT.OK, termination: pin };
}

async function runList({ cfg, reader, log }) {
  const latestGot = await getJsonWithSha(reader, cfg.backupBucket, LAYOUT.latestKey);
  const keys = (await listAll(reader, cfg.backupBucket, LAYOUT.manifestsPrefix))
    .map((o) => o.Key).filter((key) => /^manifests\/\d{4}-\d{2}-\d{2}\.json$/.test(key)).sort().reverse();
  const manifests = [];
  for (const key of keys) {
    const got = await getJsonWithSha(reader, cfg.backupBucket, key);
    if (got && got.json) manifests.push(got.json);
  }
  const listing = buildListing({ bucket: cfg.backupBucket, latest: latestGot && latestGot.json, manifests });
  log(`LIST OK backups=${listing.count} latest=${listing.latest} latest_complete=${listing.latestComplete}${listing.truncated ? ' (tronqué)' : ''}`);
  return { exitCode: EXIT.OK, termination: { ok: true, step: 'list', ...listing } };
}

// Téléchargement du dump en flux vers un fichier, sha256 calculé au passage.
async function downloadWithSha(c, Bucket, Key, VersionId, file) {
  const got = await c.s3.send(new c.sdk.GetObjectCommand(VersionId ? { Bucket, Key, VersionId } : { Bucket, Key }));
  const h = crypto.createHash('sha256');
  let size = 0;
  const out = fs.createWriteStream(file, { mode: 0o600 });
  for await (const chunk of got.Body) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    h.update(b);
    size += b.length;
    if (!out.write(b)) await once(out, 'drain');
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  return { sha256: h.digest('hex'), size };
}

// S2 (restauration PG) : le dump n'est écrit pour pg_restore que s'il est l'octet
// près celui du manifeste épinglé par resolve (manifeste = sidecar = PIN).
async function runFetchDump({ cfg, reader, log }) {
  const manifest = await loadPinnedManifest(reader, cfg);
  if (manifest.pg.sha256 !== cfg.pinPgSha256) throw refused('pg.sha256 du manifeste différent du PIN');
  const k = keysFor(cfg.date, cfg.db);
  const side = await getBufferOrNull(reader, cfg.backupBucket, k.dumpSha);
  if (!side || parseSha256Line(side.buf.toString('utf8')) !== manifest.pg.sha256) throw failed('sidecar sha256 du dump absent ou différent du manifeste');
  await fsp.mkdir(cfg.workDir, { recursive: true });
  const file = path.join(cfg.workDir, `${cfg.db}.dump`);
  const got = await downloadWithSha(reader, cfg.backupBucket, k.dump, manifest.pg.versionId || null, file);
  if (got.size !== Number(manifest.pg.sizeBytes)) throw failed(`taille du dump ${got.size} différente du manifeste ${manifest.pg.sizeBytes}`);
  if (got.sha256 !== manifest.pg.sha256) throw failed('sha256 du dump différent du manifeste (restauration refusée)');
  const toc = Number.isFinite(Number(manifest.pg.tocEntries)) && Number(manifest.pg.tocEntries) > 0 ? Number(manifest.pg.tocEntries) : '';
  const facts = [
    `BACKUP_DATE=${cfg.date}`,
    `PG_SHA256=${got.sha256}`,
    `EXPECTED_TOC_ENTRIES=${toc}`,
    `DUMP_DATABASE=${safeToken(manifest.pg.database || cfg.db)}`,
    `DUMP_FILE=${cfg.db}.dump`,
  ].join('\n') + '\n';
  await fsp.writeFile(path.join(cfg.workDir, 'backup.env'), facts, { mode: 0o600 });
  log(`FETCH OK date=${cfg.date} octets=${got.size} sha256=${got.sha256} (= manifeste = sidecar = PIN) toc_attendu=${toc || 'inconnu'}`);
  return { exitCode: EXIT.OK, termination: { ok: true, step: 'fetch-dump', date: cfg.date, pgSha256: got.sha256, pgSizeBytes: got.size, expectedTocEntries: toc || null } };
}

async function resolveByHead(copier, cfg, plan) {
  let next = 0;
  const worker = async () => {
    while (next < plan.needsHead.length) {
      const e = plan.needsHead[next++];
      const h = await headOrNull(copier, cfg.backupBucket, LAYOUT.docsPrefix + e.key);
      if (h && Number(h.ContentLength) === e.size && normEtag(h.ETag) === e.backupEtag) {
        plan.toCopy.push({ key: e.key, versionId: null, size: e.size });
        plan.bytesToCopy += e.size;
        plan.how['current-etag-checked'] = (plan.how['current-etag-checked'] || 0) + 1;
      } else {
        plan.unresolved += 1;
        const why = h ? 'current-differs' : 'no-current';
        plan.unresolvedReasons[why] = (plan.unresolvedReasons[why] || 0) + 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(cfg.concurrency, plan.needsHead.length) }, () => worker()));
  plan.needsHead = [];
}

// Copie serveur d'un objet ; UploadPartCopy (parts épinglées à la même version) au-delà de 5 GiB.
async function copyOne(copier, cfg, item, grant) {
  const src = copySourceFor(cfg.backupBucket, item.key, item.versionId);
  if (item.size <= COPY_OBJECT_MAX) {
    await copier.s3.send(new copier.sdk.CopyObjectCommand({ Bucket: cfg.dstBucket, Key: item.key, CopySource: src, MetadataDirective: 'COPY', ...grant }));
    return;
  }
  const { UploadId } = await copier.s3.send(new copier.sdk.CreateMultipartUploadCommand({ Bucket: cfg.dstBucket, Key: item.key, ...grant }));
  try {
    const parts = [];
    for (const p of partRanges(item.size)) {
      const out = await copier.s3.send(new copier.sdk.UploadPartCopyCommand({ Bucket: cfg.dstBucket, Key: item.key, UploadId, PartNumber: p.n, CopySource: src, CopySourceRange: p.range }));
      parts.push({ PartNumber: p.n, ETag: out.CopyPartResult && out.CopyPartResult.ETag });
    }
    await copier.s3.send(new copier.sdk.CompleteMultipartUploadCommand({ Bucket: cfg.dstBucket, Key: item.key, UploadId, MultipartUpload: { Parts: parts } }));
  } catch (e) {
    await copier.s3.send(new copier.sdk.AbortMultipartUploadCommand({ Bucket: cfg.dstBucket, Key: item.key, UploadId })).catch(() => {});
    throw e;
  }
}

async function runDocs({ cfg, reader, copier, log }) {
  const manifest = await loadPinnedManifest(reader, cfg);
  const inventory = await loadInventory(reader, cfg, manifest);
  const entries = servedEntries(inventory, cfg.prefix);
  let versionsIndex = null;
  try {
    versionsIndex = indexVersions(await listAllVersions(copier, cfg.backupBucket, LAYOUT.docsPrefix + cfg.prefix));
  } catch (e) {
    if (!isAccessDenied(e)) throw e;
    log('WARN listing des versions de <backup>/docs/ refusé à l\'identité de copie : versionIds enregistrés utilisés tels quels, les autres vérifiés par HEAD');
  }
  const destIndex = await destIndexOf(copier, cfg.dstBucket, cfg.prefix);
  const plan = planDocsRestore({ entries, createdAt: inventory.createdAt, versionsIndex, destIndex });
  if (plan.needsHead.length) await resolveByHead(copier, cfg, plan);
  log(`PLAN date=${cfg.date} prefix=${cfg.prefix} inventaire=${plan.objects} a_jour=${plan.upToDate} a_copier=${plan.toCopy.length} ` +
    `octets=${plan.bytesToCopy} exclus=${plan.excluded} hors_backup=${plan.notInBackup} irresolus=${plan.unresolved} raisons=${JSON.stringify(plan.unresolvedReasons)} ` +
    `how=${JSON.stringify(plan.how)} dest=${destIndex.size} versions_listees=${versionsIndex !== null} dry=${cfg.dry}`);
  const base = { step: 'docs', date: cfg.date, prefix: cfg.prefix, dry: cfg.dry, inventory: plan.objects, upToDate: plan.upToDate, toCopy: plan.toCopy.length,
    bytesToCopy: plan.bytesToCopy, excluded: plan.excluded, notInBackup: plan.notInBackup, unresolved: plan.unresolved, unresolvedReasons: plan.unresolvedReasons };
  if (plan.excluded > 0) log(`NOTE ${plan.excluded} objet(s) de l'inventaire exclus par le backup lui-même (préfixes exclus) : non exigés, non restaurés`);
  if (plan.notInBackup > 0 || plan.unresolved > 0) {
    log(`DOCS REFUSÉ — ${plan.notInBackup} objet(s) absents du backup de ${cfg.date}, ${plan.unresolved} sans version restaurable (fail-closed)`);
    return { exitCode: EXIT.REFUSED, termination: { ok: false, ...base } };
  }
  if (cfg.dry) {
    log('DOCS DRY OK — chaque objet servi de l\'inventaire est restaurable (0 copie)');
    return { exitCode: EXIT.OK, termination: { ok: true, ...base, copied: 0 } };
  }
  const grant = cfg.grantee ? { GrantFullControl: 'id=' + cfg.grantee } : {};
  if (!cfg.grantee) log('WARN COPY_GRANTEE vide : objets copiés potentiellement illisibles par geo-api préprod (403)');
  let next = 0; let copied = 0; let copyErrors = 0; let errorsLogged = 0;
  const worker = async () => {
    while (next < plan.toCopy.length) {
      const item = plan.toCopy[next++];
      try { await copyOne(copier, cfg, item, grant); copied += 1; } catch (e) {
        copyErrors += 1;
        if (errorsLogged < 5) { errorsLogged += 1; log(`erreur de copie ${errName(e)} (clé non journalisée)`); }
      }
      if ((copied + copyErrors) % 1000 === 0) log(`progression ${copied + copyErrors}/${plan.toCopy.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(cfg.concurrency, plan.toCopy.length) }, () => worker()));
  const recon = reconInventory(entries, await destIndexOf(copier, cfg.dstBucket, cfg.prefix), cfg.prefix);
  const ok = copyErrors === 0 && recon.ok;
  log(`${ok ? 'DOCS OK' : 'DOCS ÉCHEC'} date=${cfg.date} copies=${copied} erreurs=${copyErrors} recon.verifies=${recon.checked} ` +
    `recon.manquants=${recon.missing} recon.taille_diff=${recon.sizeMismatch} dest_en_plus=${recon.extra} (additif)`);
  return { exitCode: ok ? EXIT.OK : EXIT.ERROR, termination: { ok, ...base, copied, copyErrors, recon } };
}

async function runRecon({ cfg, reader, copier, log }) {
  const manifest = await loadPinnedManifest(reader, cfg);
  const inventory = await loadInventory(reader, cfg, manifest);
  const recon = reconInventory(servedEntries(inventory, cfg.prefix), await destIndexOf(copier, cfg.dstBucket, cfg.prefix), cfg.prefix);
  log(`${recon.ok ? 'RECON OK' : 'RECON ÉCHEC'} date=${cfg.date} verifies=${recon.checked} manquants=${recon.missing} ` +
    `taille_diff=${recon.sizeMismatch} exclus=${recon.excluded} hors_backup=${recon.notInBackup} dest_en_plus=${recon.extra}`);
  return { exitCode: recon.ok ? EXIT.OK : EXIT.ERROR, termination: { ok: recon.ok, step: 'recon', date: cfg.date, ...recon } };
}

const STEPS = { resolve: runResolve, list: runList, 'fetch-dump': runFetchDump, docs: runDocs, recon: runRecon };

function makeClient(sdk, cfg, creds) {
  return new sdk.S3Client({
    endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: cfg.forcePathStyle, credentials: creds, maxAttempts: 5,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

async function runStep({ env, sdk, clients, now = Date.now, log }) {
  const step = String(env.BR_STEP || '').trim();
  const terminationLog = String(env.TERMINATION_LOG || '/dev/termination-log');
  try {
    if (!STEPS[step]) throw refused('BR_STEP inconnu');
    if (!sdk) throw failed('@aws-sdk/client-s3 introuvable (image geo-api attendue)');
    const cfg = readConfig(env, step);
    const reader = { sdk, s3: (clients && clients.reader) || makeClient(sdk, cfg, cfg.reader) };
    const copier = cfg.copier ? { sdk, s3: (clients && clients.copier) || makeClient(sdk, cfg, cfg.copier) } : null;
    const r = await STEPS[step]({ cfg, reader, copier, now, log });
    writeTermination(terminationLog, r.termination);
    return r;
  } catch (e) {
    const code = e instanceof RestoreError ? e.exitCode : EXIT.ERROR;
    writeTermination(terminationLog, { ok: false, step: safeToken(step), exit: code, reason: e instanceof RestoreError ? e.message : errName(e) });
    throw e;
  }
}

module.exports = {
  EXIT, RestoreError, LAYOUT, TERMINATION_MAX_BYTES, COPY_OBJECT_MAX, HARD_FORBIDDEN_DST_BUCKETS, isValidDate, keysFor, withScheme, normEtag, parseSha256Line, parseBackupId,
  chooseDate, checkManifest, backupReferenceTime, staleGuard, checkInventory, servedEntries, indexVersions, chooseVersion, destUpToDate,
  planDocsRestore, reconInventory, copySourceFor, partRanges, buildListing, readConfig, runStep,
};

if (require.main === module || module.id === '[eval]') {
  const step = String(process.env.BR_STEP || '?');
  const log = (m) => console.log(`[backup-restore:${safeToken(step)}] ${m}`);
  let sdk;
  try { sdk = require('@aws-sdk/client-s3'); } catch { sdk = null; }
  runStep({ env: process.env, sdk, log })
    .then((r) => process.exit(r.exitCode))
    .catch((e) => {
      const code = e instanceof RestoreError ? e.exitCode : EXIT.ERROR;
      log(`VERDICT ÉCHEC exit=${code} ${e instanceof RestoreError ? e.message : errName(e)}`);
      process.exit(code);
    });
}
