#!/usr/bin/env node
// =============================================================================
// premep-backup-gate.mjs — PRE-MEP BACKUP GATE of cd-prod (fail-closed).
//
// Port of the immo backup-before-release (radar-immobilier deploy/ci/run-db-backup.sh,
// called by build-push-images.yml before set-image): the release creates a backup
// Job, POLLS its .status and ABORTS on failure or timeout. geo differences:
//   - the Job is not rendered from a template: it is `kubectl create job
//     --from=cronjob/geo-backup-daily`, i.e. exactly the nightly backup (dump +
//     S3 upload + manifest + purge), same identities, same netpols;
//   - the runner holds NO S3 credential and never reads the bucket. The backup
//     verdict (`complete` vs `partial`, both exit 0) is read from the termination
//     message of the `backup` initContainer (backup-daily.cjs writes a one-line
//     JSON verdict to /dev/termination-log), through `pods get/list`. No pods/log;
//   - the created Job is NOT deleted on exit (it is a real, retained backup; its
//     ttlSecondsAfterFinished cleans it up) — the deployer has no `delete` verb.
//
// Steps, each fail-closed (exit 1 = MEP refused, exit 0 = MEP may proceed):
//   1. refuse inside the scheduled backup window (03:13–06:30 UTC, the same
//      window bascule-bundle-cd refuses for a manual run);
//   2. read CronJob geo-backup-daily → activeDeadlineSeconds (the poll bound);
//   3. no Job `geo-backup-*` may be active (concurrencyPolicy Forbid does not
//      cover a Job created with --from): wait for it, bounded by ACTIVE_WAIT_SECONDS,
//      else refuse;
//   4. seed check: the newest successful geo-backup-daily Job must not report
//      a non-complete verdict (a `partial` means the initial seed is not done);
//      no readable verdict (Job gone, older script) = unknown, step 6 decides;
//   5. create geo-backup-premep-<sha7>-<run_id>-<run_attempt>;
//   6. poll .status until Complete (→ verdict) / Failed / FailureTarget (refuse)
//      or activeDeadlineSeconds + DEADLINE_MARGIN_SECONDS (refuse); then the
//      created Job's verdict MUST be explicitly `complete` / OK (unknown = refuse).
//
// ENV (CLI): GIT_SHA (40 hex), RUN_ID, RUN_ATTEMPT (digits) — required.
//   Optional: NAMESPACE=geo, CRONJOB=geo-backup-daily, JOB_PREFIX=geo-backup-,
//   ACTIVE_WAIT_SECONDS=1800, DEADLINE_MARGIN_SECONDS=600, POLL_INTERVAL_SECONDS=15,
//   WINDOW_START_MIN=193, WINDOW_END_MIN=390 (minutes after 00:00 UTC).
// RBAC (deploy/k8s/prod/deployer-prod-rbac.yaml): batch/jobs get/list/watch/create,
//   batch/cronjobs get on geo-backup-daily, core pods get/list (already held).
// 0 dependency (node builtins), 0 python. Logs: names, conditions, verdicts only.
// =============================================================================
import process from 'node:process';
import console from 'node:console';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VERDICT_FORMAT = 'geo-backup-verdict/v1';
const DAILY_LABEL = 'geo-backup-daily';

export class GateRefused extends Error {
  constructor(title, message) {
    super(message);
    this.name = 'GateRefused';
    this.title = title;
  }
}

const int = (env, name, def, { min = 0 } = {}) => {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (!/^\d+$/.test(raw) || Number(raw) < min) throw new GateRefused('config', `${name} must be an integer >= ${min}`);
  return Number(raw);
};

export function readGateConfig(env) {
  const sha = env.GIT_SHA || '';
  const runId = env.RUN_ID || '';
  const attempt = env.RUN_ATTEMPT || '';
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new GateRefused('config', 'GIT_SHA must be a 40-hex commit sha');
  if (!/^\d{1,20}$/.test(runId)) throw new GateRefused('config', 'RUN_ID must be digits');
  if (!/^\d{1,4}$/.test(attempt)) throw new GateRefused('config', 'RUN_ATTEMPT must be digits');
  const namespace = env.NAMESPACE || 'geo';
  const cronJob = env.CRONJOB || 'geo-backup-daily';
  const jobPrefix = env.JOB_PREFIX || 'geo-backup-';
  const jobName = `${jobPrefix}premep-${sha.slice(0, 7)}-${runId}-${attempt}`;
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(jobName) || jobName.length > 63) throw new GateRefused('config', `invalid Job name ${jobName}`);
  const cfg = {
    namespace, cronJob, jobPrefix, jobName,
    activeWaitSeconds: int(env, 'ACTIVE_WAIT_SECONDS', 1800),
    deadlineMarginSeconds: int(env, 'DEADLINE_MARGIN_SECONDS', 600),
    pollIntervalSeconds: int(env, 'POLL_INTERVAL_SECONDS', 15, { min: 1 }),
    windowStartMin: int(env, 'WINDOW_START_MIN', 193),
    windowEndMin: int(env, 'WINDOW_END_MIN', 390),
  };
  return cfg;
}

// ── pure helpers ─────────────────────────────────────────────────────────────
const cond = (job, type) => ((job && job.status && job.status.conditions) || []).some((c) => c.type === type && c.status === 'True');
export const jobFinished = (job) => cond(job, 'Complete') || cond(job, 'Failed');
export function jobOutcome(job) {
  if (cond(job, 'Failed') || cond(job, 'FailureTarget')) return 'failed';
  if (cond(job, 'Complete')) return 'complete';
  return 'running';
}
export const activeBackupJobs = (jobs, prefix) =>
  jobs.filter((j) => j.metadata && typeof j.metadata.name === 'string' && j.metadata.name.startsWith(prefix) && !jobFinished(j)).map((j) => j.metadata.name).sort();
export function latestSuccessfulDailyJob(jobs) {
  const done = jobs.filter((j) => j.metadata && j.metadata.labels && j.metadata.labels['app.kubernetes.io/name'] === DAILY_LABEL && cond(j, 'Complete'));
  const at = (j) => Date.parse((j.status && (j.status.completionTime || j.status.startTime)) || j.metadata.creationTimestamp || '') || 0;
  done.sort((a, b) => at(b) - at(a));
  return done[0] || null;
}
export function inWindow(nowMs, startMin, endMin) {
  const d = new Date(nowMs);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return m >= startMin && m < endMin;
}
// The `backup` initContainer verdict of a Job's succeeded pod, or null (unknown).
export function verdictFromPods(pods) {
  const ok = pods.filter((p) => p.status && p.status.phase === 'Succeeded');
  ok.sort((a, b) => (Date.parse(b.metadata.creationTimestamp || '') || 0) - (Date.parse(a.metadata.creationTimestamp || '') || 0));
  for (const p of ok) {
    const st = (p.status.initContainerStatuses || []).find((c) => c.name === 'backup');
    const msg = st && st.state && st.state.terminated && st.state.terminated.message;
    if (!msg) continue;
    let v;
    try { v = JSON.parse(msg); } catch { continue; }
    if (v && v.format === VERDICT_FORMAT && v.mode === 'backup') return v;
  }
  return null;
}
export const isCompleteVerdict = (v) => !!v && v.exitCode === 0 && v.verdict === 'OK' && v.status === 'complete';
const describeVerdict = (v) => (v ? `verdict=${v.verdict} status=${v.status} date=${v.date} latest_complete=${v.latestComplete || 'none'}` : 'verdict=unknown');

// ── kubectl access (read + one create) ───────────────────────────────────────
async function getJson(kubectl, args, what) {
  const r = await kubectl([...args, '-o', 'json']);
  if (r.code !== 0) throw new GateRefused('kubectl', `cannot read ${what} (kubectl exit ${r.code}): ${(r.stderr || '').trim().split('\n')[0].slice(0, 200)}`);
  try { return JSON.parse(r.stdout); } catch { throw new GateRefused('kubectl', `cannot parse ${what}`); }
}
const listJobs = async (kubectl) => (await getJson(kubectl, ['get', 'jobs'], 'jobs')).items || [];
const podsOf = async (kubectl, job) => (await getJson(kubectl, ['get', 'pods', '-l', `job-name=${job}`], `pods of ${job}`)).items || [];

async function diagnostics(kubectl, job, log) {
  // Status only (conditions, exit codes, termination verdicts) — never `kubectl logs`.
  try {
    const j = await getJson(kubectl, ['get', 'job', job], `job ${job}`);
    const cs = ((j.status && j.status.conditions) || []).map((c) => `${c.type}=${c.status}${c.reason ? `(${c.reason})` : ''}`).join(' ');
    log(`diag job ${job}: active=${(j.status && j.status.active) || 0} succeeded=${(j.status && j.status.succeeded) || 0} failed=${(j.status && j.status.failed) || 0} ${cs}`);
    for (const p of await podsOf(kubectl, job)) {
      const all = [...((p.status && p.status.initContainerStatuses) || []), ...((p.status && p.status.containerStatuses) || [])];
      const parts = all.map((c) => {
        const t = c.state && c.state.terminated;
        return t ? `${c.name}:exit=${t.exitCode}${t.reason ? `(${t.reason})` : ''}${t.message ? ` msg=${String(t.message).slice(0, 300)}` : ''}`
          : `${c.name}:${Object.keys(c.state || {})[0] || 'unknown'}`;
      });
      log(`diag pod ${p.metadata.name}: phase=${p.status && p.status.phase} ${parts.join(' ')}`);
    }
  } catch (e) {
    log(`diag unavailable: ${e.message}`);
  }
}

export async function runGate({ cfg, kubectl, now = Date.now, sleep, log = console.log }) {
  const pollMs = cfg.pollIntervalSeconds * 1000;
  // 1) scheduled window
  if (inWindow(now(), cfg.windowStartMin, cfg.windowEndMin)) {
    throw new GateRefused('inside backup window', `now is within the scheduled geo-backup-daily window (${cfg.windowStartMin}–${cfg.windowEndMin} min UTC): dispatch again outside it`);
  }
  // 2) CronJob → poll bound
  const cj = await getJson(kubectl, ['get', 'cronjob', cfg.cronJob], `cronjob ${cfg.cronJob}`);
  const ads = cj && cj.spec && cj.spec.jobTemplate && cj.spec.jobTemplate.spec && cj.spec.jobTemplate.spec.activeDeadlineSeconds;
  if (!Number.isInteger(ads) || ads <= 0) throw new GateRefused('cronjob', `${cfg.cronJob} has no activeDeadlineSeconds: no bound for the poll`);
  const pollBudgetSeconds = ads + cfg.deadlineMarginSeconds;
  log(`cronjob ${cfg.cronJob}: activeDeadlineSeconds=${ads} → poll bound ${pollBudgetSeconds}s`);

  // 3) no active geo-backup-* Job (bounded wait)
  const activeUntil = now() + cfg.activeWaitSeconds * 1000;
  let jobs = await listJobs(kubectl);
  let active = activeBackupJobs(jobs, cfg.jobPrefix);
  while (active.length) {
    if (now() >= activeUntil) {
      throw new GateRefused('backup already running', `Job(s) ${active.join(',')} still active after ${cfg.activeWaitSeconds}s: MEP refused, dispatch again once it finished`);
    }
    log(`waiting: active backup Job(s) ${active.join(',')}`);
    await sleep(pollMs);
    jobs = await listJobs(kubectl);
    active = activeBackupJobs(jobs, cfg.jobPrefix);
  }
  log(`no active ${cfg.jobPrefix}* Job`);

  // 4) seed check on the newest successful daily Job
  const last = latestSuccessfulDailyJob(jobs);
  if (last) {
    const v = verdictFromPods(await podsOf(kubectl, last.metadata.name));
    log(`last successful backup Job ${last.metadata.name}: ${describeVerdict(v)}`);
    if (v && !isCompleteVerdict(v)) {
      throw new GateRefused('backup seed not complete', `last backup ${last.metadata.name} is ${v.status || v.verdict} (not complete): the seed is not finished, MEP refused`);
    }
  } else {
    log('no successful geo-backup-daily Job on record: the pre-MEP Job verdict decides');
  }

  // 5) create the pre-MEP Job
  const c = await kubectl(['create', 'job', cfg.jobName, `--from=cronjob/${cfg.cronJob}`]);
  if (c.code !== 0) throw new GateRefused('create failed', `kubectl create job ${cfg.jobName} failed (exit ${c.code}): ${(c.stderr || '').trim().split('\n')[0].slice(0, 200)}`);
  log(`created Job ${cfg.jobName} --from=cronjob/${cfg.cronJob}`);

  // 6) poll .status, fail-closed
  const deadline = now() + pollBudgetSeconds * 1000;
  for (;;) {
    const r = await kubectl(['get', 'job', cfg.jobName, '-o', 'json']);
    let outcome = 'running';
    if (r.code === 0) {
      try { outcome = jobOutcome(JSON.parse(r.stdout)); } catch { outcome = 'running'; }
    } else {
      log(`status of ${cfg.jobName} unreadable (kubectl exit ${r.code}), retrying until the deadline`);
    }
    if (outcome === 'complete') break;
    if (outcome === 'failed') {
      await diagnostics(kubectl, cfg.jobName, log);
      throw new GateRefused('backup failed', `backup Job ${cfg.jobName} FAILED: no fresh backup, MEP refused`);
    }
    if (now() >= deadline) {
      await diagnostics(kubectl, cfg.jobName, log);
      throw new GateRefused('backup timeout', `backup Job ${cfg.jobName} not complete within ${pollBudgetSeconds}s: MEP refused`);
    }
    await sleep(pollMs);
  }
  const v = verdictFromPods(await podsOf(kubectl, cfg.jobName));
  log(`backup Job ${cfg.jobName} succeeded: ${describeVerdict(v)}`);
  if (!isCompleteVerdict(v)) {
    await diagnostics(kubectl, cfg.jobName, log);
    throw new GateRefused('backup not complete', v
      ? `backup Job ${cfg.jobName} recorded status=${v.status} verdict=${v.verdict} (not complete): MEP refused`
      : `backup Job ${cfg.jobName} succeeded but its verdict is unreadable (termination message missing): MEP refused`);
  }
  log(`GATE PASSED: fresh complete backup date=${v.date} (Job ${cfg.jobName}) — MEP may proceed`);
  return { jobName: cfg.jobName, verdict: v };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function realKubectl(namespace) {
  return (args) => new Promise((resolve) => {
    execFile('kubectl', ['-n', namespace, '--request-timeout=60s', ...args], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function main() {
  const log = (m) => console.log(`[premep-backup] ${m}`);
  try {
    const cfg = readGateConfig(process.env);
    log(`ns=${cfg.namespace} cronjob=${cfg.cronJob} job=${cfg.jobName}`);
    await runGate({ cfg, kubectl: realKubectl(cfg.namespace), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log });
    return 0;
  } catch (e) {
    const title = e instanceof GateRefused ? e.title : 'unexpected error';
    console.log(`::error title=pre-MEP backup gate: ${title}::${e.message}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code));
}
