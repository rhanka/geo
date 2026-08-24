#!/usr/bin/env node
// geo-preprod-sync.mjs — WRAPPER MINCE runnable de la jambe geo du cycle de récup
// prod→preprod (§5/§6.1). La logique PURE (sélection miroir-plein + build du manifeste
// de cohérence) est capitalisée + testée dans la lib `@sentropic/geo/preprod` ; ce
// script ne fait que l'I/O S3 autour d'elle.
//
// MIROIR PLEIN du préfixe `normalized/` prod → bucket preprod (data-driven, PAS de
// whitelist). Copie SEULE (données publiques ; charge Loi 25 = immo-side). Prune du
// surplus CANONIQUE seulement (provenance préservée). Idempotent + rejouable.
// Sens-unique STRICT : lit la prod, écrit SEULEMENT le bucket preprod. Ordonnancé
// par poc-k8s en Job in-cluster (fenêtre gatée i-cond S00).
//
// STAMP DE PARITÉ (coherence.json served_count/set_hash) : dérivé du listing SOURCE
// canonique (`canonicalServedIds` = MÊME règle que le serving), PAS de prod-api
// (dont l'index peut être STALE = conflation parité-VERSION). Le verify preprod
// match par construction, quelle que soit la fraîcheur de l'image prod (§4 re-spec).
//
// Creds : la source (read-only, scopée) est FOURNIE À PART dans `S3_SOURCE_*`
// (décision : pas de cred multi-bucket, scoping OVH `unknown`) → le runner bascule
// en get→put streaming (deux clients, isolation propre). Dest = `S3_*`.
//
// Usage : node scripts/geo-preprod-sync.mjs --coherence-id <id> [--source <s3uri>]
//            [--dest <s3uri>] [--dry-run] [--limit <n>] [--concurrency <n>]
//   (--prod-api conservé pour compat mais NON utilisé — le stamp vient de la source.)
import { S3Client, ListObjectsV2Command, HeadObjectCommand, CopyObjectCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
// Logique pure depuis le dist workspace (build requis : `npm run -w @sentropic/geo
// build`). Import RELATIF volontaire : le bare `@sentropic/geo/preprod` résout la
// copie publiée de node_modules (sans le nouveau subpath) ; le dist workspace est la
// source de vérité locale, et le Job in-cluster est buildé depuis ce même repo.
import { planFullMirror, pruneBoundExceeded, DEFAULT_MAX_DELETE_FRACTION, buildCoherenceManifest, coherenceManifestKeyFor, computeSetHash } from "../packages/geo/dist/preprod/index.js";
// Options client S3 sûres OVH/Scaleway (coupe l'aws-chunked refusé au PUT) — factory
// PARTAGÉ de la lib, pas un fix ad-hoc : serving + sync + tout writer en bénéficient.
import { ovhSafeS3ClientOptions, isCanonicalGeojsonKey, servedDatasetIds } from "../packages/geo/dist/storage/index.js";
import process from "node:process";

// ── args ──────────────────────────────────────────────────────────────────────
const opt = { source: "s3://sentropic-geo/normalized", dest: "s3://sentropic-geo-preprod/normalized", prodApi: "https://api.geo.sent-tech.ca", coherenceId: null, dryRun: false, limit: Infinity, concurrency: 16, maxDeleteFraction: DEFAULT_MAX_DELETE_FRACTION };
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
  else if (a === "--max-delete-fraction") opt.maxDeleteFraction = Number(argv[++i]);
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
// Liste paginée d'un bucket/préfixe. `complete` = la pagination est allée AU BOUT
// sans erreur ET sans troncature par `limit`. Le prune ne s'exécute QUE contre un
// listing SOURCE (et DEST) complet — jamais contre un listing partiel/erroné
// (garde-fou #1 : évite un mass-delete si le list source casse).
async function listAll(client, bucket, prefix, limit = Infinity) {
  const keys = [];
  try {
    let token;
    do {
      const out = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix ? `${prefix}/` : undefined, ContinuationToken: token }));
      for (const o of out.Contents ?? []) {
        if (typeof o.Key !== "string") continue;
        keys.push({ key: o.Key, size: o.Size ?? 0 });
        if (keys.length >= limit) return { keys, complete: false }; // tronqué → incomplet
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return { keys, complete: true };
  } catch (e) {
    return { keys, complete: false, error: e instanceof Error ? e.message : String(e) };
  }
}
async function deleteOne(key) {
  if (opt.dryRun) return "would-delete";
  await destClient.send(new DeleteObjectCommand({ Bucket: dest.bucket, Key: key }));
  return "delete";
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
async function getSourceJson(key) {
  try {
    const g = await sourceClient.send(new GetObjectCommand({ Bucket: src.bucket, Key: key }));
    return JSON.parse(await g.Body.transformToString());
  } catch { return undefined; }
}
// Cible de parité DATA (served_count + set_hash) = la MÊME dérivation que le serving :
// `servedDatasetIds` où id = datasetId ?? stem. META-EXACT : on lit le `.meta.json`
// source de chaque clé canonique (pour son datasetId), sinon id = stem. Nécessaire car
// des collections DISTINCTES partagent un stem (ex. `abercorn` zonage vs `qc-cadastre-
// lots/abercorn`→`qc-lots-abercorn`) — un stamp stem-only les MERGE (perte de données).
// Dérivé du listing SOURCE (pas de prod-api STALE) → stamp-set == served-set par
// construction. `null` si source incomplète (fail-closed).
async function servedSetFromSource(srcKeys, complete) {
  if (!complete) return null;
  const keySet = new Set(srcKeys);
  const canonical = srcKeys.filter(isCanonicalGeojsonKey);
  const metaOf = (k) => `${k.slice(0, -".geojson".length)}.meta.json`;
  const withMeta = canonical.filter((k) => keySet.has(metaOf(k)));
  const datasetIdByKey = new Map();
  await pool(withMeta, opt.concurrency, async (k) => {
    const meta = await getSourceJson(metaOf(k));
    if (meta && typeof meta.datasetId === "string") datasetIdByKey.set(k, meta.datasetId);
  });
  const ids = servedDatasetIds(canonical.map((k) => ({ key: k, datasetId: datasetIdByKey.get(k) })));
  return { count: ids.length, setHash: computeSetHash(ids) };
}
async function pool(items, n, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) || 0 }, async () => {
    for (;;) { const idx = i++; if (idx >= items.length) return; res[idx] = await fn(items[idx], idx); }
  }));
  return res;
}

// ── run ──────────────────────────────────────────────────────────────────────
// Listings complets source + dest. `complete` conditionne le prune (garde-fou #1).
const source = await listAll(sourceClient, src.bucket, src.prefix, opt.limit);
const destListing = await listAll(destClient, dest.bucket, dest.prefix);
const sizeByKey = new Map(source.keys.map((o) => [o.key, o.size]));
// Plan full-mirror : copies + deletes (prune). deletes vide si source vide (garde-fou #1 lib).
const plan = planFullMirror(
  source.keys.map((o) => o.key),
  src.prefix,
  dest.prefix,
  destListing.keys.map((o) => o.key),
);

// 1) COPY-FIRST — jamais de fenêtre où un objet valide manque.
const copyOutcomes = await pool(plan.copies, opt.concurrency, (c) => copyOne(c.srcKey, c.destKey, sizeByKey.get(c.srcKey) ?? 0));
const copyTally = copyOutcomes.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});

// 2) PRUNE (DEST-only) — sous garde-fous fail-closed.
const destCount = destListing.keys.length;
let deleteTally = {};
let pruneStatus;
if (!source.complete || !destListing.complete) {
  // #1 : source/dest listing incomplet/tronqué/erroné → JAMAIS de prune (anti mass-delete).
  pruneStatus = `skipped-incomplete-listing (source.complete=${source.complete} dest.complete=${destListing.complete})`;
  console.error(`# prune SKIP : ${pruneStatus} — copies seules, parité laissée à un run complet.`);
} else if (plan.deletes.length === 0) {
  pruneStatus = "nothing-to-prune";
} else if (pruneBoundExceeded(plan.deletes.length, destCount, opt.maxDeleteFraction)) {
  // #2 : borne dépassée → ABORT, aucune suppression.
  const pct = ((100 * plan.deletes.length) / destCount).toFixed(1);
  console.error(`# prune ABORT (garde-fou #2) : ${plan.deletes.length}/${destCount} = ${pct}% > ${(100 * opt.maxDeleteFraction).toFixed(0)}%. Aucune suppression. Source cassée ? Investiguer.`);
  console.log(JSON.stringify({ aborted: "prune-bound-exceeded", deletes_planned: plan.deletes.length, dest_count: destCount, max_delete_fraction: opt.maxDeleteFraction, sample_deletes: plan.deletes.slice(0, 10) }, null, 2));
  process.exit(4);
} else {
  // #3 : log le plan (count + échantillon) avant exécution.
  const pct = ((100 * plan.deletes.length) / destCount).toFixed(1);
  console.error(`# prune : ${plan.deletes.length}/${destCount} surplus (${pct}%)${opt.dryRun ? " [dry-run]" : ""}. Échantillon: ${JSON.stringify(plan.deletes.slice(0, 10))}`);
  const delOutcomes = await pool(plan.deletes, opt.concurrency, (k) => deleteOne(k));
  deleteTally = delOutcomes.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
  pruneStatus = opt.dryRun ? "would-prune" : "pruned";
}

// Cible de parité DATA canonique, dérivée du listing SOURCE (meta-exact, pas de prod-api).
const served = await servedSetFromSource(source.keys.map((o) => o.key), source.complete);

let stamped = null;
if (!opt.dryRun) {
  if (!opt.coherenceId) { console.error("ERREUR: --coherence-id requis pour stamper coherence.json (hors --dry-run)."); process.exit(2); }
  if (served === null) { console.error("ERREUR: listing SOURCE incomplet → served_count/set_hash canoniques indérivables — refus de stamper sans preuve de complétude/parité."); process.exit(3); }
  // build + validation fail-closed du manifeste = lib (testée), pas ici.
  const manifest = buildCoherenceManifest({ coherenceId: opt.coherenceId, servedCount: served.count, setHash: served.setHash, generatedAt: new Date().toISOString() });
  await destClient.send(new PutObjectCommand({ Bucket: dest.bucket, Key: COHERENCE_KEY, Body: JSON.stringify(manifest, null, 2), ContentType: "application/json" }));
  stamped = manifest;
}

console.log(JSON.stringify({
  source: opt.source, dest: opt.dest, mode: streamMode ? "get-put" : "server-side-copy", dry_run: opt.dryRun,
  source_listing: { count: source.keys.length, complete: source.complete },
  dest_listing: { count: destCount, complete: destListing.complete },
  copies: { planned: plan.copies.length, outcomes: copyTally },
  prune: { status: pruneStatus, planned: plan.deletes.length, outcomes: deleteTally, max_delete_fraction: opt.maxDeleteFraction, sample: plan.deletes.slice(0, 10) },
  skipped_source_coherence: plan.skipped,
  served_count: served?.count ?? null, set_hash: served?.setHash ?? null, coherence_key: COHERENCE_KEY, stamped,
}, null, 2));
process.exit(0);
