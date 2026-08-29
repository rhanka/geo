// Tests du générateur index+résolveur (node:test, zéro-dep). Protègent le CONTRAT :
// déterminisme/pureté, URL brute verbatim, DRIFT (branche jamais exécutée sur les données
// réelles — drift=0 — donc VÉRIFIÉE ici sur fixture synthétique : anti-invention geo-archi),
// additivité v1→v2, ext-divergence pontée, cas-absent compté.
//   Exécution : node --test scripts/  (câblé dans `npm run test:scripts` → `verify`).
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildArtifact, CAS_KEY_RE } from "./geo-pv-cas-sha-slug-index.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

const line = (slug, sha, ext, url) => ({ slug, url, storage_key: `raw/pv-index/cas/${sha}.${ext}` });
const manifest = (relPath, lines) => ({ relPath, doc: { lines } });

test("déterministe + pur : mêmes inputs → sortie octet-identique", () => {
  const inputs = [manifest("m.json", [line("arundel", SHA_A, "pdf", "https://x/a.pdf")])];
  assert.equal(
    JSON.stringify(buildArtifact(inputs).artifact),
    JSON.stringify(buildArtifact(inputs).artifact),
  );
});

test("résolveur : URL BRUTE verbatim = clé (jamais normalisée) → clé CAS geo canonique", () => {
  const url = "https://ville.example/PV%20avec espace.PDF?v=2"; // brute : casse/encodage/query préservés
  const { artifact } = buildArtifact([manifest("m.json", [line("beloeil", SHA_A, "pdf", url)])]);
  const e = artifact.resolve_by_source_url[url];
  assert.ok(e, "l'URL BRUTE est la clé exacte (aucune normalisation)");
  assert.equal(e.geo_cas_key, `raw/pv-index/cas/${SHA_A}.pdf`);
  assert.equal(e.sha256_geo, SHA_A);
  assert.equal(e.drift, false);
  assert.match(e.geo_cas_key, CAS_KEY_RE);
});

test("DRIFT (branche anti-invention) : url→≥2 sha-geo → geo_cas_key=null + candidates, JAMAIS deviné", () => {
  const url = "https://ville.example/pv.pdf";
  const { artifact } = buildArtifact([
    manifest("m1.json", [line("beloeil", SHA_A, "pdf", url)]),
    manifest("m2.json", [line("beloeil", SHA_B, "pdf", url)]),
  ]);
  const e = artifact.resolve_by_source_url[url];
  assert.equal(e.drift, true);
  assert.equal(e.geo_cas_key, null, "ambigu → aucune clé devinée");
  assert.equal(e.candidates.length, 2);
  assert.deepEqual(e.candidates.map((c) => c.sha256_geo).sort(), [SHA_A, SHA_B].sort());
  for (const c of e.candidates) assert.match(c.geo_cas_key, CAS_KEY_RE);
  assert.equal(artifact.summary.source_urls_drift, 1);
  assert.equal(artifact.summary.source_urls_single_key, 0);
});

test("additivité v1→v2 : by_sha256 porte cas_key (round-trip CAS_KEY_RE), by_slug préservé", () => {
  const { artifact } = buildArtifact([
    manifest("m.json", [
      line("arundel", SHA_A, "pdf", "https://x/a.pdf"),
      line("arundel", SHA_C, "docx", "https://x/c.docx"),
    ]),
  ]);
  const eA = artifact.by_sha256[SHA_A];
  assert.deepEqual(eA.slugs, ["arundel"]);
  assert.deepEqual(eA.urls, ["https://x/a.pdf"]);
  assert.equal(eA.source, "pv-index");
  assert.equal(eA.ext, "pdf");
  assert.equal(eA.cas_key, `raw/pv-index/cas/${SHA_A}.pdf`);
  assert.equal(CAS_KEY_RE.exec(eA.cas_key)[2], SHA_A, "cas_key round-trip → sha");
  assert.deepEqual(artifact.by_slug.arundel.sort(), [SHA_A, SHA_C].sort());
  assert.equal(artifact.contract, "geo-pv-cas-sha-slug-index/v2");
});

test("ext-divergence pontée : même URL → ext geo RÉELLE renvoyée (.docx, pas l'ext immo)", () => {
  const url = "https://ville.example/doc"; // immo peut l'avoir en .bin/.html ; geo l'a en .docx
  const { artifact } = buildArtifact([manifest("m.json", [line("x", SHA_C, "docx", url)])]);
  const e = artifact.resolve_by_source_url[url];
  assert.equal(e.geo_cas_key, `raw/pv-index/cas/${SHA_C}.docx`);
  assert.equal(e.ext, "docx");
});

test("cas-absent : storage_key non-CAS ou absent → compté, JAMAIS inventé", () => {
  const { artifact } = buildArtifact([
    manifest("m.json", [{ slug: "x", url: "https://x/y.pdf" }, { slug: "x", storage_key: "not-a-cas-key" }]),
  ]);
  assert.equal(artifact.summary.cas_absent_lines, 2);
  assert.equal(artifact.summary.total_cas_lines, 0);
  assert.deepEqual(artifact.resolve_by_source_url, {});
});

test("skipped : parse-error ou manifeste sans lines[] → recensé, pas planté", () => {
  const { artifact } = buildArtifact([
    { relPath: "bad.json", parseError: "Unexpected token" },
    { relPath: "nolines.json", doc: { kpi: true } },
  ]);
  assert.equal(artifact.inputs.skipped_unrecognized.length, 2);
  assert.equal(artifact.summary.distinct_sha256, 0);
});
