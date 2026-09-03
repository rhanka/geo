#!/usr/bin/env node
// geo-verify-served-collections.mjs — vérifie l'EXPOSITION OGC servie par geo-api,
// THROUGH l'API (jamais depuis S3), pour prouver qu'un dépôt est réellement SERVI.
// Lecture seule. Deux gates, combinables :
//
//  A. PER-COLLECTION (ids en argument) : GET /collections/<id> (200 = exposé), items
//     (numberMatched), et — avec --expect-coherence — le coherence_id SERVI == sync'd
//     (FRAÎCHEUR, fail-closed : champ absent/mismatch => ÉCHEC ; « présent » ≠ « frais »).
//
//  B. --completeness (dataset-level, §7 A5) : compare le count du SOUS-ENSEMBLE PROD-MIRROR
//     de /collections (les familles preprod-native — PREPROD_NATIVE_FAMILIES, ex. CPTAQ
//     ca-qc-constraints-* — sont EXCLUES, ADR-0027 (b) : la triade stampée est prod-mirror-only)
//     au `served_count` que la landing sert (issu de coherence.json, = count parité miroir
//     prod), ET le HASH de ce sous-ensemble au `set_hash` de la landing (vrai set-match :
//     un drop+ajout à count égal échoue). Le hash est calculé par la MÊME fonction que le
//     runner (`computeSetHash` de @sentropic/geo/preprod) → identique par construction.
//     Prouve la COMPLÉTUDE + la PARITÉ : un slug-nu manquant/substitué échoue (plus de
//     faux vert). FAIL-CLOSED si served_count/set_hash absent. Avec --expect-coherence,
//     asserte aussi le coherence_id de la landing (fraîcheur dataset).
//
// Usage : node scripts/geo-verify-served-collections.mjs [--expect-coherence <id>]
//                 [--coherence-field <path>] [--completeness] [<collId> …]
//   GEO_API_BASE (def. https://api.geo.sent-tech.ca)
import process from "node:process";

const BASE = (process.env.GEO_API_BASE || "https://api.geo.sent-tech.ca").replace(/\/+$/, "");

let expectCoherence = null;
let coherenceField = "coherence_id";
let completeness = false;
const ids = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--expect-coherence") expectCoherence = argv[++i];
  else if (a.startsWith("--expect-coherence=")) expectCoherence = a.slice("--expect-coherence=".length);
  else if (a === "--coherence-field") coherenceField = argv[++i];
  else if (a.startsWith("--coherence-field=")) coherenceField = a.slice("--coherence-field=".length);
  else if (a === "--completeness") completeness = true;
  else ids.push(a);
}
if (ids.length === 0 && !completeness) {
  console.error("usage: node scripts/geo-verify-served-collections.mjs [--expect-coherence <id>] [--coherence-field <path>] [--completeness] [<collId> …]");
  process.exit(2);
}

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const getJson = async (url, accept) => {
  const r = await fetch(url, { headers: { accept } });
  return { status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
};

// ── A. per-collection freshness ──────────────────────────────────────────────
async function probe(id) {
  const collUrl = `${BASE}/collections/${encodeURIComponent(id)}`;
  const out = { id, coll_status: null, items_status: null, number_matched: null, coherence_served: null, coherence_ok: null, error: null };
  try {
    const cr = await getJson(collUrl, "application/json");
    out.coll_status = cr.status;
    if (cr.status === 200 && cr.body) {
      if (expectCoherence !== null) {
        const served = getPath(cr.body, coherenceField);
        out.coherence_served = served ?? null;
        out.coherence_ok = served != null && String(served) === String(expectCoherence);
      }
      const ir = await fetch(`${collUrl}/items?limit=1`, { headers: { accept: "application/geo+json" } });
      out.items_status = ir.status;
      if (ir.ok) {
        const j = await ir.json();
        out.number_matched = typeof j.numberMatched === "number" ? j.numberMatched : (j.numberMatched ?? null);
      }
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}
const collPasses = (r) => r.coll_status === 200 && (expectCoherence === null || r.coherence_ok === true);

// ── B. dataset completeness + true set-match ─────────────────────────────────
async function completenessCheck() {
  const out = { served_count: null, actual_collections: null, live_collections: null, preprod_native_excluded: null, coherence_served: null, set_hash_served: null, set_hash_actual: null, count_ok: false, set_hash_ok: false, coherence_ok: null, error: null };
  try {
    const landing = await getJson(`${BASE}/`, "application/json");
    const served = landing.body?.served_count;
    out.served_count = typeof served === "number" ? served : null;
    out.coherence_served = landing.body?.coherence_id ?? null;
    out.set_hash_served = typeof landing.body?.set_hash === "string" ? landing.body.set_hash : null;
    const coll = await getJson(`${BASE}/collections`, "application/json");
    const arr = Array.isArray(coll.body?.collections) ? coll.body.collections : null;
    // The stamped triad is PROD-MIRROR-ONLY (ADR-0027 (b)). Exclude preprod-native families
    // (PREPROD_NATIVE_FAMILIES — a NAMED, committed list; e.g. CPTAQ ca-qc-constraints-*) from the
    // LIVE set before comparing count/set_hash, so they stay transparent to the mirror-parity check
    // (each carries its OWN seal), while a real mirror drift (a missing/substituted PROD collection)
    // still fails. Same hash fn as the runner (0 drift); requires the built lib.
    if (arr) {
      const { computeSetHash, prodMirrorCollectionIds } = await import("../packages/geo/dist/preprod/index.js");
      const liveIds = arr.map((c) => c.id).filter((x) => typeof x === "string");
      const mirrorIds = prodMirrorCollectionIds(liveIds);
      out.live_collections = liveIds.length;
      out.actual_collections = mirrorIds.length; // prod-mirror subset (preprod-native excluded)
      out.preprod_native_excluded = liveIds.length - mirrorIds.length;
      out.set_hash_actual = computeSetHash(mirrorIds);
    }
    // fail-closed : served_count présent ET égal au count PROD-MIRROR réel (preprod-native exclus).
    out.count_ok = out.served_count !== null && out.actual_collections === out.served_count;
    out.set_hash_ok = out.set_hash_served != null && out.set_hash_actual != null && out.set_hash_served === out.set_hash_actual;
    if (expectCoherence !== null) {
      out.coherence_ok = out.coherence_served != null && String(out.coherence_served) === String(expectCoherence);
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}
const completenessPasses = (c) => c.count_ok && c.set_hash_ok === true && (expectCoherence === null || c.coherence_ok === true);

// ── run ──────────────────────────────────────────────────────────────────────
const results = [];
for (const id of ids) results.push(await probe(id));
const completenessResult = completeness ? await completenessCheck() : null;

const collOk = results.filter(collPasses).length;
const collAllPass = collOk === results.length;
const compPass = completenessResult ? completenessPasses(completenessResult) : true;
const allPass = collAllPass && compPass;

console.log(JSON.stringify({
  base: BASE,
  per_collection: { passed: collOk, total: ids.length, expect_coherence: expectCoherence, coherence_field: expectCoherence !== null ? coherenceField : null, results },
  ...(completenessResult ? { completeness: completenessResult } : {}),
  pass: allPass,
}, null, 2));
process.exit(allPass ? 0 : 1);
