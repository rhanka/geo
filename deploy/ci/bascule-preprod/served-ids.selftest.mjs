#!/usr/bin/env node
// =============================================================================
// served-ids.selftest.mjs — self-test du contrat e2e (served-ids.mjs + workflow).
//
// 0 RÉSEAU : les fonctions pures sont nourries de données MOCKÉES (API OGC simulée,
// builder simulé, fichiers dans un dossier temporaire). Les sous-processus lancés
// (`node served-ids.mjs …`) échouent ou terminent AVANT tout appel réseau.
//
// Validation STRUCTURELLE du workflow (paquet `yaml` résolu depuis le package.json
// racine du dépôt, ou depuis YAML_RESOLVE_FROM) : jobs pg/s3/cycle-leg, pg et s3
// SANS `needs:`, cycle-leg `needs: [pg, s3]`. `yaml` introuvable = ÉCHEC (jamais
// « vert par omission »).
//
// Contrôle OPTIONNEL du builder PUBLIÉ (0 réseau, déjà installé) :
//   SERVED_IDS_SELFTEST_BUILDER_DIR=<dir npm install --prefix> → ids exemples réels.
//
//   node deploy/ci/bascule-preprod/served-ids.selftest.mjs   → exit 0 si tout passe.
// =============================================================================
import console from "node:console";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import {
  BUILDER_VERSION,
  CYCLE_ID_PATTERN,
  IDS_FILE,
  META_FILE,
  MISSING_FILE,
  SHA_FILE,
  assertSerialization,
  assertServedZoneIds,
  buildGeoLeg,
  buildServedZoneIds,
  byteCompare,
  checkItemsPage,
  collectionIdsOf,
  cycleLegArtifactName,
  getJsonWithRetry,
  isAbsentZoneCode,
  isRetryableStatus,
  isValidCycleId,
  itemsUrl,
  loadBuilder,
  mapJobResult,
  mapLimit,
  parseRegistrySlugs,
  parseSha256File,
  parseT1,
  readServedIdsSha,
  readZoneCollection,
  resolveBuilderEntry,
  selectZoneCollections,
  servedIdsArtifactName,
  sha256FileLine,
  sha256Hex,
  shortSha,
  writeServedIdsArtifact,
} from "./served-ids.mjs";

let passed = 0;
let failed = 0;
const ok = (name, cond) => {
  if (cond) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};
const eq = (name, a, b) => ok(`${name} (got ${JSON.stringify(a)?.slice(0, 200)})`, JSON.stringify(a) === JSON.stringify(b));
const throws = (name, fn, re) => {
  try { fn(); ok(`${name} (n'a pas levé)`, false); }
  catch (e) { ok(`${name} → ${e.message.slice(0, 120)}`, re ? re.test(e.message) : true); }
};
const rejects = async (name, promise, re) => {
  try { await promise; ok(`${name} (n'a pas rejeté)`, false); }
  catch (e) { ok(`${name} → ${e.message.slice(0, 120)}`, re ? re.test(e.message) : true); }
};

const HERE = import.meta.dirname;
const CLI = join(HERE, "served-ids.mjs");
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const TMP = mkdtempSync(join(tmpdir(), "served-ids-selftest-"));
const noSleep = async () => {};

// Builder SIMULÉ : même contrat que @sentropic/geo (skip vide, dédup, tri octets,
// 1 id/ligne + LF). Canonicalisation simplifiée (trim + majuscules) : la vraie est
// couverte par le contrôle optionnel du builder publié en fin de fichier.
const fakeBuilder = {
  version: "fake",
  build: ({ zones = [], lots = [] } = {}) => {
    const s = new Set();
    for (const z of zones) {
      const code = String(z.zoneCode ?? "").trim().toUpperCase();
      if (z.citySlug && code) s.add(`ogc:zones:${z.citySlug}:${code}`);
    }
    for (const l of lots) {
      const n = String(l.noLot ?? "").replace(/\s+/g, "");
      if (l.citySlug && n) s.add(`ogc:lots:${l.citySlug}:${n}`);
    }
    return [...s].sort(byteCompare);
  },
  serialize: (ids) => (ids.length === 0 ? "" : `${ids.join("\n")}\n`),
};

// API OGC SIMULÉE : /collections + items paginés par limit/offset (comme geo-api).
function mockApi(collections, { failItems = new Set(), changeMatchedOn = null, calls = [] } = {}) {
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === "/collections") return { collections: Object.keys(collections).map((id) => ({ id })) };
    const m = /^\/collections\/([^/]+)\/items$/.exec(u.pathname);
    if (!m) throw new Error(`url inattendue ${url}`);
    const id = decodeURIComponent(m[1]);
    if (failItems.has(id)) throw new Error(`GET ${url} : HTTP 404`);
    const all = collections[id];
    if (!all) throw new Error(`GET ${url} : HTTP 404`);
    const limit = Number(u.searchParams.get("limit"));
    const offset = Number(u.searchParams.get("offset"));
    const page = all.slice(offset, offset + limit);
    const numberMatched = changeMatchedOn === id && offset > 0 ? all.length + 1 : all.length;
    return { type: "FeatureCollection", features: page, numberMatched, numberReturned: page.length };
  };
}
const feat = (zone_code) => ({ type: "Feature", properties: zone_code === undefined ? {} : { zone_code }, geometry: null });

// ── CYCLE_ID + noms d'artefacts ─────────────────────────────────────────────
for (const v of ["e2e-2026-09-25.1", "A_b.c-9", "x", "a".repeat(100), "..", "cycle.20260925T0317Z"]) ok(`CYCLE_ID valide ${JSON.stringify(v.slice(0, 30))}`, isValidCycleId(v));
for (const v of ["", "a".repeat(101), "a/b", "a b", "a:b", "é", "$(id)", "a\nb", "a*b", undefined, null, 5]) ok(`CYCLE_ID invalide ${JSON.stringify(v)}`, !isValidCycleId(v));
eq("motif CYCLE_ID figé", String(CYCLE_ID_PATTERN), "/^[A-Za-z0-9._-]{1,100}$/");
eq("nom artefact served ids", servedIdsArtifactName("c-1"), "geo-served-canonical-ids-c-1");
eq("nom artefact cycle-leg", cycleLegArtifactName("c-1"), "cycle-leg-geo-c-1");
throws("nom artefact — CYCLE_ID invalide ⇒ lève", () => servedIdsArtifactName("a/b"), /CYCLE_ID invalide/);

// ── ordre d'octets (LC_ALL=C), sha256, format de ligne ───────────────────────
eq("byteCompare — ordre C : majuscules < '_' < minuscules < non-ASCII", ["b", "É", "a", "_", "A"].sort(byteCompare), ["A", "_", "a", "b", "É"]);
ok("byteCompare — 'Z' < 'a' (≠ localeCompare)", byteCompare("Z", "a") < 0 && "Z".localeCompare("a") > 0);
ok("byteCompare — préfixe plus court d'abord", byteCompare("ogc:zones:a:H-1", "ogc:zones:a:H-10") < 0);
eq("sha256('abc') — vecteur connu", sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
eq("sha256FileLine — format sha256sum", sha256FileLine("a".repeat(64)), `${"a".repeat(64)}  ${IDS_FILE}\n`);
eq("parseSha256File — aller-retour", parseSha256File(sha256FileLine("b".repeat(64))), "b".repeat(64));
eq("parseSha256File — hex seul accepté", parseSha256File(`${"c".repeat(64)}\n`), "c".repeat(64));
throws("parseSha256File — illisible ⇒ lève", () => parseSha256File("nope  served-ids.txt"), /illisible/);
throws("sha256FileLine — hex invalide ⇒ lève", () => sha256FileLine("xyz"), /invalide/);
assertServedZoneIds(["ogc:zones:a:A-1", "ogc:zones:a:B-2", "ogc:zones:b:A-1"]);
ok("assertServedZoneIds — trié + unique accepté", true);
throws("assertServedZoneIds — vide ⇒ lève (fichier vide jamais vert)", () => assertServedZoneIds([]), /vide/);
throws("assertServedZoneIds — non trié ⇒ lève", () => assertServedZoneIds(["ogc:zones:b:A", "ogc:zones:a:A"]), /non triés/);
throws("assertServedZoneIds — doublon ⇒ lève", () => assertServedZoneIds(["ogc:zones:a:A", "ogc:zones:a:A"]), /dupliqués/);
throws("assertServedZoneIds — tri locale (≠ octets) ⇒ lève", () => assertServedZoneIds(["ogc:zones:a:a", "ogc:zones:a:Z"]), /non triés/);
throws("assertServedZoneIds — id lot dans scope zones ⇒ lève", () => assertServedZoneIds(["ogc:lots:a:1"]), /hors format/);
throws("assertServedZoneIds — blanc dans le code ⇒ lève", () => assertServedZoneIds(["ogc:zones:a:A 1"]), /hors format/);
throws("assertServedZoneIds — slug vide ⇒ lève", () => assertServedZoneIds(["ogc:zones::A"]), /hors format/);
assertSerialization(["x", "y"], "x\ny\n");
ok("assertSerialization — 1 id/ligne + LF final accepté", true);
throws("assertSerialization — sans LF final ⇒ lève", () => assertSerialization(["x", "y"], "x\ny"), /sérialisation/);
throws("assertSerialization — CRLF ⇒ lève", () => assertSerialization(["x"], "x\r\n"), /sérialisation/);

// ── registre + sélection ─────────────────────────────────────────────────────
eq("parseRegistrySlugs — slugs triés octets", parseRegistrySlugs([{ slug: "westmount" }, { slug: "laval" }]), ["laval", "westmount"]);
throws("parseRegistrySlugs — vide ⇒ lève", () => parseRegistrySlugs([]), /vide/);
throws("parseRegistrySlugs — non tableau ⇒ lève", () => parseRegistrySlugs({}), /vide/);
throws("parseRegistrySlugs — doublon ⇒ lève", () => parseRegistrySlugs([{ slug: "a" }, { slug: "a" }]), /dupliqué/);
throws("parseRegistrySlugs — slug invalide ⇒ lève", () => parseRegistrySlugs([{ slug: "L'Assomption" }]), /invalide/);
{
  const reg = JSON.parse(readFileSync(join(REPO_ROOT, "packages/qc-sources/src/geo/municipalities.qc.json"), "utf8"));
  eq("registre committé — 1106 slugs uniques valides", parseRegistrySlugs(reg).length, 1106);
  const slugs = new Set(parseRegistrySlugs(reg));
  ok("registre committé — les 3 variantes servies sont HORS registre (exclues)", ["l-assomption", "l-epiphanie", "sainte-christine-d-auvergne"].every((s) => !slugs.has(s)));
}
eq("collectionIdsOf — ids string seulement", collectionIdsOf({ collections: [{ id: "a" }, { id: "" }, { id: 3 }, {}] }), ["a"]);
eq("collectionIdsOf — body null ⇒ []", collectionIdsOf(null), []);
{
  const served = ["qc-zonage-westmount", "qc-zonage-laval", "qc-zonage-norms-laval", "qc-zonage-laval-sad-zone-agricole", "qc-zonage-arcgis-quebec-karst", "qc-zonage-l-assomption", "qc-lots-laval", "qc-tod-laval"];
  const sel = selectZoneCollections(served, ["westmount", "laval", "lassomption", "absente"]);
  eq("sélection — slugs du registre servis", sel.selected, [{ id: "qc-zonage-laval", slug: "laval" }, { id: "qc-zonage-westmount", slug: "westmount" }]);
  eq("sélection — slugs du registre non servis ⇒ missing (tolérés)", sel.missing, ["absente", "lassomption"]);
  eq("sélection — qc-zonage-norms-* exclus", sel.excludedNorms, ["qc-zonage-norms-laval"]);
  eq("sélection — thématiques + variantes hors registre exclues", sel.excludedUnregistered, ["qc-zonage-arcgis-quebec-karst", "qc-zonage-l-assomption", "qc-zonage-laval-sad-zone-agricole"]);
}

// ── pagination OGC ───────────────────────────────────────────────────────────
eq("itemsUrl — limit/offset calculés, id encodé, base sans slash final", itemsUrl("https://x.test/", "qc-zonage-a b", 10, 20), "https://x.test/collections/qc-zonage-a%20b/items?limit=10&offset=20");
{
  const fc = (features, numberMatched, numberReturned = features.length) => ({ type: "FeatureCollection", features, numberMatched, numberReturned });
  eq("checkItemsPage — page cohérente", checkItemsPage(fc([feat("A")], 3), { id: "c", offset: 0 }).numberMatched, 3);
  throws("checkItemsPage — pas FeatureCollection ⇒ lève", () => checkItemsPage({ type: "Feature" }, { id: "c", offset: 0 }), /non FeatureCollection/);
  throws("checkItemsPage — numberReturned ≠ features ⇒ lève", () => checkItemsPage(fc([feat("A")], 3, 2), { id: "c", offset: 0 }), /numberReturned/);
  throws("checkItemsPage — numberMatched absent ⇒ lève", () => checkItemsPage({ type: "FeatureCollection", features: [], numberReturned: 0 }, { id: "c", offset: 0 }), /numberMatched invalide/);
  throws("checkItemsPage — numberMatched changé ⇒ lève", () => checkItemsPage(fc([feat("A")], 4), { id: "c", offset: 1, expectedMatched: 3 }), /a changé/);
  throws("checkItemsPage — page vide avant la fin ⇒ lève", () => checkItemsPage(fc([], 5), { id: "c", offset: 2 }), /aucune progression/);
  throws("checkItemsPage — dépassement ⇒ lève", () => checkItemsPage(fc([feat("A"), feat("B")], 3), { id: "c", offset: 2 }), /dépassement/);
  eq("checkItemsPage — collection vide (0/0) acceptée", checkItemsPage(fc([], 0), { id: "c", offset: 0 }).numberReturned, 0);
}
ok("isAbsentZoneCode — null/undefined/blanc", [null, undefined, "", "  "].every(isAbsentZoneCode) && ![0, "H-1"].some(isAbsentZoneCode));
{
  const codes = Array.from({ length: 25 }, (_, i) => (i === 7 ? null : `H-${i}`));
  const calls = [];
  const r = await readZoneCollection(mockApi({ "qc-zonage-a": codes.map(feat) }, { calls }), "https://x.test", "qc-zonage-a", { limit: 10 });
  eq("readZoneCollection — 25 features / limit 10 ⇒ 3 pages", [r.features, r.pages, r.numberMatched], [25, 3, 25]);
  eq("readZoneCollection — offsets 0,10,20 demandés", calls.map((u) => new URL(u).searchParams.get("offset")), ["0", "10", "20"]);
  eq("readZoneCollection — zone_code bruts, ordre préservé", r.zoneCodes.slice(0, 3), ["H-0", "H-1", "H-2"]);
  eq("readZoneCollection — zone_code absent compté", r.zoneCodeAbsent, 1);
  const exact = await readZoneCollection(mockApi({ "qc-zonage-a": codes.slice(0, 20).map(feat) }), "https://x.test", "qc-zonage-a", { limit: 10 });
  eq("readZoneCollection — multiple exact de limit ⇒ 2 pages (pas de page vide)", exact.pages, 2);
  const empty = await readZoneCollection(mockApi({ "qc-zonage-a": [] }), "https://x.test", "qc-zonage-a", { limit: 10 });
  eq("readZoneCollection — collection vide ⇒ 1 page, 0 feature", [empty.pages, empty.features], [1, 0]);
  await rejects("readZoneCollection — numberMatched change entre pages ⇒ rejet", readZoneCollection(mockApi({ "qc-zonage-a": codes.map(feat) }, { changeMatchedOn: "qc-zonage-a" }), "https://x.test", "qc-zonage-a", { limit: 10 }), /a changé/);
  await rejects("readZoneCollection — limit invalide ⇒ rejet", readZoneCollection(mockApi({}), "https://x.test", "qc-zonage-a", { limit: 0 }), /limit invalide/);
}

// ── HTTP fail-closed ─────────────────────────────────────────────────────────
{
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
  const seq = (list) => { let i = 0; const calls = { n: 0 }; const f = async () => { calls.n += 1; const x = list[Math.min(i++, list.length - 1)]; if (x instanceof Error) throw x; return x; }; return { f, calls }; };
  ok("isRetryableStatus — 429/5xx oui, 404/400 non", isRetryableStatus(429) && isRetryableStatus(503) && !isRetryableStatus(404) && !isRetryableStatus(400));
  const a = seq([resp(503, ""), resp(200, '{"ok":1}')]);
  eq("getJsonWithRetry — 503 puis 200 ⇒ JSON, 2 appels", [await getJsonWithRetry("https://x.test/a", { fetchImpl: a.f, sleep: noSleep }), a.calls.n], [{ ok: 1 }, 2]);
  const b = seq([resp(404, "")]);
  await rejects("getJsonWithRetry — 404 ⇒ échec immédiat", getJsonWithRetry("https://x.test/b", { fetchImpl: b.f, sleep: noSleep }), /HTTP 404/);
  eq("getJsonWithRetry — 404 ⇒ 1 seul appel", b.calls.n, 1);
  const c = seq([new Error("ECONNRESET")]);
  await rejects("getJsonWithRetry — réseau KO ×3 ⇒ échec", getJsonWithRetry("https://x.test/c", { fetchImpl: c.f, sleep: noSleep }), /erreur réseau/);
  eq("getJsonWithRetry — réseau KO ⇒ 3 tentatives bornées", c.calls.n, 3);
  const d = seq([resp(200, "Client Closed Request")]);
  await rejects("getJsonWithRetry — corps non JSON ×3 ⇒ échec", getJsonWithRetry("https://x.test/d", { fetchImpl: d.f, sleep: noSleep }), /non JSON/);
  const e = seq([resp(502, ""), resp(502, ""), resp(502, "")]);
  await rejects("getJsonWithRetry — 502 persistant ⇒ échec après 3", getJsonWithRetry("https://x.test/e", { fetchImpl: e.f, sleep: noSleep }), /HTTP 502/);
}

// ── parallélisme borné ───────────────────────────────────────────────────────
{
  let inFlight = 0;
  let max = 0;
  const out = await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async (x) => {
    inFlight += 1; max = Math.max(max, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight -= 1;
    return x * 2;
  });
  eq("mapLimit — ordre préservé", out.slice(0, 4), [0, 2, 4, 6]);
  eq("mapLimit — concurrence bornée à 4 et effective", max, 4);
  let started = 0;
  await rejects("mapLimit — 1er échec ⇒ rejet", mapLimit(Array.from({ length: 50 }, (_, i) => i), 2, async (x) => { started += 1; await new Promise((r) => setTimeout(r, 1)); if (x === 3) throw new Error("boom"); }), /boom/);
  ok(`mapLimit — plus aucun lancement après l'échec (${started} < 50)`, started < 50);
  await rejects("mapLimit — concurrence invalide ⇒ rejet", mapLimit([1], 0, async () => 1), /concurrence invalide/);
}

// ── orchestration build (API + builder simulés) ─────────────────────────────
{
  const collections = {
    "qc-zonage-westmount": [feat("R13-02-02"), feat("r13-02-02 "), feat(null), feat("C1")],
    "qc-zonage-laval": Array.from({ length: 23 }, (_, i) => feat(`H-${i}`)),
    "qc-zonage-norms-laval": [feat("NORMS")],
    "qc-zonage-l-assomption": [feat("X-1")],
    "qc-lots-laval": [feat("LOT")],
  };
  const calls = [];
  const r = await buildServedZoneIds({ apiUrl: "https://x.test/", registrySlugs: ["laval", "westmount", "absente"], getJson: mockApi(collections, { calls }), builder: fakeBuilder, concurrency: 4, pageLimit: 10 });
  ok("build — ids zones seulement, triés octets", r.ids.every((id) => id.startsWith("ogc:zones:")) && r.ids.every((id, i) => i === 0 || byteCompare(r.ids[i - 1], id) < 0));
  eq("build — dédup (R13-02-02 ×2) + skip zone_code null", r.ids.filter((id) => id.startsWith("ogc:zones:westmount:")), ["ogc:zones:westmount:C1", "ogc:zones:westmount:R13-02-02"]);
  eq("build — 23 + 2 ids", r.ids.length, 25);
  ok("build — norms / hors registre / lots jamais lus", !calls.some((u) => /qc-zonage-norms-laval|qc-zonage-l-assomption|qc-lots-laval/.test(u)));
  eq("build — texte = 1 id/ligne + LF", r.text, `${r.ids.join("\n")}\n`);
  eq("build — sha256 = sha des octets exacts", r.sha256, sha256Hex(r.text));
  eq("build — comptes", [r.counts.zone_collections_read, r.counts.features, r.counts.features_zone_code_absent, r.counts.pages, r.counts.ids, r.counts.registry_slugs_without_zone_collection, r.counts.excluded_norms_collections, r.counts.excluded_unregistered_qc_zonage_collections], [2, 27, 1, 4, 25, 1, 1, 1]);
  eq("build — missing = slug du registre absent de /collections", r.selection.missing, ["absente"]);
  eq("build — résumé par collection", r.collections.map((c) => [c.id, c.features, c.pages, c.ids]), [["qc-zonage-laval", 23, 3, 23], ["qc-zonage-westmount", 4, 1, 2]]);

  await rejects("build — items 404 d'une collection SERVIE ⇒ échec (pas toléré)", buildServedZoneIds({ apiUrl: "https://x.test", registrySlugs: ["laval", "westmount"], getJson: mockApi(collections, { failItems: new Set(["qc-zonage-laval"]) }), builder: fakeBuilder, pageLimit: 10 }), /HTTP 404/);
  await rejects("build — /collections vide ⇒ échec", buildServedZoneIds({ apiUrl: "https://x.test", registrySlugs: ["laval"], getJson: async () => ({ collections: [] }), builder: fakeBuilder }), /collections vide/);
  await rejects("build — aucune collection du registre servie ⇒ échec", buildServedZoneIds({ apiUrl: "https://x.test", registrySlugs: ["absente"], getJson: mockApi(collections), builder: fakeBuilder }), /aucune collection/);
  await rejects("build — seulement des zone_code vides ⇒ résultat vide ⇒ échec", buildServedZoneIds({ apiUrl: "https://x.test", registrySlugs: ["a"], getJson: mockApi({ "qc-zonage-a": [feat(null), feat("")] }), builder: fakeBuilder }), /vide/);
  await rejects("build — builder qui ne trie pas ⇒ échec", buildServedZoneIds({ apiUrl: "https://x.test", registrySlugs: ["laval"], getJson: mockApi(collections), builder: { ...fakeBuilder, build: (i) => fakeBuilder.build(i).reverse() }, pageLimit: 10 }), /non triés/);
  await rejects("build — sérialisation non conforme ⇒ échec", buildServedZoneIds({ apiUrl: "https://x.test", registrySlugs: ["laval"], getJson: mockApi(collections), builder: { ...fakeBuilder, serialize: (ids) => ids.join("\n") }, pageLimit: 10 }), /sérialisation/);

  const out = join(TMP, "artefact");
  writeServedIdsArtifact(out, r, { scope: "zones" });
  ok("artefact — 4 fichiers écrits", [IDS_FILE, SHA_FILE, META_FILE, MISSING_FILE].every((f) => existsSync(join(out, f))));
  eq("artefact — served-ids.txt = texte exact", readFileSync(join(out, IDS_FILE), "utf8"), r.text);
  eq("artefact — .sha256 = sha du fichier", parseSha256File(readFileSync(join(out, SHA_FILE), "utf8")), sha256Hex(readFileSync(join(out, IDS_FILE))));
  eq("artefact — missing-zone-collections.txt", readFileSync(join(out, MISSING_FILE), "utf8"), "qc-zonage-absente\n");
  eq("readServedIdsSha — artefact valide ⇒ sha recalculé", readServedIdsSha(out), r.sha256);
  eq("readServedIdsSha — dossier absent ⇒ null", readServedIdsSha(join(TMP, "nope")), null);
  const bad = join(TMP, "bad");
  mkdirSync(bad);
  writeFileSync(join(bad, IDS_FILE), "ogc:zones:a:A\n");
  writeFileSync(join(bad, SHA_FILE), sha256FileLine("0".repeat(64)));
  throws("readServedIdsSha — sha incohérent ⇒ lève", () => readServedIdsSha(bad), /incohérent/);
  const half = join(TMP, "half");
  mkdirSync(half);
  writeFileSync(join(half, SHA_FILE), sha256FileLine("0".repeat(64)));
  throws("readServedIdsSha — .sha256 sans served-ids.txt ⇒ lève", () => readServedIdsSha(half), /incomplet/);
}

// ── builder publié : résolution + version épinglée (paquets factices, 0 réseau) ──
{
  const mk = (name, pkg, js) => {
    const dir = join(TMP, name);
    const pkgDir = join(dir, "node_modules", "@sentropic", "geo");
    mkdirSync(join(pkgDir, "dist"), { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify(pkg));
    if (js !== undefined) writeFileSync(join(pkgDir, "dist", "index.js"), js);
    return dir;
  };
  const good = { name: "@sentropic/geo", version: BUILDER_VERSION, type: "module", exports: { ".": { import: "./dist/index.js" } } };
  eq("builder épinglé — version 0.6.2", BUILDER_VERSION, "0.6.2");
  throws("resolveBuilderEntry — absent ⇒ lève", () => resolveBuilderEntry(join(TMP, "vide")), /builder introuvable/);
  throws("resolveBuilderEntry — autre version ⇒ lève", () => resolveBuilderEntry(mk("v061", { ...good, version: "0.6.1" }, "")), /≠ version épinglée/);
  throws("resolveBuilderEntry — autre paquet ⇒ lève", () => resolveBuilderEntry(mk("other", { ...good, name: "evil" }, "")), /paquet inattendu/);
  throws("resolveBuilderEntry — sans exports import ⇒ lève", () => resolveBuilderEntry(mk("noexp", { ...good, exports: {} }, "")), /exports/);
  const okDir = mk("ok", good, "export const buildServedCanonicalIds = () => ['ogc:zones:a:A'];\nexport const serializeServedCanonicalIds = (i) => i.join('\\n') + '\\n';\n");
  const b = await loadBuilder(okDir);
  eq("loadBuilder — fonctions + version", [typeof b.build, typeof b.serialize, b.version], ["function", "function", BUILDER_VERSION]);
  await rejects("loadBuilder — export manquant ⇒ rejet", loadBuilder(mk("nofn", good, "export const x = 1;\n")), /n'exporte pas/);
}

// ── cycle-leg : mapping verdicts, T1, sha, legs.geo ──────────────────────────
eq("mapJobResult — success", mapJobResult("success"), "success");
eq("mapJobResult — failure/cancelled/skipped ⇒ failure", ["failure", "cancelled", "skipped"].map(mapJobResult), ["failure", "failure", "failure"]);
eq("mapJobResult — vide/inconnu ⇒ pending", ["", undefined, null, "in_progress"].map(mapJobResult), ["pending", "pending", "pending", "pending"]);
eq("parseT1 — ISO (toISOString) + LF", parseT1("2026-09-25T03:17:42.123Z\n"), "2026-09-25T03:17:42.123Z");
eq("parseT1 — sans millisecondes", parseT1("2026-09-25T03:17:42Z"), "2026-09-25T03:17:42Z");
eq("parseT1 — illisible/vide/non UTC ⇒ null", ["", "hier", "2026-09-25 03:17:42", "2026-09-25T03:17:42+02:00", "2026-13-45T99:99:99Z"].map(parseT1), [null, null, null, null, null]);
eq("shortSha — 40 hex ⇒ 7", shortSha("0B1D3BC0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), "0b1d3bc");
throws("shortSha — invalide ⇒ lève", () => shortSha("main"), /invalide/);
{
  const leg = buildGeoLeg({ cycleId: "c-1", runId: 123456, gitSha: "0b1d3bc0" + "a".repeat(32), t1: "2026-09-25T03:17:42.123Z", pgResult: "success", s3Result: "cancelled", servedIdsSha256: "d".repeat(64) });
  eq("buildGeoLeg — schéma legs.geo exact (ordre des clés)", leg, {
    repo: "rhanka/geo",
    workflow: "bascule-preprod.yml",
    run_id: "123456",
    sha_main: "0b1d3bc",
    t1: "2026-09-25T03:17:42.123Z",
    mode: "chain",
    backup: null,
    verdict: { pg: "success", s3: "failure" },
    served_ids_artifact: "geo-served-canonical-ids-c-1",
    served_ids_sha256: "d".repeat(64),
    served_ids_scope: "zones",
  });
  const noSha = buildGeoLeg({ cycleId: "c-1", runId: "1", gitSha: "abcdef0", t1: null, pgResult: "failure", s3Result: "success", servedIdsSha256: null });
  eq("buildGeoLeg — sans artefact ⇒ sha null, verdict s3 inchangé", [noSha.served_ids_sha256, noSha.verdict.s3, noSha.t1], [null, "success", null]);
  throws("buildGeoLeg — run_id invalide ⇒ lève", () => buildGeoLeg({ cycleId: "c", runId: "x", gitSha: "abcdef0" }), /run_id/);
  throws("buildGeoLeg — sha invalide ⇒ lève", () => buildGeoLeg({ cycleId: "c", runId: "1", gitSha: "abcdef0", servedIdsSha256: "xyz" }), /served_ids_sha256/);
  throws("buildGeoLeg — CYCLE_ID invalide ⇒ lève", () => buildGeoLeg({ cycleId: "a b", runId: "1", gitSha: "abcdef0" }), /CYCLE_ID/);
}

// ── CLI (sous-processus, 0 réseau) ───────────────────────────────────────────
{
  const run = (args, env) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
  const bad = run(["validate-cycle-id"], { CYCLE_ID: "a/b" });
  ok("CLI validate-cycle-id — invalide ⇒ exit 1", bad.status === 1 && /CYCLE_ID invalide/.test(bad.stdout));
  ok("CLI validate-cycle-id — vide ⇒ exit 1", run(["validate-cycle-id"], { CYCLE_ID: "" }).status === 1);
  ok("CLI validate-cycle-id — valide ⇒ exit 0", run(["validate-cycle-id"], { CYCLE_ID: "e2e-1" }).status === 0);
  const ver = run(["builder-version"], {});
  eq("CLI builder-version — source unique de l'install npm", ver.stdout.trim(), BUILDER_VERSION);
  const noBuilder = run(["build", "--builder-dir", join(TMP, "vide"), "--out", join(TMP, "o")], { PREPROD_API_URL: "http://127.0.0.1:9" });
  ok("CLI build — builder absent ⇒ exit 1 AVANT tout réseau", noBuilder.status === 1 && /builder introuvable/.test(noBuilder.stdout) && !/registre/.test(noBuilder.stdout));
  ok("CLI build — arguments manquants ⇒ exit 1", run(["build"], {}).status === 1);

  // cycle-leg de bout en bout sur des dossiers simulés.
  const pgDir = join(TMP, "leg-pg");
  mkdirSync(pgDir);
  writeFileSync(join(pgDir, "T1.txt"), "2026-09-25T03:17:42.123Z\n");
  const servedDir = join(TMP, "leg-served");
  mkdirSync(servedDir);
  writeFileSync(join(servedDir, IDS_FILE), "ogc:zones:a:A-1\n");
  writeFileSync(join(servedDir, SHA_FILE), sha256FileLine(sha256Hex("ogc:zones:a:A-1\n")));
  const legEnv = { CYCLE_ID: "e2e-1", PG_RESULT: "success", S3_RESULT: "success", GITHUB_RUN_ID: "42", GITHUB_SHA: "0b1d3bc0" + "f".repeat(32), GITHUB_REPOSITORY: "rhanka/geo" };
  const outFile = join(TMP, "leg-out", "cycle-leg-geo.json");
  const legRun = run(["cycle-leg", "--pg-dir", pgDir, "--served-dir", servedDir, "--out", outFile], legEnv);
  ok("CLI cycle-leg — exit 0", legRun.status === 0);
  const leg = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {};
  eq("CLI cycle-leg — legs.geo complet", leg, {
    repo: "rhanka/geo", workflow: "bascule-preprod.yml", run_id: "42", sha_main: "0b1d3bc", t1: "2026-09-25T03:17:42.123Z", mode: "chain", backup: null,
    verdict: { pg: "success", s3: "success" }, served_ids_artifact: "geo-served-canonical-ids-e2e-1",
    served_ids_sha256: sha256Hex("ogc:zones:a:A-1\n"), served_ids_scope: "zones",
  });
  const outDry = join(TMP, "leg-dry", "cycle-leg-geo.json");
  const dry = run(["cycle-leg", "--pg-dir", join(TMP, "absent-pg"), "--served-dir", join(TMP, "absent-served"), "--out", outDry], { ...legEnv, S3_RESULT: "skipped" });
  const legDry = existsSync(outDry) ? JSON.parse(readFileSync(outDry, "utf8")) : {};
  ok("CLI cycle-leg — artefacts absents ⇒ exit 0, t1/sha null, s3 skipped ⇒ failure", dry.status === 0 && legDry.t1 === null && legDry.served_ids_sha256 === null && legDry.verdict?.s3 === "failure");
  writeFileSync(join(servedDir, IDS_FILE), "ogc:zones:a:ALTERE\n");
  ok("CLI cycle-leg — artefact served-ids altéré ⇒ exit 1", run(["cycle-leg", "--served-dir", servedDir, "--out", join(TMP, "x.json")], legEnv).status === 1);
  ok("CLI cycle-leg — CYCLE_ID invalide ⇒ exit 1", run(["cycle-leg", "--out", join(TMP, "y.json")], { ...legEnv, CYCLE_ID: "a b" }).status === 1);
}

// ── workflow : validation STRUCTURELLE (yaml) ───────────────────────────────
{
  let YAML;
  const from = process.env.YAML_RESOLVE_FROM || join(REPO_ROOT, "package.json");
  try { YAML = createRequire(from)("yaml"); } catch (e) { ok(`workflow — paquet yaml résolu depuis ${from} (${e.message.split("\n")[0]})`, false); }
  if (YAML) {
    const wfPath = join(REPO_ROOT, ".github", "workflows", "bascule-preprod.yml");
    const wfText = readFileSync(wfPath, "utf8");
    const wf = YAML.parse(wfText);
    const jobs = wf?.jobs ?? {};
    eq("workflow — jobs pg, s3, list, restore, cycle-leg", Object.keys(jobs), ["pg", "s3", "list", "restore", "cycle-leg"]);
    ok("workflow — pg SANS needs", jobs.pg && !("needs" in jobs.pg));
    ok("workflow — s3 SANS needs", jobs.s3 && !("needs" in jobs.s3));
    eq("workflow — cycle-leg needs [pg, s3, restore]", jobs["cycle-leg"]?.needs, ["pg", "s3", "restore"]);
    const legIf = String(jobs["cycle-leg"]?.if ?? "");
    ok("workflow — cycle-leg if always() && CYCLE_ID non vide", /always\(\)/.test(legIf) && /inputs\.CYCLE_ID != ''/.test(legIf));
    const input = wf?.on?.workflow_dispatch?.inputs?.CYCLE_ID;
    ok("workflow — input CYCLE_ID optionnel string, défaut vide", input && input.required === false && input.type === "string" && input.default === "");
    ok("workflow — CONFIRM/DRY_RUN/SKIP_ROLLOUT inchangés", ["CONFIRM", "DRY_RUN", "SKIP_ROLLOUT"].every((k) => wf.on.workflow_dispatch.inputs[k]));
    const allSteps = Object.entries(jobs).flatMap(([job, j]) => (j.steps ?? []).map((s) => ({ job, ...s })));
    ok("workflow — aucun ${{ inputs.CYCLE_ID }} interpolé dans un run: (anti-injection)", allSteps.every((s) => !/\$\{\{\s*inputs\.CYCLE_ID/.test(String(s.run ?? ""))));
    const usesCycle = allSteps.filter((s) => /inputs\.CYCLE_ID|served-ids\.mjs/.test(JSON.stringify(s)) && s.job !== "cycle-leg" && s.job !== "list");
    ok(`workflow — chaque étape e2e de pg/s3 est gardée par CYCLE_ID != '' (${usesCycle.length} étapes)`, usesCycle.length >= 5 && usesCycle.every((s) => /inputs\.CYCLE_ID != ''/.test(String(s.if ?? ""))));
    const s3Steps = jobs.s3.steps.map((s) => s.name ?? s.uses);
    const smokeIdx = s3Steps.findIndex((n) => /S7 smoke — préprod ⊇ prod/.test(n));
    const e2eIdx = jobs.s3.steps.findIndex((s) => /served-ids\.mjs build/.test(String(s.run ?? "")));
    ok("workflow — build served-ids APRÈS le smoke S7 fatal", smokeIdx >= 0 && e2eIdx > smokeIdx);
    ok("workflow — build served-ids hors DRY", /!inputs\.DRY_RUN/.test(String(jobs.s3.steps[e2eIdx]?.if ?? "")));
    const upload = jobs.s3.steps.find((s) => String(s.with?.name ?? "").startsWith("geo-served-canonical-ids-"));
    ok("workflow — artefact geo-served-canonical-ids-<CYCLE_ID> (if-no-files-found: error)", upload && upload.with.name === "geo-served-canonical-ids-${{ inputs.CYCLE_ID }}" && upload.with["if-no-files-found"] === "error");
    const install = jobs.s3.steps.find((s) => /npm install/.test(String(s.run ?? "")));
    ok("workflow — builder installé hors workspace ($RUNNER_TEMP), version tirée de served-ids.mjs", install && /--prefix "\$RUNNER_TEMP\//.test(install.run) && /builder-version/.test(install.run) && /--ignore-scripts/.test(install.run));
    const legUpload = jobs["cycle-leg"].steps.find((s) => String(s.with?.name ?? "").startsWith("cycle-leg-geo-"));
    ok("workflow — artefact cycle-leg-geo-<CYCLE_ID>", legUpload && legUpload.with.name === "cycle-leg-geo-${{ inputs.CYCLE_ID }}");
    const legText = JSON.stringify(jobs["cycle-leg"]);
    ok("workflow — cycle-leg : 0 kubectl, 0 secret", !/kubectl|secrets\./.test(legText));
    ok("workflow — cycle-leg valide CYCLE_ID avant tout téléchargement", jobs["cycle-leg"].steps.findIndex((s) => /validate-cycle-id/.test(String(s.run ?? ""))) < jobs["cycle-leg"].steps.findIndex((s) => /download-artifact/.test(String(s.uses ?? ""))));
    ok("workflow — étapes e2e : 0 kubectl, 0 secret", allSteps.filter((s) => /e2e/.test(String(s.name ?? ""))).every((s) => !/kubectl|secrets\./.test(JSON.stringify(s))));
  }
}

// ── contrôle OPTIONNEL : builder PUBLIÉ déjà installé (0 réseau) ──────────────
if (process.env.SERVED_IDS_SELFTEST_BUILDER_DIR) {
  const b = await loadBuilder(process.env.SERVED_IDS_SELFTEST_BUILDER_DIR);
  const ids = b.build({ zones: [{ citySlug: "westmount", zoneCode: "R13-02-02" }, { citySlug: "laval", zoneCode: "CI.2-5530" }, { citySlug: "montreal", zoneCode: "U02-95" }, { citySlug: "montreal", zoneCode: "U-2-95" }, { citySlug: "x", zoneCode: null }] });
  eq(`builder publié ${b.version} — ids exemples réels (dédup canonique)`, ids, ["ogc:zones:laval:CI.2-5530", "ogc:zones:montreal:U-2-95", "ogc:zones:westmount:R-13-02-02"]);
  assertServedZoneIds(ids);
  assertSerialization(ids, b.serialize(ids));
  ok("builder publié — sortie conforme aux gardes (tri octets, format, sérialisation)", true);
} else {
  console.log("  info contrôle du builder publié non demandé (SERVED_IDS_SELFTEST_BUILDER_DIR absent)");
}

rmSync(TMP, { recursive: true, force: true });
console.log(`\nserved-ids.selftest — ${passed} passés, ${failed} échoués`);
process.exit(failed ? 1 : 0);
