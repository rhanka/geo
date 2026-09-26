// =============================================================================
// restore-pg.mjs — côté runner de la RESTAURATION PostgreSQL de la bascule geo
// MODE=restore (S2 + G1), dans le postgis PRÉPROD (ns geo-preprod) : décision owner
// 2026-09-26 — la bascule préprod geo restaure AUSSI la base, comme immo.
//
// Même contrat que restore-mode.mjs : runner KUBECTL-ONLY (0 cred S3/DB). Tout
// l'accès base et S3 vit dans des Jobs `role=pra-restore` ; le runner lit le
// `.status` du Job et le message de fin de SES pods (uid), jamais `kubectl logs`.
//
//   pg-apply     postgis-preprod.yaml (StatefulSet `postgis`, Service `geo-postgis`,
//                NetworkPolicies) : kubectl apply puis rollout status.
//   pg-check     AVANT S2 : pg_isready puis SELECT 1 authentifié avec le Secret ;
//                échec ⇒ message clair, rien de destructif, pas de pg_restore.
//   pg-snapshot  G1 : copie de la base préprod (CREATE DATABASE … TEMPLATE) ; G2 =
//                aucune autre session sur la base.
//   pg-restore   S2 : fetch du dump pg/<D>/<db>.dump (sha256 = manifeste = sidecar
//                = PIN) puis pg_restore --clean --if-exists --single-transaction
//                (TOC == manifeste, dbname == EXPECTED_DATABASE).
//   pg-rollback  (manuel, G3) : base recréée depuis le snapshot G1.
//   S2c migrate  N/A : geo n'a ni migration ni ORM ni DDL applicatif (la base est
//                lue telle quelle par postgis-provider.ts) — vérifié dans le dépôt.
//
// JAMAIS de chemin vers la prod : namespace préprod imposé (le ns prod `geo` est
// refusé), Service désigné par un nom court (résolu dans le namespace du Job, jamais
// `geo-postgis.geo`), netpol pra-restore-egress limitée à geo-postgis du même ns.
// =============================================================================
import console from "node:console";
import process from "node:process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const K8S_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DB_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;
// Namespaces de PRODUCTION geo : jamais une cible de la restauration PG.
export const PROD_NAMESPACES = Object.freeze(["geo"]);
export const PG_JOBS = Object.freeze({
  check: "geo-bascule-pg-check",
  snapshot: "geo-db-snapshot-bascule",
  restore: "geo-db-restore-backup",
  rollback: "geo-db-rollback-bascule",
});
export const PG_DEFAULTS = Object.freeze({
  service: "geo-postgis",
  secret: "geo-postgis-credentials",
  statefulset: "postgis",
  image: "postgis/postgis:16-3.4",
  manifest: "postgis-preprod.yaml",
});
// Secret superuser préprod pré-créé vide par k8s, réécrit par la bascule depuis
// l'environment geo-bascule : clé k8s ← secret GitHub.
export const POSTGIS_SECRET_KEYS = Object.freeze({
  POSTGRES_DB: "GEO_POSTGIS_PREPROD_DB",
  POSTGRES_USER: "GEO_POSTGIS_PREPROD_USER",
  POSTGRES_PASSWORD: "GEO_POSTGIS_PREPROD_PASSWORD",
});
// Mot de passe : une ligne, ASCII imprimable sans espace, 16 à 128 caractères.
export const RE_PG_PASSWORD = /^[!-~]{16,128}$/;

// Paramètres de la restauration PG, validés (jamais rendus bruts dans un Job).
export function pgParams(env, { namespace, db }) {
  const get = (k, d) => (String(env[k] ?? "").trim() || d);
  const p = {
    namespace: String(namespace ?? ""),
    db: String(db ?? ""),
    service: get("PG_SERVICE", PG_DEFAULTS.service),
    secret: get("PG_SECRET", PG_DEFAULTS.secret),
    statefulset: get("PG_STATEFULSET", PG_DEFAULTS.statefulset),
    image: get("PG_IMAGE", PG_DEFAULTS.image),
    snapshotDb: get("PG_SNAPSHOT_DB", `${String(db ?? "")}_pra_rollback`),
    readyTimeout: get("PG_READY_TIMEOUT", "60"),
  };
  const bad = [];
  if (!K8S_NAME_RE.test(p.namespace)) bad.push("PREPROD_NAMESPACE invalide");
  if (PROD_NAMESPACES.includes(p.namespace)) bad.push(`namespace ${p.namespace} = PRODUCTION : restauration PG refusée`);
  // Nom court uniquement : résolu dans le namespace préprod du Job (un FQDN
  // `geo-postgis.geo…` viserait la prod).
  if (!K8S_NAME_RE.test(p.service)) bad.push("PG_SERVICE doit être un nom de Service court (sans point)");
  for (const [k, v] of [["PG_SECRET", p.secret], ["PG_STATEFULSET", p.statefulset]]) if (!K8S_NAME_RE.test(v)) bad.push(`${k} invalide`);
  if (!/^postgis\/postgis:[0-9][0-9a-z.-]*(@sha256:[0-9a-f]{64})?$/.test(p.image)) bad.push("PG_IMAGE doit être une image postgis/postgis épinglée");
  if (!DB_NAME_RE.test(p.db)) bad.push("EXPECTED_DATABASE invalide");
  if (!DB_NAME_RE.test(p.snapshotDb) || p.snapshotDb === p.db) bad.push("PG_SNAPSHOT_DB invalide (nom de base distinct de EXPECTED_DATABASE)");
  if (!/^[0-9]{1,3}$/.test(p.readyTimeout) || Number(p.readyTimeout) < 1) bad.push("PG_READY_TIMEOUT invalide");
  if (bad.length) throw new Error(bad.join(" ; "));
  return p;
}

// Valeurs du Secret geo-postgis-credentials (gardes dans l'esprit de #405) ; l'erreur
// nomme la variable, jamais la valeur. POSTGRES_DB doit valoir EXPECTED_DATABASE
// (la base restaurée porte le nom de l'archive).
export function postgisSecretValues(env, expectedDb) {
  const bad = [];
  const one = (name, re) => {
    const v = String(env[name] ?? "");
    if (!v) { bad.push(`${name}(absent)`); return null; }
    if (/[\r\n]/.test(v)) { bad.push(`${name}(multi-ligne)`); return null; }
    if (!re.test(v)) { bad.push(`${name}(format)`); return null; }
    return v;
  };
  const db = one(POSTGIS_SECRET_KEYS.POSTGRES_DB, DB_NAME_RE);
  const user = one(POSTGIS_SECRET_KEYS.POSTGRES_USER, DB_NAME_RE);
  const password = one(POSTGIS_SECRET_KEYS.POSTGRES_PASSWORD, RE_PG_PASSWORD);
  if (db && expectedDb && db !== expectedDb) bad.push(`${POSTGIS_SECRET_KEYS.POSTGRES_DB}(différent de EXPECTED_DATABASE)`);
  if (bad.length) throw new Error(`secrets GitHub manquants ou invalides (environment geo-bascule) :${bad.map((b) => ` ${b}`).join("")} — rien n'a été écrit`);
  return { POSTGRES_DB: db, POSTGRES_USER: user, POSTGRES_PASSWORD: password };
}

// Vérifie que le manifeste postgis ne vise que le namespace préprod attendu.
export function assertManifestNamespace(text, namespace) {
  const nss = [...String(text).matchAll(/^\s+namespace:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const kinds = [...String(text).matchAll(/^kind:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  if (!kinds.length || nss.length !== kinds.length || nss.some((n) => n !== namespace)) {
    throw new Error(`le manifeste postgis doit déclarer namespace ${namespace} pour chacune de ses ${kinds.length} ressource(s)`);
  }
  if (PROD_NAMESPACES.includes(namespace)) throw new Error(`namespace ${namespace} = PRODUCTION : refus`);
  return kinds;
}

// Résumé d'échec APRÈS une restauration PG réussie (étape suivante en échec) : la
// base préprod est au jour D ; rollback G1 possible.
export function buildPgFailureSummary({ date, snapshotDb, db }) {
  return [
    `### Bascule geo — échec APRÈS la restauration PG`,
    "",
    `La base préprod \`${db}\` est restaurée au jour D = ${date || "inconnu"} ; une étape suivante a échoué (docs, recon, rollout ou smoke).`,
    `Rollback G1 (base recréée depuis le snapshot \`${snapshotDb}\` pris juste avant) :`,
    "",
    "```bash",
    'MODE=restore CONFIRM="iso-prod-$(date -u +%F)" CONFIRM_EXPECTED="iso-prod-$(date -u +%F)" node deploy/ci/bascule-preprod/bascule.mjs pg-rollback',
    "```",
    "",
  ].join("\n");
}

// Helpers injectés par restore-mode.mjs (dispatch avec le script embarqué, lecture
// du verdict par uid, PIN, paramètres communs) et bascule.mjs.
export function makeRestorePg(h) {
  const { log, die, section, opt, run, assertConfirm, runJobFromTemplate, workdir, dispatchWithScript, readVerdict, failWithVerdict,
    loadPin, params, mode } = h;

  function pg() {
    const p = params();
    let q;
    try { q = pgParams(process.env, { namespace: p.jd.NAMESPACE, db: p.db }); } catch (e) { return die(e.message); }
    return { p, q };
  }
  const base = (p, q, jobName) => ({ JOB_NAME: jobName, NAMESPACE: p.jd.NAMESPACE, PG_IMAGE: q.image, PG_SERVICE: q.service, PG_SECRET: q.secret,
    EXPECTED_DATABASE: p.db, TTL_SECONDS: p.jd.TTL_SECONDS });
  function simpleJob({ tmpl, jobName, vars, timeoutSec }) {
    for (const [k, v] of Object.entries(vars)) if (/["\\\r\n]/.test(String(v))) die(`valeur de template dangereuse : ${k}`);
    return runJobFromTemplate({ tmpl, jobName, vars, timeoutSec, failClosed: false });
  }
  const need = () => { if (mode() !== "restore") die("la restauration PG exige MODE=restore."); };

  // ── pg-apply : postgis préprod (StatefulSet + Service + netpols) ────────────
  function cmdPgApply() {
    section("S2.0 postgis préprod — apply (StatefulSet, Service, NetworkPolicies) + rollout");
    need();
    assertConfirm(); // G3 avant toute mutation
    const { p, q } = pg();
    const file = join(import.meta.dirname, PG_DEFAULTS.manifest);
    let kinds;
    try { kinds = assertManifestNamespace(readFileSync(file, "utf8"), p.jd.NAMESPACE); } catch (e) { die(e.message); }
    const r = run("kubectl", ["-n", p.jd.NAMESPACE, "apply", "-f", file], { allowFail: true });
    if (r.status !== 0) die(`kubectl apply de ${PG_DEFAULTS.manifest} en échec (RBAC geo-ci-bascule-preprod : statefulsets/services/networkpolicies par nom — README).`);
    const ro = run("kubectl", ["-n", p.jd.NAMESPACE, "rollout", "status", `statefulset/${q.statefulset}`, `--timeout=${Number(opt("PG_ROLLOUT_TIMEOUT", "300"))}s`], { allowFail: true });
    if (ro.status !== 0) die(`statefulset/${q.statefulset} pas prêt dans le délai (rollout status) — rien de destructif n'a été fait.`);
    log(`S2.0 OK — ${kinds.join(", ")} appliqués dans ${p.jd.NAMESPACE}, statefulset/${q.statefulset} prêt.`);
  }

  // ── pg-check : pg_isready + SELECT 1 authentifié, AVANT S2 ──────────────────
  function cmdPgCheck() {
    section("S2.1 pg-check — pg_isready + SELECT 1 (identifiants du Secret), AVANT toute action destructive");
    need();
    assertConfirm();
    const { p, q } = pg();
    const res = simpleJob({ tmpl: "pg-check-job.tmpl.yaml", jobName: PG_JOBS.check,
      vars: { ...base(p, q, PG_JOBS.check), PG_READY_TIMEOUT: q.readyTimeout }, timeoutSec: Number(opt("PG_CHECK_TIMEOUT", "300")) });
    if (!res.ok) failWithVerdict(res, p.jd.NAMESPACE, PG_JOBS.check, "check", "S2.1 pg-check refusé — aucune action destructive, pas de pg_restore");
    const { verdict } = readVerdict(p.jd.NAMESPACE, PG_JOBS.check, "check", res.uid);
    if (!verdict || verdict.ok !== true) die("S2.1 pg-check — Job OK mais verdict absent ou négatif : restauration refusée.");
    log(`S2.1 OK — postgis ${q.service} prêt, session authentifiée, base ${verdict.database}.`);
  }

  // ── pg-snapshot : G1 ────────────────────────────────────────────────────────
  function cmdPgSnapshot() {
    section("G1 snapshot de la base préprod (CREATE DATABASE … TEMPLATE) — G2 : aucune autre session");
    need();
    assertConfirm();
    const { p, q } = pg();
    const res = simpleJob({ tmpl: "pg-snapshot-job.tmpl.yaml", jobName: PG_JOBS.snapshot,
      vars: { ...base(p, q, PG_JOBS.snapshot), PG_SNAPSHOT_DB: q.snapshotDb }, timeoutSec: Number(opt("PG_SNAPSHOT_TIMEOUT", "600")) });
    if (!res.ok) failWithVerdict(res, p.jd.NAMESPACE, PG_JOBS.snapshot, "snapshot", "GARDE G1 — snapshot refusé : pas de restauration sans snapshot");
    const { verdict } = readVerdict(p.jd.NAMESPACE, PG_JOBS.snapshot, "snapshot", res.uid);
    if (!verdict || verdict.ok !== true) die("GARDE G1 — Job OK mais verdict absent ou négatif : pas de restauration sans snapshot.");
    log(`GARDE G1 OK — ${p.db} copiée dans ${q.snapshotDb} (${verdict.sizeBytes ?? "?"} octets).`);
  }

  // ── pg-restore : S2 ─────────────────────────────────────────────────────────
  function cmdPgRestore() {
    section("S2 restauration PG DEPUIS le backup (fetch sha256 = PIN, pg_restore --single-transaction)");
    need();
    assertConfirm();
    const pin = loadPin();
    const { p, q } = pg();
    const res = dispatchWithScript({
      tmpl: "db-restore-backup-job.tmpl.yaml", jobName: PG_JOBS.restore,
      vars: {
        ...base(p, q, PG_JOBS.restore), IMAGE: h.resolvePreprodImage(p.jd.NAMESPACE), READER_SECRET: p.readerSecret,
        S3_ENDPOINT: p.jd.S3_ENDPOINT, PINNED_S3_ENDPOINT: h.PINNED_S3_ENDPOINT, S3_REGION: p.jd.S3_REGION, S3_FORCE_PATH_STYLE: p.forcePathStyle,
        EXPECTED_BACKUP_BUCKET: p.bucket, BACKUP_DATE: pin.date, PIN_MANIFEST_SHA256: pin.manifestSha256, PIN_PG_SHA256: pin.pgSha256,
      },
      timeoutSec: Number(opt("PG_RESTORE_TIMEOUT", "1800")),
    });
    if (!res.ok) {
      const f = readVerdict(p.jd.NAMESPACE, PG_JOBS.restore, "fetch", res.uid).verdict;
      const container = f && f.ok === true ? "restore" : "fetch";
      failWithVerdict(res, p.jd.NAMESPACE, PG_JOBS.restore, container, `S2 restauration PG en échec (${container})`);
    }
    const { verdict } = readVerdict(p.jd.NAMESPACE, PG_JOBS.restore, "restore", res.uid);
    if (!verdict || verdict.ok !== true) die("S2 — Job OK mais verdict de restauration absent ou négatif.");
    log(`S2 OK — backup ${pin.date} restauré dans le postgis préprod (sha256 ${pin.pgSha256} vérifié in-cluster, TOC ${verdict.tocEntries}, snapshot G1 ${q.snapshotDb}).`);
  }

  // ── pg-rollback : manuel, G3 ────────────────────────────────────────────────
  function cmdPgRollback() {
    section("ROLLBACK G1 — base préprod recréée depuis le snapshot");
    need();
    assertConfirm();
    const { p, q } = pg();
    const res = simpleJob({ tmpl: "pg-rollback-job.tmpl.yaml", jobName: PG_JOBS.rollback,
      vars: { ...base(p, q, PG_JOBS.rollback), PG_SNAPSHOT_DB: q.snapshotDb }, timeoutSec: Number(opt("PG_SNAPSHOT_TIMEOUT", "600")) });
    if (!res.ok) failWithVerdict(res, p.jd.NAMESPACE, PG_JOBS.rollback, "rollback", "rollback G1 refusé");
    log(`ROLLBACK OK — ${p.db} recréée depuis ${q.snapshotDb} (snapshot conservé).`);
  }

  function cmdPgFailureSummary() {
    const { p, q } = pg();
    let date = null;
    const f = join(workdir(), "backup-pin.json");
    if (existsSync(f)) { try { date = JSON.parse(readFileSync(f, "utf8")).date || null; } catch { date = null; } }
    const md = buildPgFailureSummary({ date: /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : null, snapshotDb: q.snapshotDb, db: p.db });
    console.log(`::error title=bascule geo — échec après la restauration PG::base préprod au jour ${date || "?"}, rollback G1 possible (pg-rollback)`);
    console.log(md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }

  return {
    commands: {
      "pg-apply": cmdPgApply,
      "pg-check": cmdPgCheck,
      "pg-snapshot": cmdPgSnapshot,
      "pg-restore": cmdPgRestore,
      "pg-rollback": cmdPgRollback,
      "pg-failure-summary": cmdPgFailureSummary,
    },
  };
}
