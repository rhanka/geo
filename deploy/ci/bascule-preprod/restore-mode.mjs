// =============================================================================
// restore-mode.mjs — côté runner de la bascule geo MODE=restore|list : restaurer
// la préprod geo DEPUIS un backup quotidien de geo-backup au lieu de la copie
// vivante prod→préprod. Port de rhanka/radar-immobilier#777, mêmes gardes.
//
// Même contrat que bascule.mjs : runner KUBECTL-ONLY (0 cred S3, 0 listing). Toute
// lecture du backup et la copie serveur vivent dans des Jobs préprod
// (backup-restore.cjs embarqué). Le runner lit le `.status` du Job et, pour les
// détails qu'il doit reporter (date D résolue, sha256, liste des backups), le
// MESSAGE DE FIN du pod (JSON ≤ 4 Kio de dates/statuts/tailles/sha256/comptes).
// Jamais `kubectl logs`.
//
//   MODE=chain   (défaut) jambes pg + s3 inchangées (dump vivant + copie normalized/).
//   MODE=restore job `restore` : preflight-backup → backup-secret-fill → backup-resolve
//                (gardes, AVANT toute mutation ; dump geo vérifié par sha256, pas
//                restauré : préprod SANS PostgreSQL) → docs-restore (état de
//                normalized/ au jour D) → recon-backup → rollout (G4 = recon-backup)
//                → smoke (préprod ⊇ prod consultatif : un état passé peut précéder
//                des collections récentes).
//   MODE=list    job `list` : lecture seule, backups disponibles.
//
// Sous-commandes (enregistrées dans COMMANDS de bascule.mjs) : preflight-backup,
// backup-secret-fill, backup-resolve, backup-list, docs-restore, recon-backup.
// =============================================================================
import { Buffer } from "node:buffer";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

export const MODES = Object.freeze(["chain", "restore", "list"]);
export const CYCLE_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const K8S_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const STATUS_RE = /^[a-z0-9._-]{1,32}$/i;
// Gardes de geo #405 (bascule-bundle-cd.yml « Write backup Secrets from GitHub »).
export const RE_ACCESS_KEY = /^[A-Za-z0-9]{16,128}$/;
export const RE_SECRET_KEY = /^[A-Za-z0-9/+=]{16,128}$/;
export const PINNED_S3_ENDPOINT = "https://s3.bhs.io.cloud.ovh.net";
// Secrets pré-créés (lecteur + signataire S3') : clés EXACTES (k8s).
export const BACKUP_SECRET_KEYS = Object.freeze(["BACKUP_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"]);
export const READER_SECRET_KEYS = BACKUP_SECRET_KEYS;

export const JOBS = Object.freeze({
  resolve: "geo-bascule-backup-resolve",
  list: "geo-bascule-backup-list",
  docs: "geo-docs-restore-backup",
  recon: "geo-bascule-recon-backup",
});
export const PIN_FILE = "backup-pin.json";
export const LIST_FILE = "backup-list.json";

// ── fonctions pures (exportées pour le selftest) ─────────────────────────────
export function isValidDate(date) {
  if (typeof date !== "string" || !DATE_RE.test(date)) return false;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}
export function basculeMode(env = process.env) {
  const m = String(env.MODE ?? "").trim() || "chain";
  if (!MODES.includes(m)) throw new Error(`MODE doit valoir ${MODES.join("|")}`);
  return m;
}
export function validateBackupIdInput(raw, today) {
  const id = String(raw ?? "").trim();
  if (id === "" || id === "latest") return "latest";
  if (!isValidDate(id)) throw new Error("BACKUP_ID doit valoir 'latest' ou une date AAAA-MM-JJ valide");
  if (today && id > today) throw new Error(`BACKUP_ID ${id} est dans le futur`);
  return id;
}
export function validateCycleId(raw) {
  const id = String(raw ?? "").trim();
  if (id === "") return "";
  if (!CYCLE_ID_RE.test(id)) throw new Error(`CYCLE_ID doit respecter ${CYCLE_ID_RE}`);
  return id;
}
export function indentBlock(text, n) {
  const pad = " ".repeat(n);
  return String(text).replace(/\r/g, "").split("\n").map((l) => (l.length ? pad + l : l)).join("\n");
}
export function assertYamlSafeVars(vars, skip = ["BR_SCRIPT"]) {
  const bad = Object.entries(vars).filter(([k, v]) => !skip.includes(k) && /["\\\r\n]/.test(String(v)));
  if (bad.length) throw new Error(`valeur(s) de template dangereuse(s) : ${bad.map(([k]) => k).join(", ")}`);
  return true;
}
export function assertScriptEmbeddable(script) {
  const hit = String(script).match(/\$\{[A-Z0-9_]+\}/);
  if (hit) throw new Error(`backup-restore.cjs contient un motif de placeholder (${hit[0]})`);
  return true;
}
// Un pod appartient à l'instance `jobUid` du Job (celle créée par ce run) quand son
// ownerReference contrôleur ou son label controller-uid porte cet uid. Un pod d'une
// instance précédente du même nom (supprimée, pods encore en fin de vie) n'est
// jamais lu.
export function podOfJob(pod, jobUid) {
  if (!jobUid) return false;
  const owners = Array.isArray(pod?.metadata?.ownerReferences) ? pod.metadata.ownerReferences : [];
  if (owners.some((o) => o?.kind === "Job" && o?.uid === jobUid)) return true;
  const labels = pod?.metadata?.labels ?? {};
  return labels["batch.kubernetes.io/controller-uid"] === jobUid || labels["controller-uid"] === jobUid;
}
// Message de fin de `container` dans le pod le plus récent de l'instance `jobUid`
// (init containers compris). Pas d'uid ⇒ null (jamais de repli sur un autre pod).
export function pickTerminationMessage(podList, container, jobUid) {
  const items = (Array.isArray(podList?.items) ? [...podList.items] : []).filter((p) => podOfJob(p, jobUid));
  items.sort((a, b) => String(b?.metadata?.creationTimestamp ?? "").localeCompare(String(a?.metadata?.creationTimestamp ?? "")));
  for (const pod of items) {
    const statuses = [...(pod?.status?.initContainerStatuses ?? []), ...(pod?.status?.containerStatuses ?? [])];
    const s = statuses.find((c) => c?.name === container);
    const msg = s?.state?.terminated?.message ?? s?.lastState?.terminated?.message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return null;
}
// Bucket prod de geo, figé (défaut de BASCULE_PROD_DOCS_BUCKET) : TOUJOURS une
// destination interdite de la copie S3', quelles que soient les variables.
export const FROZEN_PROD_DOCS_BUCKETS = Object.freeze(["sentropic-geo"]);
// FORBIDDEN_DST_BUCKETS rendu dans les Jobs docs : bucket prod figé + PROD_DOCS
// (exigé en MODE=restore) + bucket de backup. Jamais vide ; nom invalide refusé.
export function forbiddenDstBuckets({ prodDocs, backupBucket }) {
  const prod = String(prodDocs ?? "").trim();
  if (!prod) throw new Error("PROD_DOCS (BASCULE_PROD_DOCS_BUCKET) est exigé en MODE=restore : c'est une destination interdite de la copie");
  const names = [...FROZEN_PROD_DOCS_BUCKETS, prod, String(backupBucket ?? "").trim()].filter(Boolean);
  if (names.some((n) => !BUCKET_RE.test(n))) throw new Error("nom de bucket invalide dans les destinations interdites");
  return [...new Set(names)].join(",");
}
export function parseTermination(msg) {
  if (typeof msg !== "string" || !msg.trim()) return null;
  try { const v = JSON.parse(msg); return v && typeof v === "object" ? v : null; } catch { return null; }
}
export function safeReason(reason) {
  return String(reason ?? "aucune raison enregistrée").replace(/[\r\n]+/g, " ").replace(/::/g, ": :").replace(/[^\x20-\x7EÀ-ſ]/g, "?").slice(0, 400);
}
const isoOrNull = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const numOrNull = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);

export function validatePin(p) {
  const errs = [];
  if (!p || p.ok !== true) errs.push("verdict resolve non ok");
  if (!p || !isValidDate(p.date)) errs.push("date invalide");
  if (!p || !SHA_RE.test(String(p.manifestSha256 ?? ""))) errs.push("manifestSha256 invalide");
  if (!p || !SHA_RE.test(String(p.pgSha256 ?? ""))) errs.push("pgSha256 invalide");
  if (!p || !(Number(p.pgSizeBytes) > 0)) errs.push("pgSizeBytes invalide");
  if (p && p.backupId !== "latest" && !isValidDate(p.backupId)) errs.push("backupId invalide");
  if (errs.length) throw new Error(`PIN de backup refusé : ${errs.join(" ; ")}`);
  return {
    backupId: p.backupId, date: p.date, manifestSha256: p.manifestSha256, pgSha256: p.pgSha256, pgSizeBytes: Number(p.pgSizeBytes),
    dumpShaRecomputed: p.dumpShaRecomputed === true, docsObjects: numOrNull(p.docsObjects), dumpStartedAt: isoOrNull(p.dumpStartedAt),
    ageHours: numOrNull(p.ageHours), stale: p.stale === true, staleOverridden: p.staleOverridden === true,
  };
}

// Liste des backups (contrat radar-backup-list/v1 de l'orchestrateur e2e).
export function validateListing(l) {
  if (!l || l.ok !== true || !Array.isArray(l.backups)) throw new Error("verdict de liste non ok");
  return {
    format: "radar-backup-list/v1",
    tenant: "geo",
    bucket: BUCKET_RE.test(String(l.bucket ?? "")) ? l.bucket : null,
    latest: isValidDate(l.latest) ? l.latest : null,
    latestComplete: isValidDate(l.latestComplete) ? l.latestComplete : null,
    count: numOrNull(l.count),
    truncated: l.truncated === true,
    backups: l.backups.filter((b) => b && isValidDate(b.date)).map((b) => ({
      date: b.date,
      status: STATUS_RE.test(String(b.status ?? "")) ? b.status : "invalid",
      pgBytes: numOrNull(b.pgBytes),
      pgSha256: /^[0-9a-f]{8,64}$/.test(String(b.pgSha256 ?? "")) ? b.pgSha256 : null,
      docs: numOrNull(b.docs),
      startedAt: isoOrNull(b.startedAt),
    })),
  };
}
export function formatBackupTable(listing) {
  const mb = (b) => (b === null ? "-" : `${(b / 1e6).toFixed(1)} MB`);
  const rows = listing.backups.map((b) => [b.date + (b.date === listing.latestComplete ? " *" : ""), b.status, mb(b.pgBytes), b.pgSha256 ?? "-", b.docs === null ? "-" : String(b.docs)]);
  const head = ["date", "statut", "dump pg", "sha256 pg (16)", "objets"];
  return {
    text: [head, ...rows].map((r) => r.join(" | ")).join("\n"),
    md: [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n"),
  };
}

// Secrets pré-créés que la bascule réécrit depuis l'environment geo-bascule :
// spec → secrets GitHub (préfixe) + variable de nom + nom par défaut + MODE où il sert.
export const BACKUP_SECRET_SPECS = Object.freeze({
  reader: Object.freeze({ ghPrefix: "GEO_BACKUP_READER_PREPROD", nameEnv: "BACKUP_READER_SECRET", defaultName: "geo-backup-reader-preprod", modes: Object.freeze(["list", "restore"]) }),
  "restore-docs": Object.freeze({ ghPrefix: "GEO_BACKUP_RESTORE_DOCS", nameEnv: "BACKUP_DOCS_COPY_SECRET", defaultName: "geo-backup-restore-docs", modes: Object.freeze(["restore"]) }),
});
export function specsForMode(mode) {
  return Object.entries(BACKUP_SECRET_SPECS).filter(([, s]) => s.modes.includes(mode)).map(([id]) => id);
}

// Valeurs d'un Secret (gardes #405) ; l'erreur nomme la variable, jamais la valeur.
export function backupSecretValues(env, spec = "reader") {
  const s = BACKUP_SECRET_SPECS[spec];
  if (!s) throw new Error(`spec de Secret inconnue : ${spec}`);
  const bad = [];
  const one = (name, re) => {
    const v = String(env[name] ?? "");
    if (!v) { bad.push(`${name}(absent)`); return null; }
    if (/[\r\n]/.test(v)) { bad.push(`${name}(multi-ligne)`); return null; }
    if (!re.test(v)) { bad.push(`${name}(format ${re})`); return null; }
    return v;
  };
  const ak = one(`${s.ghPrefix}_ACCESS_KEY`, RE_ACCESS_KEY);
  const sk = one(`${s.ghPrefix}_SECRET_KEY`, RE_SECRET_KEY);
  const bucket = String(env.BACKUP_BUCKET ?? "").trim() || "geo-backup";
  if (!BUCKET_RE.test(bucket)) bad.push("BACKUP_BUCKET(format)");
  const endpoint = String(env.S3_ENDPOINT_RENDERED ?? "");
  if (endpoint !== PINNED_S3_ENDPOINT) bad.push(`BHS(doit être ${PINNED_S3_ENDPOINT})`);
  if (bad.length) throw new Error(`secrets/variables GitHub manquants ou invalides (environment geo-bascule) :${bad.map((b) => ` ${b}`).join("")} — rien n'a été écrit`);
  return { S3_ACCESS_KEY: ak, S3_SECRET_KEY: sk, BACKUP_BUCKET: bucket };
}
export const readerSecretValues = (env) => backupSecretValues(env, "reader");
export function buildSecretManifest({ name, namespace, values, labels = {} }) {
  if (!K8S_NAME_RE.test(String(name)) || !K8S_NAME_RE.test(String(namespace))) throw new Error("nom de Secret ou namespace invalide");
  return {
    apiVersion: "v1", kind: "Secret", metadata: { name, namespace, ...(Object.keys(labels).length ? { labels } : {}) }, type: "Opaque",
    data: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Buffer.from(String(v), "utf8").toString("base64")])),
  };
}
// Noms des clés renvoyées par le serveur (jamais une valeur).
export function keysOfReplaced(stdout) {
  try { return Object.keys(JSON.parse(stdout || "{}").data || {}).sort().join(" "); } catch { return "<illisible>"; }
}

// ── côté runner (helpers injectés par bascule.mjs : aucun import circulaire) ──
export function makeRestoreMode(h) {
  const { log, warn, die, section, req, opt, run, assertConfirm, runJobFromTemplate, jobDefaults, workdir, resolvePreprodImage } = h;
  const today = () => new Date().toISOString().slice(0, 10);
  const mode = () => { try { return basculeMode(process.env); } catch (e) { return die(e.message); } };

  function params() {
    const jd = jobDefaults();
    const bucket = opt("BACKUP_BUCKET", "geo-backup");
    const readerSecret = opt("BACKUP_READER_SECRET", "geo-backup-reader-preprod");
    const copySecret = opt("BACKUP_DOCS_COPY_SECRET", "geo-backup-restore-docs");
    const db = opt("EXPECTED_DATABASE", "geo");
    const prefix = opt("DOCS_SYNC_PREFIX", "normalized/");
    if (!BUCKET_RE.test(bucket)) die("BACKUP_BUCKET invalide");
    for (const [k, v] of [["BACKUP_READER_SECRET", readerSecret], ["BACKUP_DOCS_COPY_SECRET", copySecret]]) if (!K8S_NAME_RE.test(v)) die(`${k} n'est pas un nom de Secret valide`);
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(db)) die("EXPECTED_DATABASE invalide");
    if (!/^[a-z0-9][a-z0-9._-]*\/$/.test(prefix)) die("DOCS_SYNC_PREFIX invalide");
    if (jd.S3_ENDPOINT !== PINNED_S3_ENDPOINT) die(`BHS doit désigner ${PINNED_S3_ENDPOINT} (endpoint figé, egress S3-BHS)`);
    return {
      jd, bucket, readerSecret, copySecret, db, prefix,
      forcePathStyle: opt("BACKUP_S3_FORCE_PATH_STYLE", "true") === "false" ? "false" : "true",
      maxAgeHours: String(Number(opt("BACKUP_MAX_AGE_HOURS", "24")) > 0 ? Number(opt("BACKUP_MAX_AGE_HOURS", "24")) : 24),
    };
  }

  let scriptCache = null;
  function brScript() {
    if (scriptCache) return scriptCache;
    const text = readFileSync(join(import.meta.dirname, "backup-restore.cjs"), "utf8");
    try { assertScriptEmbeddable(text); } catch (e) { die(e.message); }
    scriptCache = indentBlock(text, 14);
    return scriptCache;
  }
  function dispatch({ tmpl, jobName, vars, timeoutSec }) {
    try { assertYamlSafeVars(vars); } catch (e) { die(e.message); }
    return runJobFromTemplate({ tmpl, jobName, vars: { ...vars, BR_SCRIPT: brScript() }, timeoutSec, failClosed: false });
  }
  // Verdict lu UNIQUEMENT sur les pods de l'instance du Job créée par ce run (uid).
  function readVerdict(ns, jobName, container, jobUid) {
    if (!jobUid) return { verdict: null, readable: true };
    const r = run("kubectl", ["-n", ns, "get", "pods", "-l", `job-name=${jobName}`, "-o", "json"], { capture: true, allowFail: true });
    if (r.status !== 0) return { verdict: null, readable: false };
    let pods = null;
    try { pods = JSON.parse(r.stdout || "{}"); } catch { pods = null; }
    return { verdict: parseTermination(pickTerminationMessage(pods, container, jobUid)), readable: true };
  }
  function failWithVerdict(res, ns, jobName, container, what) {
    const { verdict, readable } = readVerdict(ns, jobName, container, res.uid);
    const reason = verdict && verdict.reason ? safeReason(verdict.reason)
      : verdict && verdict.ok === true ? `étape '${container}' OK — un conteneur suivant a échoué (inspecter in-cluster)`
        : readable ? "aucun verdict enregistré (inspecter le Job in-cluster)" : "pods illisibles par la CI (RBAC pods get/list)";
    die(`${what} — Job ${jobName} ${res.state} : ${reason}`);
  }
  function loadPin() {
    const p = join(workdir(), PIN_FILE);
    if (!existsSync(p)) die(`${PIN_FILE} absent — lancer 'backup-resolve' d'abord (le PIN fige la date et les sha256).`);
    try { return validatePin({ ok: true, ...JSON.parse(readFileSync(p, "utf8")) }); } catch (e) { return die(e.message); }
  }
  const output = (pairs) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, pairs.map(([k, v]) => `${k}=${v ?? ""}\n`).join("")); };
  const summary = (md) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`); };
  const readVars = (p, step, extra = {}) => ({
    NAMESPACE: p.jd.NAMESPACE, IMAGE: resolvePreprodImage(p.jd.NAMESPACE), BR_STEP: step, READER_SECRET: p.readerSecret,
    S3_ENDPOINT: p.jd.S3_ENDPOINT, PINNED_S3_ENDPOINT, S3_REGION: p.jd.S3_REGION, S3_FORCE_PATH_STYLE: p.forcePathStyle,
    EXPECTED_BACKUP_BUCKET: p.bucket, EXPECTED_DATABASE: p.db, TTL_SECONDS: p.jd.TTL_SECONDS, ...extra,
  });

  function cmdPreflightBackup() {
    const m = mode();
    section(`S0 preflight (MODE=${m})`);
    if (m === "chain") die("preflight-backup sert MODE=restore|list (MODE=chain : 'preflight').");
    assertConfirm(); // G3 dans TOUS les MODE (list compris), AVANT l'écriture des Secrets et R0
    const missing = ["node", "kubectl", "curl"].filter((b) => run("bash", ["-lc", `command -v ${b}`], { capture: true, allowFail: true }).status !== 0);
    if (missing.length) die(`binaires manquants sur le runner : ${missing.join(", ")}`);
    const required = m === "restore" ? ["BHS", "PREPROD_DOCS", "PROD_DOCS", "PREPROD_API_URL", "PROD_API_URL", "EXPECTED_DATABASE"] : ["BHS", "EXPECTED_DATABASE"];
    const absent = required.filter((k) => !process.env[k]);
    if (absent.length) die(`paramètres CI absents : ${absent.join(", ")}`);
    const p = params();
    let backupId = "n/a";
    try {
      if (m === "restore") backupId = validateBackupIdInput(opt("BACKUP_ID", "latest"), today());
      validateCycleId(opt("CYCLE_ID", ""));
    } catch (e) { die(e.message); }
    if (m === "restore") {
      let forbidden;
      try { forbidden = forbiddenDstBuckets({ prodDocs: req("PROD_DOCS"), backupBucket: p.bucket }); } catch (e) { die(e.message); }
      if (forbidden.split(",").includes(req("PREPROD_DOCS"))) die("PREPROD_DOCS est une destination interdite (bucket prod ou de backup) — restauration refusée.");
      log(`destinations interdites de la copie : ${forbidden}`);
    }
    log(`MODE=${m} bucket=${p.bucket} lecteur=${p.readerSecret} copie=${p.copySecret} prefixe=${p.prefix} backup_id=${backupId} (0 cred S3 runner)`);
    log("S0 preflight OK");
  }

  // Réécrit les Secrets pré-créés du MODE depuis l'environment geo-bascule (gardes #405) :
  // list → lecteur ; restore → lecteur + signataire S3' geo-backup-restore-docs. Tous les
  // contrôles et le dry-run serveur de CHAQUE Secret passent avant la première écriture
  // (pas d'écriture partielle).
  function cmdBackupSecretFill() {
    const m = mode();
    if (m === "chain") die("backup-secret-fill sert MODE=restore|list.");
    assertConfirm(); // G3 avant toute écriture de Secret
    const specs = specsForMode(m);
    section(`Write backup Secrets from GitHub (environment geo-bascule) : ${specs.join(", ")}`);
    const p = params();
    const ns = p.jd.NAMESPACE;
    const names = { reader: p.readerSecret, "restore-docs": p.copySecret };
    const values = {};
    for (const spec of specs) {
      try { values[spec] = backupSecretValues({ ...process.env, BACKUP_BUCKET: p.bucket, S3_ENDPOINT_RENDERED: p.jd.S3_ENDPOINT }, spec); } catch (e) { die(`${spec} — ${e.message}`); }
      const exists = run("kubectl", ["-n", ns, "get", "secret", names[spec], "-o", "name"], { capture: true, allowFail: true });
      if (exists.status !== 0) die(`Secret ${ns}/${names[spec]} absent ou illisible : pré-création par k8s + get/update par nom pour geo-ci-bascule-preprod. Rien n'a été écrit.`);
    }
    const dir = mkdtempSync(join(tmpdir(), "geo-backup-secrets-"));
    chmodSync(dir, 0o700);
    const want = BACKUP_SECRET_KEYS.join(" ");
    try {
      const files = {};
      for (const spec of specs) {
        files[spec] = join(dir, `${spec}.json`);
        writeFileSync(files[spec], JSON.stringify(buildSecretManifest({ name: names[spec], namespace: ns, values: values[spec],
          labels: { "app.kubernetes.io/part-of": "geo", "app.kubernetes.io/component": `backup-${spec}-preprod` } })), { mode: 0o600 });
      }
      for (const pass of [["--dry-run=server"], []]) {
        for (const spec of specs) {
          const r = run("kubectl", ["-n", ns, "replace", ...pass, "-f", files[spec], "-o", "json"], { capture: true, allowFail: true });
          const got = r.status === 0 ? keysOfReplaced(r.stdout) : "";
          if (r.status !== 0 || got !== want) {
            die(`${names[spec]} refusé${pass.length ? " par le dry-run serveur (rien n'a été écrit)" : ""} : clés '${got}' (attendu '${want}').`);
          }
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    for (const spec of specs) log(`secret/${names[spec]} réécrit depuis GitHub — clés : ${want} (valeurs jamais affichées)`);
  }

  function cmdBackupResolve() {
    section("R0 backup-resolve — Job lecture (BACKUP_ID → date D + gardes + PIN)");
    if (mode() !== "restore") die("backup-resolve exige MODE=restore.");
    assertConfirm(); // G3 avant le Job (lecture seule)
    const p = params();
    let backupId;
    try { backupId = validateBackupIdInput(opt("BACKUP_ID", "latest"), today()); } catch (e) { die(e.message); }
    const res = dispatch({
      tmpl: "backup-read-job.tmpl.yaml", jobName: JOBS.resolve,
      vars: readVars(p, "resolve", { JOB_NAME: JOBS.resolve, BACKUP_ID: backupId,
        ALLOW_STALE_BACKUP: opt("ALLOW_STALE_BACKUP", "false") === "true" ? "true" : "false", MAX_AGE_HOURS: p.maxAgeHours,
        VERIFY_DUMP_SHA256: opt("VERIFY_DUMP_SHA256", "true") === "false" ? "false" : "true" }),
      timeoutSec: Number(opt("BACKUP_RESOLVE_TIMEOUT", "2700")),
    });
    if (!res.ok) failWithVerdict(res, p.jd.NAMESPACE, JOBS.resolve, "read", "R0 backup refusé");
    const { verdict, readable } = readVerdict(p.jd.NAMESPACE, JOBS.resolve, "read", res.uid);
    if (!verdict) die(readable ? "R0 — Job OK mais aucun PIN (message de fin absent)." : "R0 — pods illisibles par la CI (RBAC pods get/list).");
    let pin;
    try { pin = validatePin(verdict); } catch (e) { die(e.message); }
    writeFileSync(join(workdir(), PIN_FILE), `${JSON.stringify(pin, null, 2)}\n`, { mode: 0o600 });
    if (pin.stale && backupId !== "latest") warn(`backup ${pin.date} vieux de ${pin.ageHours} h — BACKUP_ID explicite, âge non bloquant.`);
    if (pin.staleOverridden) warn(`dernier backup ${pin.date} vieux de ${pin.ageHours} h — accepté par ALLOW_STALE_BACKUP=true.`);
    log(`R0 OK — BACKUP_ID=${pin.backupId} → date=${pin.date} (complete) âge=${pin.ageHours} h dump=${pin.pgSizeBytes} octets sha256=${pin.pgSha256} ` +
      `recalculé=${pin.dumpShaRecomputed} manifeste=${pin.manifestSha256} objets=${pin.docsObjects}`);
    output([["backup_id", pin.backupId], ["backup_date", pin.date], ["manifest_sha256", pin.manifestSha256], ["pg_sha256", pin.pgSha256], ["dump_started_at", pin.dumpStartedAt]]);
    summary(`### Backup geo résolu\n\n| BACKUP_ID | date | âge (h) | sha256 dump (recalculé) | sha256 manifeste |\n|---|---|---|---|---|\n| ${pin.backupId} | ${pin.date} | ${pin.ageHours} | ${pin.pgSha256} (${pin.dumpShaRecomputed}) | ${pin.manifestSha256} |`);
  }

  function cmdBackupList() {
    section("backup-list — Job lecture (backups disponibles)");
    if (mode() !== "list") die("backup-list exige MODE=list.");
    assertConfirm(); // G3 avant le Job, list compris
    const p = params();
    const res = dispatch({
      tmpl: "backup-read-job.tmpl.yaml", jobName: JOBS.list,
      vars: readVars(p, "list", { JOB_NAME: JOBS.list, BACKUP_ID: "latest", ALLOW_STALE_BACKUP: "false", MAX_AGE_HOURS: p.maxAgeHours, VERIFY_DUMP_SHA256: "false" }),
      timeoutSec: Number(opt("BACKUP_LIST_TIMEOUT", "600")),
    });
    if (!res.ok) failWithVerdict(res, p.jd.NAMESPACE, JOBS.list, "read", "backup-list en échec");
    const { verdict, readable } = readVerdict(p.jd.NAMESPACE, JOBS.list, "read", res.uid);
    if (!verdict) die(readable ? "backup-list sans verdict." : "pods illisibles par la CI (RBAC pods get/list).");
    let listing;
    try { listing = validateListing(verdict); } catch (e) { die(e.message); }
    writeFileSync(join(workdir(), LIST_FILE), `${JSON.stringify(listing, null, 2)}\n`, { mode: 0o644 });
    const t = formatBackupTable(listing);
    log(`backups dans ${listing.bucket} : ${listing.count} (dernier=${listing.latest}, dernier complet=${listing.latestComplete} ; * = dernier complet)\n${t.text}`);
    summary(`### Backups geo disponibles — ${listing.bucket}\n\ndernier = ${listing.latest} · dernier complet (*) = ${listing.latestComplete}\n\n${t.md}`);
  }

  function docsJob({ step, dry }) {
    const pin = loadPin();
    const p = params();
    const jobName = step === "docs" ? JOBS.docs : JOBS.recon;
    let forbidden;
    try { forbidden = forbiddenDstBuckets({ prodDocs: req("PROD_DOCS"), backupBucket: p.bucket }); } catch (e) { die(e.message); }
    if (forbidden.split(",").includes(req("PREPROD_DOCS"))) die("PREPROD_DOCS est une destination interdite (bucket prod ou de backup).");
    const res = dispatch({
      tmpl: "docs-restore-backup-job.tmpl.yaml", jobName,
      vars: readVars(p, step, { JOB_NAME: jobName, COPY_SECRET: p.copySecret, BACKUP_DATE: pin.date, PIN_MANIFEST_SHA256: pin.manifestSha256,
        DST_BUCKET: req("PREPROD_DOCS"), FORBIDDEN_DST_BUCKETS: forbidden, DOCS_RESTORE_PREFIX: p.prefix, COPY_GRANTEE: opt("DOCS_SYNC_GRANTEE", ""),
        COPY_CONCURRENCY: String(Math.max(1, Math.min(32, Number(opt("BACKUP_COPY_CONCURRENCY", "8")) || 8))), DOCS_DRY: dry ? "1" : "0" }),
      timeoutSec: Number(opt(step === "docs" ? "DOCS_RESTORE_TIMEOUT" : "RECON_TIMEOUT", step === "docs" ? "11000" : "900")),
    });
    const { verdict } = readVerdict(p.jd.NAMESPACE, jobName, "docs", res.uid);
    return { res, verdict, pin, p, jobName };
  }
  const counts = (v) => (v ? Object.entries(v).filter(([k]) => !["ok", "step", "reason"].includes(k))
    .map(([k, x]) => `${k}=${typeof x === "object" ? JSON.stringify(x) : x}`).join(" ").slice(0, 600) : "aucun verdict lisible");

  function cmdDocsRestore() {
    const dry = opt("DRY", "") === "1" || process.argv.includes("--dry");
    section(`S3' docs-restore DEPUIS le backup (${dry ? "DRY : plan seul, 0 copie" : "copie serveur, additive"})`);
    if (mode() !== "restore") die("docs-restore exige MODE=restore.");
    if (!dry) assertConfirm(); // G3
    const { res, verdict, pin, p, jobName } = docsJob({ step: "docs", dry });
    if (!res.ok) failWithVerdict(res, p.jd.NAMESPACE, jobName, "docs", `S3' docs-restore ${dry ? "(plan) " : ""}en échec [${counts(verdict)}]`);
    log(`S3' ${dry ? "DRY " : ""}OK — état de ${p.prefix} au ${pin.date} ${dry ? "restaurable" : "restauré"} [${counts(verdict)}]`);
  }

  function cmdReconBackup() {
    section("S3b' recon-backup — préprod ⊇ docs-inventory(D) sur le préfixe servi (Key + Size)");
    if (mode() !== "restore") die("recon-backup exige MODE=restore.");
    const { res, verdict, pin, p, jobName } = docsJob({ step: "recon", dry: false });
    if (!res.ok) failWithVerdict(res, p.jd.NAMESPACE, jobName, "docs", `S3b' recon-backup en échec [${counts(verdict)}]`);
    writeFileSync(join(workdir(), "recon.ok.json"), `${JSON.stringify({ ok: true, mode: "restore", backupDate: pin.date, manifestSha256: pin.manifestSha256,
      preprod: req("PREPROD_DOCS"), prefix: p.prefix, at: new Date().toISOString() })}\n`, { mode: 0o600 });
    log(`S3b' OK — préprod ⊇ inventaire du ${pin.date} [${counts(verdict)}]. Sentinel recon.ok écrit.`);
  }

  // G4 du rollout en MODE=restore : sentinel de CE backup + recon rejouée.
  function assertReconOk() {
    const f = join(workdir(), "recon.ok.json");
    if (!existsSync(f)) die("GARDE G4 — sentinel recon.ok absent : lancer recon-backup (S3b') et l'obtenir VERT avant le rollout.");
    let s;
    try { s = JSON.parse(readFileSync(f, "utf8")); } catch { die("GARDE G4 — sentinel recon.ok illisible."); }
    const pin = loadPin();
    const p = params();
    if (!s.ok || s.mode !== "restore" || s.backupDate !== pin.date || s.manifestSha256 !== pin.manifestSha256 || s.preprod !== req("PREPROD_DOCS") || s.prefix !== p.prefix) {
      die("GARDE G4 — sentinel recon.ok ne correspond pas au backup/bucket courant : rejouer recon-backup.");
    }
    cmdReconBackup();
    log("GARDE G4 OK — recon vs inventaire(D) reconfirmée (Job) juste avant le rollout.");
  }

  return {
    assertReconOk,
    commands: {
      "preflight-backup": cmdPreflightBackup,
      "backup-secret-fill": cmdBackupSecretFill,
      "backup-resolve": cmdBackupResolve,
      "backup-list": cmdBackupList,
      "docs-restore": cmdDocsRestore,
      "recon-backup": cmdReconBackup,
    },
  };
}
