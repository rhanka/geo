#!/usr/bin/env node
// =============================================================================
// bascule.mjs — BASCULE PROD → PRÉPROD geo (« iso-prod »), CLI natif, 0 Python.
//
// CLONE geo de radar-immobilier:deploy/ci/bascule-preprod/bascule.mjs (recette
// i-cond, même mécanique, mêmes gardes). Seules différences : noms geo, buckets/
// préfixes, namespaces, runners geo. Sous-ensemble iso de S0→S7 (arbitrage i-cond) :
//
//   S0 preflight → S1 dump (trigger CronJob prod + Job freshness + re-suspend)
//   → S3/S4 copy-docs (objets servis `normalized/` DIRECT prod→préprod, CopyObject
//   server-side ADDITIF) → S3b recon (dest ⊇ src) → S5' rollout (restart geo-api
//   préprod, GARDE G4) → S7 smoke (verify THROUGH l'API publique, côté runner).
//
//   RETIRÉS vs immo en MODE=chain (0 writer à geler) : quiesce / un-quiesce (G2),
//   restore + rollback (G1), migrate (S2c), precheck-runs (S3c), refresh /
//   force-refresh (worker-live immo), flip GEO_DOCUMENTS_REPOINT (S5 immo). Côté DB
//   geo, la jambe chain = dump prod + freshness SEULEMENT (archive DR). La
//   restauration PG du postgis préprod (S2 + G1, pg-check avant) vit en MODE=restore
//   (restore-pg.mjs) ; S2c migrate y est N/A (geo n'a pas de migration).
//
// DATA-PLANE 100% CLUSTER-SIDE, RUNNER KUBECTL-ONLY (contrat owner, identique immo) :
// AUCUNE cred S3/DB, AUCUN listing/clé ne transite ni n'est lu par le runner GitHub.
// Le runner ne fait QUE du kubectl (2 kubeconfigs : préprod par défaut + PROD pour
// le seul trigger dump) + `curl` sur l'API geo PUBLIQUE (smoke, 0 cred) :
//   - kubectl : patch cronjob (suspend), dispatch/OBSERVE Jobs (.status SEUL,
//     JAMAIS `kubectl logs`), rollout restart geo-api préprod.
// TOUT l'accès object-store (copie/LIST/freshness) vit dans des Jobs PRÉPROD
// verdict-only (creds via secretKeyRef in-cluster ; exit code seul).
//
//   DEUX JAMBES INDÉPENDANTES, jouées EN PARALLÈLE (directive i-cond validée owner ;
//   2 jobs du workflow SANS `needs:` entre eux, statut GitHub rendu séparément) :
//     jambe PG = preflight pg → dump ;
//     jambe S3 = preflight s3 → copy-docs → recon → rollout → smoke.
//   Aucune dépendance de données PG→S3 côté geo (pas de restore préprod) ; seul un
//   futur orchestrateur e2e les couplera.
//
//   Sous-commandes :
//     preflight   S0  — binaires runner (kubectl/node[/curl]) + params. Argument
//                       optionnel de JAMBE : `preflight pg` | `preflight s3` ne
//                       vérifie que les paramètres de cette jambe ; sans argument =
//                       les deux (comportement historique). Jambe inconnue → échec.
//     dump        S1  — DÉCLENCHEUR T1 : patch CronJob prod geo-db-backup-prod
//                       suspend=false (kubeconfig PROD dédié DUMP_KUBECONFIG), Job
//                       freshness (poll interne, verdict), re-suspend.
//     copy-docs   S3  — Job geo-api aws-sdk CopyObject server-side ADDITIF
//                       (normalized/ prod → préprod), identité ÉPHÉMÈRE k8s.
//     recon       S3b — Job list-objects-v2 diff Key+Size (verdict-only, dest ⊇ src).
//     rollout     S5' — kubectl rollout restart deploy/geo-api (préprod) + status,
//                       SEULEMENT si recon vert (GARDE G4 : sentinel + re-run).
//     smoke       S7  — API publique : préprod landing 200 + ids /collections
//                       préprod ⊇ ids /collections prod (0 cred, runner).
//
//   GARDES fail-closed (celles qui s'appliquent à geo) :
//     G3  CONFIRM explicite (iso-prod-AAAA-MM-JJ, recoupé au jour UTC = anti-rejeu)
//         — sans quoi aucune étape mutante ne s'exécute.
//     G4  le rollout (qui fait SERVIR la couche copiée) ne part QUE si recon est vert.
//     +   EXPECTED_DATABASE : contrôle POSITIF hors runner — le CronJob refuse de
//         dumper si current_database() != EXPECTED_DATABASE, et la clé du dump frais
//         (Job freshness) ⊇ EXPECTED_DATABASE (clé geo-postgres/prod/sets/<ts>/<db>.dump).
//     G1/G2 : N-A (pas de restore DB préprod geo).
//
//   Piloté par .github/workflows/bascule-preprod.yml. AUCUNE exécution au build.
//
//   MODE (input) : chain (défaut, les deux jambes ci-dessus) | restore (restaurer
//   la préprod DEPUIS un backup quotidien de geo-backup, job `restore`) | list
//   (lecture seule). restore/list = restore-mode.mjs (même contrat kubectl-only).
// =============================================================================
import { spawnSync } from "node:child_process";
import console from "node:console";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { basculeMode, makeRestoreMode } from "./restore-mode.mjs";

// ── petits utilitaires de sortie (jamais de secret imprimé) ─────────────────
const log = (msg) => console.log(`[bascule] ${msg}`);
const warn = (msg) => console.log(`::warning title=bascule::${msg}`);
const die = (msg) => {
  console.log(`::error title=bascule failed::${msg}`);
  process.exit(1);
};
const section = (title) => log(`──────── ${title} ────────`);

// ── accès env : req = obligatoire (fail-closed), opt = défaut ───────────────
const req = (name) => {
  const v = process.env[name];
  if (v === undefined || v === "") die(`variable d'environnement requise absente : ${name}`);
  return v;
};
const opt = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};

// ── exécution d'un outil natif. On NE journalise JAMAIS l'env (secrets). ─────
function run(cmd, args, { env = {}, capture = false, allowFail = false, input } = {}) {
  const printable = `${cmd} ${args.map((a) => (a.startsWith("s3://") || /^[A-Za-z0-9._/=:@-]+$/.test(a) ? a : `'${a}'`)).join(" ")}`;
  log(`$ ${printable}`);
  const res = spawnSync(cmd, args, {
    env: { ...process.env, ...env },
    encoding: "utf8",
    input,
    stdio: capture ? ["pipe", "pipe", "pipe"] : ["inherit", "inherit", "inherit"],
    maxBuffer: 1024 * 1024 * 64,
  });
  if (res.error) {
    if (allowFail) return { status: 1, stdout: "", stderr: String(res.error) };
    die(`échec de lancement de ${cmd} : ${res.error.message}`);
  }
  if (!allowFail && res.status !== 0) {
    if (capture && res.stderr) console.log(res.stderr);
    die(`${cmd} a retourné un code non nul (${res.status})`);
  }
  return { status: res.status ?? 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

// ── GARDE G3 : CONFIRM explicite = GO owner matérialisé ─────────────────────
function assertConfirm() {
  const confirm = opt("CONFIRM", "");
  if (!/^iso-prod-\d{4}-\d{2}-\d{2}$/.test(confirm)) {
    die(
      "GARDE G3 — CONFIRM absent ou mal formé. Attendu un input workflow_dispatch " +
        "de la forme 'iso-prod-AAAA-MM-JJ' (GO owner). Rien n'a été exécuté.",
    );
  }
  const expected = opt("CONFIRM_EXPECTED", "");
  if (expected && confirm !== expected) {
    die(
      `GARDE G3 — CONFIRM='${confirm}' ne correspond pas à la valeur attendue du jour ` +
        `('${expected}'). Anti-rejeu : rien n'a été exécuté.`,
    );
  }
  log(`GARDE G3 OK — CONFIRM='${confirm}'`);
}

// ── Normalisation d'endpoint object-store — fonction PURE (identique immo) ──
// aws-cli ET aws-sdk EXIGENT un schéma sur --endpoint-url : un host nu (BHS)
// fait errorer aws-cli (faux « vide »). On préfixe https:// si absent (idempotent).
export function withScheme(endpoint) {
  const e = String(endpoint || "").trim();
  if (!e) return e;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(e) ? e : `https://${e}`;
}

// ── Défauts partagés des Jobs data-plane (images + secrets in-cluster) ──────
// Le runner ne touche JAMAIS à ces creds NI à S3 : il ne rend que des NOMS de
// secret + des images/params NON secrets. Overridables par env.
function jobDefaults() {
  return {
    NAMESPACE: opt("PREPROD_NAMESPACE", "geo-preprod"),
    // amazon/aws-cli au MÊME pin que la recette immo (arbitrage i-cond : pas s5cmd).
    AWSCLI_IMAGE: opt(
      "BASCULE_AWSCLI_IMAGE",
      "amazon/aws-cli:2.34.53@sha256:cf53765c0de54ad3a8ea21818f1c4c845a8cf7ca87831c078a00fef244031493",
    ),
    // Secrets PERSISTANTS des Jobs de CHECK (verdict-only, LIST) — distincts de
    // l'identité docs-sync ÉPHÉMÈRE (sinon CreateContainerConfigError après son GC).
    // Mêmes clés S3_ACCESS_KEY/S3_SECRET_KEY (iso immo) :
    //  - freshness (S1) : RO-reader du bucket backups (minté par k8s) ;
    //  - recon (S3b)    : LIST sentropic-geo + sentropic-geo-preprod (minté par k8s).
    FRESHNESS_CHECK_SECRET: opt("FRESHNESS_CHECK_SECRET", "geo-backups-reader-preprod"),
    CHECK_DOCS_SECRET: opt("CHECK_DOCS_SECRET", "geo-normalized-reader-preprod"),
    // Identité ÉPHÉMÈRE du copy-docs (lecture prod + rw préprod), créée par k8s au GO
    // (watch du nom de Job, ownerRef=Job.UID, GC en cascade au TTL). La CI ne crée /
    // lit / supprime AUCUN secret.
    DOCS_SYNC_READ_SECRET: opt("DOCS_SYNC_READ_SECRET", "geo-normalized-src-preprod"),
    // Grantee canonical id OVH de l'identité serving PRÉPROD (GrantFullControl sur les
    // objets copiés → lisibles par geo-api préprod). Vide → pas de grant (WARN in-Job).
    DOCS_SYNC_GRANTEE: opt("DOCS_SYNC_GRANTEE", ""),
    S3_ENDPOINT: withScheme(req("BHS")),
    S3_REGION: opt("S3_REGION", ""),
    TTL_SECONDS: opt("JOB_TTL_SECONDS", "3600"),
  };
}

// ── répertoire de travail (sentinels) — persiste dans un run de job ─────────
function workdir() {
  const dir = opt("BASCULE_WORKDIR", join(process.cwd(), ".bascule-work"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

// =============================================================================
// classifyJobStatus — fonction PURE (identique immo) : SEULE information que le
// runner lit d'un Job (JAMAIS `kubectl logs`). backoffLimit 0 → 1 pod.
// =============================================================================
export function classifyJobStatus(status) {
  const s = status || {};
  const succeeded = Number(s.succeeded ?? 0);
  const failed = Number(s.failed ?? 0);
  const active = Number(s.active ?? 0);
  if (Number.isFinite(succeeded) && succeeded >= 1) return { done: true, ok: true, state: "succeeded" };
  if (Number.isFinite(failed) && failed >= 1) return { done: true, ok: false, state: "failed" };
  return { done: false, ok: false, state: active > 0 ? "active" : "pending" };
}

// =============================================================================
// recon DIFF (dest ⊇ src) — fonctions PURES (identiques immo), miroir du awk
// in-pod du Job recon. Key+Size, ETag IGNORÉ (CopyObject peut re-chunker).
// =============================================================================
export function parseListingMeta(text) {
  const m = new Map();
  for (const raw of (text || "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    const cols = line.split("\t");
    if (cols[0] === "" || cols[0] === undefined) continue;
    m.set(cols[0], cols[1] ?? ""); // Size SEULEMENT (ETag ignoré)
  }
  return m;
}

export function reconMissing(srcText, dstText) {
  const dst = parseListingMeta(dstText);
  const missing = [];
  for (const [key, size] of parseListingMeta(srcText)) {
    if (!dst.has(key) || dst.get(key) !== size) missing.push(key);
  }
  return missing;
}

// =============================================================================
// smoke THROUGH l'API — fonctions PURES (geo) : équivalent geo du /health immo.
// Le runner lit l'API OGC PUBLIQUE (0 cred, données publiques) : les ids servis
// en PROD doivent tous être servis en PRÉPROD (préprod ⊇ prod ; la préprod porte
// en plus ses familles preprod-native, tolérées).
// =============================================================================
export function collectionIds(body) {
  const arr = Array.isArray(body?.collections) ? body.collections : [];
  return arr.map((c) => c?.id).filter((x) => typeof x === "string" && x !== "");
}

export function servedIdsMissing(prodIds, preprodIds) {
  const have = new Set(preprodIds || []);
  return [...new Set(prodIds || [])].filter((id) => !have.has(id));
}

// =============================================================================
// dispatchS3Check — Job de CHECK S3 verdict-only (s3-check-job). Identique immo.
// `secret` = NOM du secret PERSISTANT, fixé par pas (jamais l'identité éphémère).
// failClosed=false → renvoie { ok } (S1 doit re-suspendre AVANT de trancher).
// =============================================================================
function dispatchS3Check({ mode, jobName, secret, accessKeyName = "S3_ACCESS_KEY", secretKeyName = "S3_SECRET_KEY", params = {}, timeoutSec, failClosed = true }) {
  const jd = jobDefaults();
  return runJobFromTemplate({
    tmpl: "s3-check-job.tmpl.yaml",
    jobName,
    failClosed,
    timeoutSec,
    vars: {
      JOB_NAME: jobName,
      NAMESPACE: jd.NAMESPACE,
      AWSCLI_IMAGE: jd.AWSCLI_IMAGE,
      CHECK_SECRET: secret,
      CHECK_ACCESS_KEY: accessKeyName,
      CHECK_SECRET_KEY: secretKeyName,
      S3_ENDPOINT: jd.S3_ENDPOINT,
      S3_REGION: jd.S3_REGION,
      CHECK_MODE: mode,
      CHECK_BUCKET: params.bucket || "",
      CHECK_PREFIX: params.prefix || "",
      CHECK_SRC_BUCKET: params.srcBucket || "",
      CHECK_DST_BUCKET: params.dstBucket || "",
      CHECK_T1_EPOCH: String(params.t1Epoch ?? "0"),
      CHECK_EXPECTED_DATABASE: params.expectedDb || "",
      CHECK_KEY_SUFFIX: params.keySuffix || ".dump",
      CHECK_TIMEOUT_SEC: String(params.checkTimeoutSec ?? "0"),
      CHECK_POLL_SEC: String(params.pollSec ?? "15"),
      TTL_SECONDS: jd.TTL_SECONDS,
    },
  });
}

// =============================================================================
// preflightRequirements — fonction PURE : binaires + params exigés par JAMBE.
// Les jambes PG et S3 tournent en PARALLÈLE dans 2 jobs distincts : chacune ne
// vérifie que SES paramètres (un job PG ne doit pas échouer faute d'URL API, un job
// S3 faute de DUMP_BUCKET). Sans jambe = les DEUX = liste historique, inchangée.
// Jambe inconnue → null (l'appelant échoue, fail-closed : jamais de preflight vide).
//   pg : dump (S1) — EXPECTED_DATABASE (clé ⊇ DB), BHS (endpoint du Job freshness),
//        DUMP_BUCKET. 0 curl (pas de smoke dans cette jambe).
//   s3 : copy-docs/recon/rollout (BHS, PROD_DOCS, PREPROD_DOCS) + smoke (URLs API, curl).
// =============================================================================
const PREFLIGHT_ALL = Object.freeze({
  bins: ["node", "kubectl", "curl"],
  params: ["EXPECTED_DATABASE", "BHS", "PROD_DOCS", "PREPROD_DOCS", "DUMP_BUCKET", "PREPROD_API_URL", "PROD_API_URL"],
});
const PREFLIGHT_LEGS = Object.freeze({
  pg: Object.freeze({ bins: ["node", "kubectl"], params: ["EXPECTED_DATABASE", "BHS", "DUMP_BUCKET"] }),
  s3: Object.freeze({ bins: ["node", "kubectl", "curl"], params: ["BHS", "PROD_DOCS", "PREPROD_DOCS", "PREPROD_API_URL", "PROD_API_URL"] }),
});

export function preflightRequirements(leg) {
  const pick = leg === undefined || leg === null || leg === "" ? PREFLIGHT_ALL : Object.hasOwn(PREFLIGHT_LEGS, leg) ? PREFLIGHT_LEGS[leg] : null;
  if (!pick) return null;
  return { bins: [...pick.bins], params: [...pick.params] };
}

// =============================================================================
// S0 — preflight [pg|s3] : binaires + params (0 cred S3/DB runner)
// =============================================================================
function cmdPreflight(args = []) {
  const leg = args[0];
  const reqs = preflightRequirements(leg);
  if (!reqs) die(`S0 preflight — jambe inconnue '${leg}' : attendu 'pg', 's3' ou aucune (= les deux). Rien n'a été vérifié.`);
  const label = leg ? `jambe ${leg}` : "jambes pg + s3";
  section(`S0 preflight (${label})`);
  const bins = reqs.bins;
  const missing = bins.filter((b) => run("bash", ["-lc", `command -v ${b}`], { capture: true, allowFail: true }).status !== 0);
  if (missing.length) die(`binaires manquants sur le runner : ${missing.join(", ")}`);
  log(`binaires présents (runner kubectl-only${bins.includes("curl") ? " + curl smoke" : ""}) : ${bins.join(", ")}`);

  // Params indispensables (présence seule — NON secrets). AUCUNE cred S3/DB runner.
  // EXPECTED_DATABASE = nom LITTÉRAL de la DB prod geo (fourni par k8s : il n'existe que
  // dans le secret geo-postgis-credentials) — var de dépôt BASCULE_EXPECTED_DATABASE.
  const required = reqs.params;
  const absent = required.filter((k) => !process.env[k]);
  if (absent.length) die(`paramètres CI absents : ${absent.join(", ")}`);
  log(`paramètres présents : ${required.length} clés (0 cred S3/DB runner)`);
  // Contrôle POSITIF EXPECTED_DATABASE — hors runner, fail-closed in-cluster : (a) Job
  // freshness — clé du dump frais ⊇ EXPECTED_DATABASE ; (c) CronJob dump — refuse si
  // current_database() != EXPECTED_DATABASE. (b immo — header archive au restore : N-A.)
  if (required.includes("EXPECTED_DATABASE")) {
    log(`EXPECTED_DATABASE='${process.env.EXPECTED_DATABASE}' — contrôle positif assuré in-cluster (CronJob + Job freshness).`);
  }
  log(`S0 preflight OK (${label})`);
}

// =============================================================================
// S1 — DÉCLENCHEUR DU DUMP (T1). Identique immo. 0 pg_dump runner, 0 S3 runner.
// Patch du CronJob PROD geo-db-backup-prod (ns geo) via le kubeconfig PROD dédié
// (SA geo-ci-trigger-prod name-scopée + VAP suspend-only), Job freshness PRÉPROD
// (poll interne), RE-SUSPEND toujours, puis verdict fail-closed.
// =============================================================================
function cmdDump() {
  section("S1 dump prod — DÉCLENCHEUR T1 (patch CronJob + Job freshness, 0 pg_dump/0 S3 runner)");
  assertConfirm(); // G3
  const expected = req("EXPECTED_DATABASE");
  const bucket = req("DUMP_BUCKET"); // radar-immobilier-backups-preprod
  const prefix = opt("DUMP_PREFIX", "geo-postgres/prod/sets").replace(/^\/+|\/+$/g, "");
  const cjNs = opt("DUMP_CRONJOB_NAMESPACE", "geo");
  const cj = opt("DUMP_CRONJOB", "geo-db-backup-prod");
  // Convention de clé (iso immo) : geo-postgres/prod/sets/<ISO-ts>/<EXPECTED_DATABASE>.dump
  const assertDbInKey = opt("DUMP_KEY_ASSERT_DB", "1") !== "0";
  const keyMustContain = assertDbInKey ? expected : "";
  const keySuffix = opt("DUMP_KEY_SUFFIX", ".dump");
  const skewSec = Number(opt("FRESHNESS_SKEW_SEC", "120"));
  const checkTimeoutSec = Number(opt("DUMP_TIMEOUT", "1800"));
  const pollSec = Number(opt("DUMP_POLL_INTERVAL", "20"));
  const dir = workdir();

  const dumpKubeconfig = opt("DUMP_KUBECONFIG", "");
  if (!dumpKubeconfig || !existsSync(dumpKubeconfig)) {
    die(
      "S1 — DUMP_KUBECONFIG (kubeconfig PROD dédié au patch du CronJob dump) absent ou introuvable : " +
        `le déclencheur patche '${cj}' dans le cluster PROD (ns ${cjNs}) — le kubeconfig préprod par défaut ferait 403. ` +
        "Fail-closed : aucun patch tenté.",
    );
  }
  const kprod = ["--kubeconfig", dumpKubeconfig];

  const t1Ms = Date.now();
  const t1Epoch = Math.floor((t1Ms - skewSec * 1000) / 1000);
  writeFileSync(join(dir, "T1.txt"), `${new Date(t1Ms).toISOString()}\n`, { mode: 0o600 });
  writeFileSync(join(dir, "T1_EPOCH.txt"), `${t1Epoch}\n`, { mode: 0o600 });
  log(`T1=${new Date(t1Ms).toISOString()} (fraîcheur exigée : LastModified epoch > ${t1Epoch}, skew ${skewSec}s)`);

  section("S1.a déclencheur — kubectl (PROD) patch cronjob suspend=false");
  run("kubectl", [...kprod, "-n", cjNs, "patch", "cronjob", cj, "--type=merge", "-p", '{"spec":{"suspend":false}}']);
  log(`CronJob ${cjNs}/${cj} dé-suspendu (cluster PROD) — le pg_dump prod → s3://${bucket} démarre hors runner.`);

  section("S1.b freshness — Job in-cluster (aws s3api list, verdict-only, 0 S3 runner)");
  const verdict = dispatchS3Check({
    mode: "freshness",
    jobName: "geo-bascule-freshness",
    secret: jobDefaults().FRESHNESS_CHECK_SECRET, // geo-backups-reader-preprod (RO-reader persistant)
    failClosed: false,
    params: {
      bucket, prefix, t1Epoch, expectedDb: keyMustContain, keySuffix,
      checkTimeoutSec, pollSec,
    },
    timeoutSec: checkTimeoutSec + Number(opt("CHECK_POLL_BUFFER", "180")),
  });

  // Re-suspend TOUJOURS (best-effort, même si freshness KO ; kubeconfig PROD).
  const resus = run("kubectl", [...kprod, "-n", cjNs, "patch", "cronjob", cj, "--type=merge", "-p", '{"spec":{"suspend":true}}'], { allowFail: true });
  if ((resus.status ?? 0) !== 0) warn(`S1 — re-suspend du CronJob ${cjNs}/${cj} a ÉCHOUÉ : à re-suspendre à la main (kubectl patch ... suspend=true).`);
  else log(`CronJob ${cjNs}/${cj} re-suspendu.`);

  if (!verdict.ok) {
    die(
      `S1 — Job freshness '${verdict.jobName || "geo-bascule-freshness"}' ${verdict.state || "KO"} : aucun dump FRAIS ` +
        `(exigé : LastModified > T1${keyMustContain ? `, clé ⊇ '${keyMustContain}'` : ""}, suffixe '${keySuffix}', taille>0) ` +
        `sous s3://${bucket}/${prefix || ""} dans le délai. Fail-closed — inspecter le Job in-cluster (0 logs runner).`,
    );
  }
  log("S1 dump OK — Job freshness a confirmé un dump frais (verdict .status). 0 pg_dump runner, 0 S3/contenu runner.");
}

// =============================================================================
// Rendu + apply + poll STATUS-ONLY d'un Job in-cluster (identique immo)
// =============================================================================
function resolvePreprodImage(ns) {
  const override = opt("IMAGE", "");
  if (override) return override;
  // Iso-prod : image geo-api EXACTE servie en préprod (embarque @aws-sdk/client-s3).
  const deploy = opt("SERVING_DEPLOY", "geo-api");
  const r = run("kubectl", ["-n", ns, "get", "deploy", deploy, "-o", "jsonpath={.spec.template.spec.containers[0].image}"], { capture: true });
  const img = r.stdout.trim();
  if (!img) die(`image ${deploy} préprod introuvable (fournir IMAGE en repli).`);
  return img;
}

function renderTemplate(tmplPath, vars) {
  let text = readFileSync(tmplPath, "utf8");
  for (const [k, v] of Object.entries(vars)) {
    text = text.split(`\${${k}}`).join(v);
  }
  const leftover = text.match(/\$\{[A-Z0-9_]+\}/g);
  if (leftover) die(`placeholders non résolus dans ${tmplPath} : ${[...new Set(leftover)].join(", ")}`);
  return text;
}

// PII-free / STATUS-ONLY : le runner lit UNIQUEMENT `.status` du Job (via
// classifyJobStatus) — JAMAIS `kubectl logs`. Sur échec/timeout : « inspecter
// in-cluster ». failClosed=false → renvoie { ok, state, jobName } sans die.
function runJobFromTemplate({ tmpl, jobName, vars, timeoutSec, failClosed = true }) {
  const ns = vars.NAMESPACE;
  const dir = workdir();
  const rendered = join(dir, `${jobName}.rendered.yaml`);
  writeFileSync(rendered, renderTemplate(join(import.meta.dirname, tmpl), vars), { mode: 0o600 });
  run("kubectl", ["-n", ns, "delete", "job", jobName, "--ignore-not-found"], { allowFail: true });
  run("kubectl", ["-n", ns, "apply", "-f", rendered]);
  // uid de CETTE instance du Job : son verdict n'est lu que sur SES pods (un pod de
  // l'instance précédente supprimée peut encore être listé sous le même job-name).
  const uidRes = run("kubectl", ["-n", ns, "get", "job", jobName, "-o", "jsonpath={.metadata.uid}"], { capture: true, allowFail: true });
  const uid = uidRes.status === 0 && /^[0-9a-f-]{36}$/.test((uidRes.stdout || "").trim()) ? uidRes.stdout.trim() : null;
  if (!uid) warn(`Job ${jobName} — uid illisible : son message de fin ne sera pas lu.`);
  const inspect = `inspecter in-cluster : kubectl -n ${ns} logs job/${jobName} --all-containers`;
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const st = run("kubectl", ["-n", ns, "get", "job", jobName, "-o", "jsonpath={.status}"], { capture: true, allowFail: true });
    let status = {};
    try { status = st.stdout && st.stdout.trim() ? JSON.parse(st.stdout) : {}; } catch { status = {}; }
    const v = classifyJobStatus(status);
    if (v.done && v.ok) { log(`Job ${jobName} terminé OK (.status=succeeded)`); return { ok: true, state: "succeeded", jobName, uid }; }
    if (v.done && !v.ok) {
      const msg = `Job ${jobName} en ÉCHEC (.status=failed) — étape avortée (fail-closed). ${inspect} (0 logs runner).`;
      if (!failClosed) { warn(msg); return { ok: false, state: "failed", jobName, uid }; }
      die(msg);
    }
    if (Date.now() >= deadline) {
      const msg = `Job ${jobName} non terminé dans ${timeoutSec}s — étape avortée. ${inspect} (0 logs runner).`;
      if (!failClosed) { warn(msg); return { ok: false, state: "timeout", jobName, uid }; }
      die(msg);
    }
    spawnSync("bash", ["-lc", "sleep 10"], { stdio: "ignore" });
  }
}

// =============================================================================
// S3/S4 — copie des objets servis `normalized/` : Job PRÉPROD (image geo-api
// servie en préprod, aws-sdk CopyObject SERVER-SIDE, ADDITIF, idempotent) avec
// l'identité ÉPHÉMÈRE geo-normalized-src-preprod (créée par k8s ownerRef=Job.UID,
// GC au TTL). Clone du docs-sync immo. DRY (DRY=1) : copie NON jouée.
// =============================================================================
function cmdCopyDocs() {
  const dry = opt("DRY", "") === "1" || process.argv.includes("--dry");
  const prod = req("PROD_DOCS");
  const preprod = req("PREPROD_DOCS");
  const prefix = opt("DOCS_SYNC_PREFIX", "normalized/");
  if (dry) {
    log(`S3 DRY — copie s3://${prod}/${prefix} → s3://${preprod}/${prefix} NON jouée (0 S3 runner ; dispatchée en exécution). Signal DRY = Job recon informatif.`);
    return;
  }
  section("S3 copie normalized/ — Job in-cluster (geo-api aws-sdk CopyObject + grant, additif)");
  assertConfirm(); // G3
  const ns = opt("PREPROD_NAMESPACE", "geo-preprod");
  const jd = jobDefaults();
  const image = resolvePreprodImage(ns);
  runJobFromTemplate({
    tmpl: "docs-sync-job.tmpl.yaml",
    // NOM EXACT (validé k8s, comme docs-sync-prod-to-preprod côté immo) : k8s watch
    // ce nom, lit l'UID et crée l'identité éphémère ownerRef=UID.
    jobName: "geo-normalized-sync-prod-to-preprod",
    vars: {
      NAMESPACE: jd.NAMESPACE,
      IMAGE: image,
      DOCS_SYNC_READ_SECRET: jd.DOCS_SYNC_READ_SECRET,
      S3_ENDPOINT: jd.S3_ENDPOINT,
      S3_REGION: jd.S3_REGION,
      S3_FORCE_PATH_STYLE: opt("DOCS_S3_FORCE_PATH_STYLE", "true"),
      SRC_BUCKET: prod,
      DST_BUCKET: preprod,
      COPY_GRANTEE: jd.DOCS_SYNC_GRANTEE,
      COPY_PREFIX: prefix,
    },
    timeoutSec: Number(opt("COPYDOCS_TIMEOUT", "5400")),
  });
  log(`S3 copie OK — s3://${prod}/${prefix} → s3://${preprod}/${prefix} (CopyObject server-side, additif). 0 S3 runner.`);
}

// =============================================================================
// S3b — recon (dest ⊇ src) : Job PRÉPROD aws-cli (list-objects-v2 diff Key+Size).
// EXIT 0 si dest ⊇ src, 1 sinon. Sentinel LOCAL recon.ok.json (verdict) → G4.
// =============================================================================
function cmdRecon() {
  section("S3b recon (dest ⊇ src) — Job in-cluster (list-objects-v2 diff Key+Size, verdict-only)");
  const prod = req("PROD_DOCS");
  const preprod = req("PREPROD_DOCS");
  const prefix = opt("DOCS_SYNC_PREFIX", "normalized/");
  dispatchS3Check({
    mode: "recon",
    jobName: "geo-bascule-recon",
    // Secret PERSISTANT geo-normalized-reader-preprod (LIST prod+préprod) — PAS
    // l'identité éphémère docs-sync. Overridable via CHECK_DOCS_SECRET.
    secret: jobDefaults().CHECK_DOCS_SECRET,
    params: { srcBucket: prod, dstBucket: preprod, prefix },
    timeoutSec: Number(opt("RECON_TIMEOUT", "900")),
  });
  const dir = workdir();
  const sentinel = { ok: true, prod, preprod, prefix, at: new Date().toISOString() };
  writeFileSync(join(dir, "recon.ok.json"), `${JSON.stringify(sentinel)}\n`, { mode: 0o600 });
  log("S3b recon OK — dest ⊇ src (verdict .status). Sentinel recon.ok écrit (0 listing runner).");
}

// GARDE G4 (identique immo) : sentinel local vérifié, puis recon REJOUÉE en direct.
function assertReconOk() {
  // MODE=restore : G4 = recon de la préprod contre docs-inventory(D) du backup.
  if (currentMode() === "restore") { restoreMode.assertReconOk(); return; }
  const dir = workdir();
  const path = join(dir, "recon.ok.json");
  if (!existsSync(path)) die("GARDE G4 — sentinel recon.ok absent : lancer recon (S3b) et l'obtenir VERT avant le rollout.");
  let s;
  try { s = JSON.parse(readFileSync(path, "utf8")); } catch { die("GARDE G4 — sentinel recon.ok illisible."); }
  const prod = req("PROD_DOCS");
  const preprod = req("PREPROD_DOCS");
  const prefix = opt("DOCS_SYNC_PREFIX", "normalized/");
  if (!s.ok || s.prod !== prod || s.preprod !== preprod || s.prefix !== prefix) {
    die("GARDE G4 — sentinel recon.ok ne correspond pas aux buckets/préfixe courants : recon à rejouer.");
  }
  cmdRecon();
  log("GARDE G4 OK — recon confirmé vert (Job) immédiatement avant le rollout.");
}

// =============================================================================
// S5' — rollout (équivalent geo du flip S5 immo) : geo-api cache son index au
// démarrage (StoreProvider) → la couche copiée n'est SERVIE qu'après un restart.
// Mutant → G3 ; ne part que si recon vert → G4.
// =============================================================================
function cmdRollout() {
  section("S5' rollout restart geo-api préprod (G4 recon)");
  assertConfirm(); // G3
  assertReconOk(); // G4
  const ns = opt("PREPROD_NAMESPACE", "geo-preprod");
  const deploy = opt("SERVING_DEPLOY", "geo-api");
  const timeout = opt("ROLLOUT_TIMEOUT", "600");
  run("kubectl", ["-n", ns, "rollout", "restart", `deployment/${deploy}`]);
  run("kubectl", ["-n", ns, "rollout", "status", `deployment/${deploy}`, `--timeout=${timeout}s`]);
  log(`S5' rollout OK — deployment/${deploy} redémarré et prêt (index rechargé).`);
}

// =============================================================================
// S7 — smoke THROUGH l'API publique (runner, 0 cred) : préprod landing 200 +
// ids /collections préprod ⊇ ids /collections prod.
// =============================================================================
function fetchJson(url) {
  const r = run("curl", ["-fsS", "--max-time", opt("SMOKE_HTTP_TIMEOUT", "60"), "-H", "Accept: application/json", url], { capture: true, allowFail: true });
  if (r.status !== 0) die(`smoke KO — ${url} injoignable (curl rc=${r.status}).`);
  try { return JSON.parse(r.stdout); } catch { die(`smoke KO — réponse non JSON : ${url}`); }
  return undefined;
}

function cmdSmoke() {
  section("S7 smoke — verify THROUGH l'API publique (préprod ⊇ prod)");
  const pre = req("PREPROD_API_URL").replace(/\/+$/, "");
  const prod = req("PROD_API_URL").replace(/\/+$/, "");
  const landing = fetchJson(`${pre}/`);
  log(`landing préprod → title=${landing?.title ?? "?"} coherence_id=${landing?.coherence_id ?? "<absent>"}`);
  const preIds = collectionIds(fetchJson(`${pre}/collections`));
  const prodIds = collectionIds(fetchJson(`${prod}/collections`));
  if (prodIds.length === 0) die("smoke KO — /collections prod vide ou illisible (contrôle impossible).");
  const missing = servedIdsMissing(prodIds, preIds);
  log(`/collections : prod=${prodIds.length} préprod=${preIds.length} manquants-en-préprod=${missing.length}`);
  // MODE=restore : la préprod sert l'état d'un jour D passé — des collections créées
  // en prod après D peuvent légitimement manquer : contrôle CONSULTATIF (warning).
  if (missing.length && currentMode() === "restore") {
    if (preIds.length === 0) die("smoke KO — /collections préprod vide après restauration.");
    warn(`smoke (MODE=restore) — ${missing.length} collection(s) prod absente(s) en préprod (postérieures au backup ?) : consultatif.`);
    log("S7 smoke OK (MODE=restore) — landing 200 + /collections préprod non vide.");
    return;
  }
  if (missing.length) die(`smoke KO — ${missing.length} collection(s) servie(s) en prod absente(s) en préprod (ex. ${missing.slice(0, 10).join(", ")}).`);
  log("S7 smoke OK — préprod sert ⊇ prod (through l'API).");
}

// =============================================================================
// MODE=restore|list (restore-mode.mjs) — helpers injectés, aucun import circulaire.
// =============================================================================
function currentMode() {
  try { return basculeMode(process.env); } catch (e) { return die(e.message); }
}
const restoreMode = makeRestoreMode({ log, warn, die, section, req, opt, run, assertConfirm, runJobFromTemplate, jobDefaults, workdir, resolvePreprodImage });

// =============================================================================
// dispatch
// =============================================================================
const COMMANDS = {
  ...restoreMode.commands,
  preflight: cmdPreflight,
  dump: cmdDump,
  "copy-docs": cmdCopyDocs,
  recon: cmdRecon,
  rollout: cmdRollout,
  smoke: cmdSmoke,
};

function main() {
  const cmd = process.argv[2];
  const isHelp = !cmd || cmd === "-h" || cmd === "--help";
  if (isHelp || !COMMANDS[cmd]) {
    console.log(
      "usage: node bascule.mjs <preflight [pg|s3]|dump|copy-docs|recon|rollout|smoke>\n" +
        "  RUNNER KUBECTL-ONLY : 0 cred S3, 0 pg_dump, 0 listing/clé sur le runner ; .status seul (0 kubectl logs).\n" +
        "  2 jambes PARALLÈLES : PG = preflight pg → dump ; S3 = preflight s3 → copy-docs → recon → rollout → smoke.\n" +
        "  preflight (S0) : sans argument = les deux jambes ; 'pg' | 's3' = params de cette jambe seule.\n" +
        "  dump (S1) : DÉCLENCHEUR — patch CronJob prod geo-db-backup-prod suspend=false (kubeconfig PROD),\n" +
        "    Job freshness (poll interne, verdict), re-suspend. Dump réel = CronJob (ns geo).\n" +
        "  copy-docs (S3) : Job geo-api CopyObject server-side additif normalized/ prod → préprod ; DRY=1 → non jouée.\n" +
        "  recon (S3b) : Job verdict-only list-objects-v2 diff Key+Size (dest ⊇ src).\n" +
        "  rollout (S5') : rollout restart geo-api préprod, SEULEMENT si recon vert (G4).\n" +
        "  smoke (S7) : API publique — préprod ⊇ prod sur /collections (0 cred).\n" +
        "  GARDES : G3 CONFIRM, G4 recon-avant-rollout, contrôle POSITIF DB in-cluster (CronJob).\n" +
        "  MODE=restore|list (restore-mode.mjs) : preflight-backup | backup-secret-fill | backup-resolve |\n" +
        "    backup-list | docs-restore [--dry] | recon-backup — restauration DEPUIS geo-backup (BACKUP_ID).",
    );
    process.exit(isHelp ? 0 : 1);
  }
  COMMANDS[cmd](process.argv.slice(3));
}

const invokedDirectly = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedDirectly) main();
