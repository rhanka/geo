#!/usr/bin/env node
// geo-preprod-sync.mjs — WRAPPER MINCE runnable de la jambe geo du cycle de récup
// prod→preprod (§5/§6.1). La logique PURE (sélection miroir-plein + build du manifeste
// de cohérence) est capitalisée + testée dans la lib `@sentropic/geo/preprod` ; ce
// script ne fait que l'I/O S3 autour d'elle.
//
// MIROIR PLEIN du préfixe `normalized/` prod → bucket preprod (data-driven, PAS de
// whitelist : geo-prod sert 3885 collections dont 1088 slug-nu → une whitelist
// sous-servirait). Copie SEULE (données publiques ; charge Loi 25 = immo-side).
// Idempotent + rejouable. Sens-unique STRICT : lit la prod, écrit SEULEMENT le
// bucket preprod. Ordonnancé par poc-k8s en Job in-cluster (fenêtre gatée i-cond S00).
//
// Creds : la source (read-only, scopée) est FOURNIE À PART dans `S3_SOURCE_*`
// (décision : pas de cred multi-bucket, scoping OVH `unknown`) → le runner bascule
// en get→put streaming (deux clients, isolation propre). Dest = `S3_*`.
//
// Usage : node scripts/geo-preprod-sync.mjs --coherence-id <id> [--source <s3uri>]
//            [--dest <s3uri>] [--prod-api <base>] [--dry-run] [--limit <n>] [--concurrency <n>]
import { S3Client, ListObjectsV2Command, HeadObjectCommand, CopyObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
// Logique pure depuis le dist workspace (build requis : `npm run -w @sentropic/geo
// build`). Import RELATIF volontaire : le bare `@sentropic/geo/preprod` résout la
// copie publiée de node_modules (sans le nouveau subpath) ; le dist workspace est la
// source de vérité locale, et le Job in-cluster est buildé depuis ce même repo.
import { planFullMirror, buildCoherenceManifest, coherenceManifestKeyFor, computeSetHash } from "../packages/geo/dist/preprod/index.js";
// Options client S3 sûres OVH/Scaleway (coupe l'aws-chunked refusé au PUT) — factory
// PARTAGÉ de la lib, pas un fix ad-hoc : serving + sync + tout writer en bénéficient.
import { ovhSafeS3ClientOptions } from "../packages/geo/dist/storage/index.js";
import process from "node:process";

// ── args ──────────────────────────────────────────────────────────────────────
const opt = { source: "s3://sentropic-geo/normalized", dest: "s3://sentropic-geo-preprod/normalized", prodApi: "https://api.geo.sent-tech.ca", coherenceId: null, dryRun: false, limit: Infinity, concurrency: 16 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--source") opt.source = argv[++i];
  else if (a === "--dest") opt.dest = argv[++i];
  else if (a === "--prod-api") opt.prodApi = argv[++i];
  else if (a === "--coherence-id") opt.coherenceId = argv[++i];
  else if (a === "--dry-run") opt.dryRun = true;
  else if (a === "--limit") opt.limit = Number(argv[++i]);
  else if (a === "--concurrency") opt.concurrency = Number(argv[++i]);
  else { console.error(`unknown arg: ${a}`); process.exit(2); }
}

function parseS3(uri) {
  const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(uri);
  if (!m) { console.error(`invalid s3 uri: ${uri}`); process.exit(2); }
  return { bucket: m[1], prefix: m[2].replace(/^\/+|\/+$/g, "") };
}
const src = parseS3(opt.source);
const dest = parseS3(opt.dest);
const COHERENCE_KEY = coherenceManifestKeyFor(dest.prefix);

// ── clients ─────────────────────────────────────────────────────────────────
const clientFrom = (p) => {
  const cfg = { forcePathStyle: true };
  const endpoint = process.env[`${p}ENDPOINT`]; const region = process.env[`${p}REGION`];
  const ak = process.env[`${p}ACCESS_KEY`]; const sk = process.env[`${p}SECRET_KEY`];
  if (endpoint) cfg.endpoint = endpoint;
  cfg.region = region || "us-east-1";
  if (ak && sk) cfg.credentials = { accessKeyId: ak, secretAccessKey: sk };
  return new S3Client({ ...cfg, ...ovhSafeS3ClientOptions() });
};
const destClient = clientFrom("S3_");
const hasSourceCreds = Boolean(process.env["S3_SOURCE_ACCESS_KEY"]);
const sourceClient = hasSourceCreds ? clientFrom("S3_SOURCE_") : destClient;
const streamMode = hasSourceCreds; // creds séparées => get→put (pas de copy server-side cross-cred)

// ── I/O helpers (la logique de sélection/manifeste vit dans la lib) ───────────
async function* listSource() {
  let token;
  do {
    const out = await sourceClient.send(new ListObjectsV2Command({ Bucket: src.bucket, Prefix: src.prefix ? `${src.prefix}/` : undefined, ContinuationToken: token }));
    for (const o of out.Contents ?? []) if (typeof o.Key === "string") yield { key: o.Key, size: o.Size ?? 0 };
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
}
async function destSize(key) {
  try { const h = await destClient.send(new HeadObjectCommand({ Bucket: dest.bucket, Key: key })); return h.ContentLength ?? -1; }
  catch { return -1; }
}
async function copyOne(srcKey, destKey, size) {
  if (await destSize(destKey) === size) return "skip"; // idempotent : dest identique en taille
  if (opt.dryRun) return "would-copy";
  if (streamMode) {
    const g = await sourceClient.send(new GetObjectCommand({ Bucket: src.bucket, Key: srcKey }));
    await destClient.send(new PutObjectCommand({ Bucket: dest.bucket, Key: destKey, Body: g.Body, ContentLength: size }));
  } else {
    await destClient.send(new CopyObjectCommand({ Bucket: dest.bucket, Key: destKey, CopySource: `${src.bucket}/${encodeURI(srcKey)}` }));
  }
  return "copy";
}
// Le count servi RÉEL + le hash du set d'ids, lus via l'API prod (= la parité que
// le miroir reproduit). served_count et set_hash proviennent de la MÊME réponse,
// donc d'un état cohérent. Renvoie null si l'API prod est injoignable/malformée.
async function prodServedSet() {
  try {
    const r = await fetch(`${opt.prodApi.replace(/\/+$/, "")}/collections`, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j.collections)) return null;
    const ids = j.collections.map((c) => c.id).filter((x) => typeof x === "string");
    return { count: ids.length, setHash: computeSetHash(ids) };
  } catch { return null; }
}
async function pool(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) || 0 }, async () => {
    for (;;) { const idx = i++; if (idx >= items.length) return; res[idx] = await fn(items[idx], idx); }
  }));
  return res;
}

// ── run ──────────────────────────────────────────────────────────────────────
const all = [];
for await (const o of listSource()) { all.push(o); if (all.length >= opt.limit) break; }
const sizeByKey = new Map(all.map((o) => [o.key, o.size]));
const plan = planFullMirror(all.map((o) => o.key), src.prefix, dest.prefix); // sélection full-mirror (lib, testée)

const outcomes = await pool(plan.copies, opt.concurrency, (c) => copyOne(c.srcKey, c.destKey, sizeByKey.get(c.srcKey) ?? 0));
const tally = outcomes.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
const served = await prodServedSet();

let stamped = null;
if (!opt.dryRun) {
  if (!opt.coherenceId) { console.error("ERREUR: --coherence-id requis pour stamper coherence.json (hors --dry-run)."); process.exit(2); }
  if (served === null) { console.error("ERREUR: served_count/set_hash introuvables (API prod injoignable) — refus de stamper sans preuve de complétude/parité."); process.exit(3); }
  // build + validation fail-closed du manifeste = lib (testée), pas ici.
  const manifest = buildCoherenceManifest({ coherenceId: opt.coherenceId, servedCount: served.count, setHash: served.setHash, generatedAt: new Date().toISOString() });
  await destClient.send(new PutObjectCommand({ Bucket: dest.bucket, Key: COHERENCE_KEY, Body: JSON.stringify(manifest, null, 2), ContentType: "application/json" }));
  stamped = manifest;
}

console.log(JSON.stringify({
  source: opt.source, dest: opt.dest, mode: streamMode ? "get-put" : "server-side-copy", dry_run: opt.dryRun,
  objects_seen: all.length, objects_synced: plan.copies.length, skipped_source_coherence: plan.skipped, outcomes: tally,
  served_count: served?.count ?? null, set_hash: served?.setHash ?? null, coherence_key: COHERENCE_KEY, stamped,
}, null, 2));
process.exit(0);
