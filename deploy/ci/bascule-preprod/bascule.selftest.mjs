#!/usr/bin/env node
// =============================================================================
// bascule.selftest.mjs — self-test des fonctions PURES de bascule.mjs (geo).
// CLONE geo de radar-immobilier:deploy/ci/bascule-preprod/bascule.selftest.mjs.
//
// N'exécute AUCUN appel réel (0 kubectl, 0 aws, 0 DB, 0 réseau) : il n'importe que
// les fonctions pures exportées et les nourrit de données MOCKÉES. Seule exception :
// un sous-processus `node bascule.mjs preflight <jambe inconnue>`, qui échoue AVANT
// tout appel d'outil (vérifie le fail-closed du sélecteur de jambe).
//
//   node deploy/ci/bascule-preprod/bascule.selftest.mjs   → exit 0 si tout passe.
// =============================================================================
import process from "node:process";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { classifyJobStatus, withScheme, parseListingMeta, reconMissing, collectionIds, servedIdsMissing, preflightRequirements } from "./bascule.mjs";

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

// ── preflightRequirements : sélecteur de JAMBE (pg / s3 parallèles, geo) ─────
const ALL_PARAMS = ["EXPECTED_DATABASE", "BHS", "PROD_DOCS", "PREPROD_DOCS", "DUMP_BUCKET", "PREPROD_API_URL", "PROD_API_URL"];
eq("preflight — sans jambe ⇒ liste historique (les deux jambes, inchangée)", preflightRequirements(), { bins: ["node", "kubectl", "curl"], params: ALL_PARAMS });
eq("preflight — jambe '' ⇒ les deux jambes", preflightRequirements(""), preflightRequirements());
eq("preflight — jambe pg ⇒ EXPECTED_DATABASE + BHS + DUMP_BUCKET (0 curl)", preflightRequirements("pg"), { bins: ["node", "kubectl"], params: ["EXPECTED_DATABASE", "BHS", "DUMP_BUCKET"] });
eq("preflight — jambe s3 ⇒ buckets docs + URLs API (curl smoke)", preflightRequirements("s3"), { bins: ["node", "kubectl", "curl"], params: ["BHS", "PROD_DOCS", "PREPROD_DOCS", "PREPROD_API_URL", "PROD_API_URL"] });
ok("preflight — pg n'exige AUCUN param propre à S3", !["PROD_DOCS", "PREPROD_DOCS", "PREPROD_API_URL", "PROD_API_URL"].some((k) => preflightRequirements("pg").params.includes(k)));
ok("preflight — s3 n'exige AUCUN param propre à PG", !["EXPECTED_DATABASE", "DUMP_BUCKET"].some((k) => preflightRequirements("s3").params.includes(k)));
{
  const union = new Set([...preflightRequirements("pg").params, ...preflightRequirements("s3").params]);
  ok("preflight — pg ∪ s3 = liste complète (aucun param orphelin)", union.size === ALL_PARAMS.length && ALL_PARAMS.every((k) => union.has(k)));
  const binsUnion = new Set([...preflightRequirements("pg").bins, ...preflightRequirements("s3").bins]);
  ok("preflight — binaires pg ∪ s3 = binaires complets", binsUnion.size === 3 && ["node", "kubectl", "curl"].every((b) => binsUnion.has(b)));
}
eq("preflight — jambe inconnue ⇒ null (fail-closed)", preflightRequirements("sr"), null);
eq("preflight — casse stricte ('PG') ⇒ null", preflightRequirements("PG"), null);
eq("preflight — clé héritée d'Object ('toString') ⇒ null", preflightRequirements("toString"), null);
{
  const a = preflightRequirements("pg");
  a.params.push("MUTATION");
  ok("preflight — copie défensive (muter le retour n'altère pas la table)", !preflightRequirements("pg").params.includes("MUTATION"));
}
{
  // CLI : jambe inconnue ⇒ exit 1 AVANT tout appel d'outil (0 bash/kubectl/curl).
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "bascule.mjs"), "preflight", "bogus"], { encoding: "utf8", env: { PATH: process.env.PATH } });
  ok("preflight CLI — jambe inconnue ⇒ exit 1", r.status === 1);
  ok("preflight CLI — jambe inconnue ⇒ message fail-closed, 0 commande lancée", /jambe inconnue 'bogus'/.test(r.stdout) && !/\[bascule\] \$ /.test(r.stdout));
}

// ── docs-sync : copie INCRÉMENTALE + CONCURRENTE (script réel du template) ──────
// Le script `node -e` du Job est extrait du template et exécuté dans un contexte vm
// avec un faux @aws-sdk/client-s3 (0 réseau). On vérifie ce qu'il COPIE.
{
  const tmpl = readFileSync(join(import.meta.dirname, "docs-sync-job.tmpl.yaml"), "utf8");
  const m = tmpl.match(/\n {10}args:\n {12}- \|\n([\s\S]*?)\n {10}env:/);
  ok("docs-sync — script node extrait du template", !!m);
  const code = m ? m[1].split("\n").map((l) => l.replace(/^ {14}/, "")).join("\n") : "";
  ok("docs-sync — aucun placeholder ${...} dans le script", !/\$\{/.test(code));

  const T0 = "2026-09-01T00:00:00.000Z";
  const T1 = "2026-09-20T00:00:00.000Z";
  const o = (Key, Size, ETag, LastModified) => ({ Key, Size, ETag, LastModified });
  const runSync = ({ srcObjs, dstObjs, dstListFails = false, failCopyKey = null, concurrency, pageSize = 2 }) => new Promise((resolve) => {
    const copies = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve({ ...r, copies, maxInFlight }); } };
    class Cmd { constructor(input) { this.input = input; } }
    class ListObjectsV2Command extends Cmd {}
    class CopyObjectCommand extends Cmd {}
    class HeadObjectCommand extends Cmd {}
    class S3Client {
      async send(cmd) {
        const i = cmd.input;
        if (cmd instanceof ListObjectsV2Command) {
          if (i.Bucket === "dst" && dstListFails) throw Object.assign(new Error("denied"), { name: "AccessDenied" });
          const all = i.Bucket === "src" ? srcObjs : dstObjs;
          const start = i.ContinuationToken ? Number(i.ContinuationToken) : 0;
          const size = i.MaxKeys || pageSize;
          const page = all.slice(start, start + size);
          const more = start + size < all.length && !i.MaxKeys;
          return { Contents: page, IsTruncated: more, NextContinuationToken: more ? String(start + size) : undefined };
        }
        if (cmd instanceof HeadObjectCommand) return {};
        if (cmd instanceof CopyObjectCommand) {
          inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 2));
          inFlight -= 1;
          if (i.Key === failCopyKey) throw Object.assign(new Error("boom"), { name: "InternalError" });
          copies.push(i);
          return {};
        }
        throw new Error("commande inattendue");
      }
    }
    const env = { S3_ENDPOINT: "https://s3.test", SRC_BUCKET: "src", DST_BUCKET: "dst", COPY_GRANTEE: "g1", COPY_PREFIX: "normalized/", ...(concurrency ? { COPY_CONCURRENCY: String(concurrency) } : {}) };
    const logs = [];
    const fakeConsole = {
      log: (...a) => { const s = a.join(" "); logs.push(s); if (s.startsWith("[docs-sync] ok ")) finish({ code: 0, logs }); },
      warn: (...a) => logs.push(a.join(" ")),
      error: (...a) => logs.push(a.join(" ")),
    };
    const fakeProcess = { env, exit: (c) => finish({ code: c, logs }) };
    const sdk = { S3Client, ListObjectsV2Command, CopyObjectCommand, HeadObjectCommand };
    vm.runInNewContext(code, { require: (id) => { if (id !== "@aws-sdk/client-s3") throw new Error(id); return sdk; }, process: fakeProcess, console: fakeConsole });
  });

  const SRC5 = [
    o("normalized/a", 10, '"e1"', T0),        // dst identique (même ETag) ⇒ sauté
    o("normalized/b", 20, '"e2"', T0),        // dst même Size, ETag différent, copiée APRÈS ⇒ sautée
    o("normalized/c", 30, '"e3"', T0),        // dst Size différente ⇒ copiée
    o("normalized/d", 40, '"e4-3"', T1),      // dst même Size, ETag différent, plus ANCIENNE que prod ⇒ copiée
    o("normalized/e f", 50, '"e5"', T0),      // absente de dst ⇒ copiée (clé avec espace)
  ];
  const DST5 = [
    o("normalized/a", 10, '"e1"', T0),
    o("normalized/b", 20, '"md5-b"', T1),
    o("normalized/c", 31, '"e3"', T1),
    o("normalized/d", 40, '"md5-d"', T0),
    o("normalized/x-preprod", 7, '"px"', T0), // extra préprod ignoré
  ];
  const keys = (r) => r.copies.map((c) => c.Key).sort();

  const r1 = await runSync({ srcObjs: SRC5, dstObjs: DST5 });
  eq("docs-sync — exit 0", r1.code, 0);
  eq("docs-sync — copie SEULEMENT absentes/différentes (pagination src+dst)", keys(r1), ["normalized/c", "normalized/d", "normalized/e f"]);
  ok("docs-sync — CopySource encodé + GrantFullControl + même clé", r1.copies.some((c) => c.CopySource === "/src/normalized/e%20f" && c.GrantFullControl === "id=g1" && c.Bucket === "dst"));
  ok("docs-sync — compte rendu source/deja_a_jour/a_copier", r1.logs.some((l) => /source=5 deja_a_jour=2 a_copier=3 concurrence=8/.test(l)));

  const r2 = await runSync({ srcObjs: SRC5, dstObjs: SRC5 });
  eq("docs-sync — préprod déjà complète ⇒ 0 copie, exit 0", [r2.code, r2.copies.length], [0, 0]);

  const r3 = await runSync({ srcObjs: SRC5, dstObjs: DST5, dstListFails: true });
  eq("docs-sync — LIST destination refusée ⇒ repli copie complète", [r3.code, r3.copies.length], [0, 5]);
  ok("docs-sync — repli signalé en WARN", r3.logs.some((l) => /LIST destination impossible \(AccessDenied\)/.test(l)));

  const MANY = Array.from({ length: 40 }, (_, k) => o(`normalized/k${k}`, k + 1, `"e${k}"`, T0));
  const r4 = await runSync({ srcObjs: MANY, dstObjs: [], concurrency: 4, pageSize: 7 });
  eq("docs-sync — 40 absentes ⇒ 40 copies", [r4.code, r4.copies.length], [0, 40]);
  ok(`docs-sync — concurrence bornée à COPY_CONCURRENCY=4 et effective (max ${r4.maxInFlight})`, r4.maxInFlight === 4);

  const r5 = await runSync({ srcObjs: MANY, dstObjs: [], concurrency: 999 });
  ok(`docs-sync — COPY_CONCURRENCY plafonnée à 32 (max ${r5.maxInFlight})`, r5.maxInFlight <= 32 && r5.maxInFlight > 1);

  const r6 = await runSync({ srcObjs: MANY, dstObjs: [], failCopyKey: "normalized/k7" });
  eq("docs-sync — erreur de copie ⇒ exit 1 (fail-closed)", r6.code, 1);

  const r7 = await runSync({ srcObjs: [], dstObjs: DST5 });
  eq("docs-sync — source vide ⇒ exit 1 (inchangé)", [r7.code, r7.copies.length], [1, 0]);
}

// ── Cadence du run planifié : HEBDOMADAIRE, dimanche 03:17 UTC (décision owner 2026-09-26) ──
{
  const wf = readFileSync(join(import.meta.dirname, "../../../.github/workflows/bascule-preprod.yml"), "utf8");
  const crons = [...wf.matchAll(/^\s*- cron: '([^']*)'/mg)].map((x) => x[1]);
  eq("bascule-preprod.yml — un seul cron, hebdomadaire dimanche 03:17 UTC", crons, ["17 3 * * 0"]);
  ok("bascule-preprod.yml — run planifié armé par vars.BASCULE_SCHEDULE_ENABLED (inchangé)",
    wf.includes("github.event_name != 'schedule' || vars.BASCULE_SCHEDULE_ENABLED == 'true'"));
}

console.log(`\nbascule.selftest — ${passed} passés, ${failed} échoués`);
process.exit(failed ? 1 : 0);
