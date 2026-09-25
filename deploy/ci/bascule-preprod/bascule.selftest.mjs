#!/usr/bin/env node
// =============================================================================
// bascule.selftest.mjs — self-test des fonctions PURES de bascule.mjs (geo).
// CLONE geo de radar-immobilier:deploy/ci/bascule-preprod/bascule.selftest.mjs.
//
// N'exécute AUCUN appel réel (0 kubectl, 0 aws, 0 DB, 0 réseau) : il n'importe que
// les fonctions pures exportées et les nourrit de données MOCKÉES.
//
//   node deploy/ci/bascule-preprod/bascule.selftest.mjs   → exit 0 si tout passe.
// =============================================================================
import process from "node:process";
import console from "node:console";
import { classifyJobStatus, withScheme, parseListingMeta, reconMissing, collectionIds, servedIdsMissing } from "./bascule.mjs";

let passed = 0;
let failed = 0;
const ok = (name, cond) => {
  if (cond) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};
const eq = (name, a, b) => ok(`${name} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

// ── classifyJobStatus (identique immo) ───────────────────────────────────────
eq("succeeded=1 ⇒ done/ok/succeeded", classifyJobStatus({ succeeded: 1 }), { done: true, ok: true, state: "succeeded" });
eq("failed=1 ⇒ done/!ok/failed", classifyJobStatus({ failed: 1 }), { done: true, ok: false, state: "failed" });
eq("active=1 ⇒ !done/active", classifyJobStatus({ active: 1 }), { done: false, ok: false, state: "active" });
eq("{} ⇒ !done/pending", classifyJobStatus({}), { done: false, ok: false, state: "pending" });
eq("undefined ⇒ pending", classifyJobStatus(undefined), { done: false, ok: false, state: "pending" });
eq("null ⇒ pending", classifyJobStatus(null), { done: false, ok: false, state: "pending" });
eq("succeeded=1 & active=1 ⇒ succeeded", classifyJobStatus({ succeeded: 1, active: 1 }), { done: true, ok: true, state: "succeeded" });
eq("failed=1 & active=1 ⇒ failed", classifyJobStatus({ failed: 1, active: 1 }), { done: true, ok: false, state: "failed" });
eq("succeeded='1' (string) ⇒ succeeded", classifyJobStatus({ succeeded: "1" }), { done: true, ok: true, state: "succeeded" });
eq("failed='2' (string) ⇒ failed", classifyJobStatus({ failed: "2" }), { done: true, ok: false, state: "failed" });

// ── withScheme (identique immo) ──────────────────────────────────────────────
eq("withScheme — host nu ⇒ https://", withScheme("s3.bhs.io.cloud.ovh.net"), "https://s3.bhs.io.cloud.ovh.net");
eq("withScheme — déjà https:// (idempotent)", withScheme("https://s3.bhs.io.cloud.ovh.net"), "https://s3.bhs.io.cloud.ovh.net");
eq("withScheme — http:// conservé", withScheme("http://minio.local:9000"), "http://minio.local:9000");
eq("withScheme — espaces trim + préfixe", withScheme("  s3.example  "), "https://s3.example");
eq("withScheme — vide ⇒ vide", withScheme(""), "");

// ── reconMissing : DIFF LIST-only Key+Size (identique immo) ──────────────────
const SRC = ["normalized/a.geojson\t10", "normalized/b.meta.json\t20", "normalized/c 3.geojson\t30"].join("\n");
const DST_OK = [...SRC.split("\n"), "normalized/ca-qc-constraints-x.geojson\t99"].join("\n"); // + preprod-native
eq("recon — dest ⊇ src ⇒ [] (extras préprod tolérés)", reconMissing(SRC, DST_OK), []);
eq("recon — clé src absente de dst ⇒ manquante", reconMissing(SRC, ["normalized/a.geojson\t10", "normalized/b.meta.json\t20"].join("\n")), ["normalized/c 3.geojson"]);
eq("recon — Size différent ⇒ manquante", reconMissing(SRC, ["normalized/a.geojson\t10", "normalized/b.meta.json\t999", "normalized/c 3.geojson\t30"].join("\n")), ["normalized/b.meta.json"]);
eq("recon — ETag différent + Size identique ⇒ [] (ETag ignoré)", reconMissing("a\t10\t\"e1\"", "a\t10\t\"DIFF-multipart\""), []);
eq("recon — src vide ⇒ [] (dest ⊇ ∅)", reconMissing("", DST_OK), []);
ok("recon — parseListingMeta ne retient que la Size (col1)", parseListingMeta("a\t1\t\"e\"").get("a") === "1");
ok("recon — parseListingMeta ignore lignes vides", parseListingMeta("a\t1\n\n").size === 1);

// ── smoke THROUGH l'API (geo) : préprod ⊇ prod sur /collections ──────────────
eq("collectionIds — ids string seulement", collectionIds({ collections: [{ id: "a" }, { id: "" }, { id: 3 }, {}, { id: "b" }] }), ["a", "b"]);
eq("collectionIds — body sans collections ⇒ []", collectionIds({}), []);
eq("collectionIds — body null ⇒ []", collectionIds(null), []);
eq("servedIdsMissing — préprod ⊇ prod ⇒ []", servedIdsMissing(["a", "b"], ["b", "a", "ca-qc-constraints-x"]), []);
eq("servedIdsMissing — id prod absent ⇒ listé", servedIdsMissing(["a", "b", "c"], ["a"]), ["b", "c"]);
eq("servedIdsMissing — doublons prod dédupliqués", servedIdsMissing(["a", "a"], []), ["a"]);
eq("servedIdsMissing — prod vide ⇒ []", servedIdsMissing([], ["a"]), []);

console.log(`\nbascule.selftest — ${passed} passés, ${failed} échoués`);
process.exit(failed ? 1 : 0);
