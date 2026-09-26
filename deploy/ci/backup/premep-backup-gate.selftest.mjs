#!/usr/bin/env node
// Offline selftest of premep-backup-gate.mjs (0 network, 0 dependency): a
// simulated kubectl + a fake clock drive every path of the pre-MEP gate, then the
// cd-prod / RBAC / CI wiring is checked on the committed files.
import process from 'node:process';
import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as gate from './premep-backup-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
let passed = 0;
let failed = 0;
const ok = (name, cond) => {
  if (cond) { passed += 1; console.log(`  ok   ${name}`); } else { failed += 1; console.log(`  FAIL ${name}`); }
};
const eq = (name, a, b) => ok(`${name}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`, JSON.stringify(a) === JSON.stringify(b));

const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const ENV = { GIT_SHA: SHA, RUN_ID: '123456789', RUN_ATTEMPT: '2', POLL_INTERVAL_SECONDS: '15' };
const JOB = 'geo-backup-premep-abcdef0-123456789-2';
const ADS = 10800;
const T0 = Date.parse('2026-09-26T14:00:00Z'); // outside the 03:13–06:30 UTC window

const verdictMsg = (status, verdict = status === 'complete' ? 'OK' : 'PARTIAL') =>
  JSON.stringify({ format: gate.VERDICT_FORMAT, mode: 'backup', exitCode: 0, verdict, status, date: '2026-09-26', docsStatus: status, latestComplete: status === 'complete' ? '2026-09-26' : null });
const jobObj = (name, state, { daily = true, completionTime = '2026-09-26T04:00:00Z' } = {}) => ({
  metadata: { name, labels: daily ? { 'app.kubernetes.io/name': 'geo-backup-daily' } : { 'app.kubernetes.io/name': 'geo-backup-freshness' }, creationTimestamp: '2026-09-26T03:23:00Z' },
  status: {
    ...(state === 'running' ? { active: 1 } : {}),
    ...(state === 'complete' ? { succeeded: 1, completionTime } : {}),
    conditions: state === 'complete' ? [{ type: 'SuccessCriteriaMet', status: 'True' }, { type: 'Complete', status: 'True' }]
      : state === 'failed' ? [{ type: 'Failed', status: 'True', reason: 'PodFailurePolicy' }]
        : state === 'failureTarget' ? [{ type: 'FailureTarget', status: 'True' }] : [],
  },
});
const podObj = (job, phase, message) => ({
  metadata: { name: `${job}-x1`, creationTimestamp: '2026-09-26T03:23:01Z' },
  status: {
    phase,
    initContainerStatuses: [
      { name: 'dump', state: { terminated: { exitCode: 0 } } },
      { name: 'backup', state: { terminated: { exitCode: 0, ...(message ? { message } : {}) } } },
    ],
    containerStatuses: [{ name: 'purge', state: { terminated: { exitCode: 0 } } }],
  },
});

// World: `jobs` (name → { job, pods }) + scripted transitions per poll.
function mkWorld({ jobs = {}, cronjob = { spec: { jobTemplate: { spec: { activeDeadlineSeconds: ADS } } } }, onCreate, onPoll, createFails = false, start = T0 } = {}) {
  const w = { t: start, calls: [], jobs: { ...jobs }, polls: 0 };
  const out = (o) => ({ code: 0, stdout: JSON.stringify(o), stderr: '' });
  w.now = () => w.t;
  w.sleep = async (ms) => { w.t += ms; if (onPoll) onPoll(w); };
  w.kubectl = async (args) => {
    w.calls.push(args.join(' '));
    const [verb, kind, name] = args;
    if (verb === 'get' && kind === 'cronjob') return cronjob ? out(cronjob) : { code: 1, stdout: '', stderr: 'Error from server (Forbidden)' };
    if (verb === 'get' && kind === 'jobs') return out({ items: Object.values(w.jobs).map((x) => x.job) });
    if (verb === 'get' && kind === 'job') {
      w.polls += 1;
      return w.jobs[name] ? out(w.jobs[name].job) : { code: 1, stdout: '', stderr: 'NotFound' };
    }
    if (verb === 'get' && kind === 'pods') {
      const sel = args[args.indexOf('-l') + 1].replace('job-name=', '');
      return out({ items: (w.jobs[sel] && w.jobs[sel].pods) || [] });
    }
    if (verb === 'create' && kind === 'job') {
      if (createFails) return { code: 1, stdout: '', stderr: 'Error from server (AlreadyExists)' };
      w.jobs[name] = { job: jobObj(name, 'running'), pods: [] };
      if (onCreate) onCreate(w, name);
      return { code: 0, stdout: `job.batch/${name} created`, stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `unexpected kubectl ${args.join(' ')}` };
  };
  return w;
}
async function runW(w, env = ENV) {
  const logs = [];
  try {
    const r = await gate.runGate({ cfg: gate.readGateConfig(env), kubectl: w.kubectl, now: w.now, sleep: w.sleep, log: (m) => logs.push(m) });
    return { go: true, r, logs };
  } catch (e) {
    return { go: false, err: e, logs };
  }
}
const finish = (state, message) => (w, name) => { w.jobs[name] = { job: jobObj(name, state), pods: state === 'complete' ? [podObj(name, 'Succeeded', message)] : [] }; };
const prevComplete = { 'geo-backup-daily-29840000': { job: jobObj('geo-backup-daily-29840000', 'complete'), pods: [podObj('geo-backup-daily-29840000', 'Succeeded', verdictMsg('complete'))] } };
const noWrite = (w) => w.calls.every((c) => !c.startsWith('create') && !c.startsWith('delete') && !c.startsWith('logs'));
const createdOnce = (w) => w.calls.filter((c) => c.startsWith('create')).length === 1;

// ── config ──
eq('job name = geo-backup-premep-<sha7>-<run_id>-<attempt>', gate.readGateConfig(ENV).jobName, JOB);
ok('config: invalid sha refused', (() => { try { gate.readGateConfig({ ...ENV, GIT_SHA: 'main' }); return false; } catch (e) { return e instanceof gate.GateRefused; } })());
ok('config: invalid run attempt refused', (() => { try { gate.readGateConfig({ ...ENV, RUN_ATTEMPT: '1;x' }); return false; } catch (e) { return e instanceof gate.GateRefused; } })());

// ── 1. no active Job → create + wait → complete → GO ──
{
  let n = 0;
  const w = mkWorld({ jobs: prevComplete, onPoll: (x) => { n += 1; if (n === 3) finish('complete', verdictMsg('complete'))(x, JOB); } });
  const res = await runW(w);
  ok('no active Job: GO after the created Job completes with verdict complete', res.go && res.r.verdict.status === 'complete');
  ok('no active Job: exactly one create, --from=cronjob/geo-backup-daily', createdOnce(w) && w.calls.includes(`create job ${JOB} --from=cronjob/geo-backup-daily`));
  ok('no active Job: polled .status several times (get job -o json)', w.polls >= 3);
  ok('never kubectl logs / delete', w.calls.every((c) => !c.startsWith('logs') && !c.startsWith('delete')));
}
// ── 2. active Job that finishes within the bound → wait, then create → GO ──
{
  const running = { 'geo-backup-daily-29840100': { job: jobObj('geo-backup-daily-29840100', 'running'), pods: [] } };
  const w = mkWorld({
    jobs: { ...prevComplete, ...running },
    onPoll: (x) => {
      if (x.t - T0 >= 120000 && x.jobs['geo-backup-daily-29840100'].job.status.active) {
        x.jobs['geo-backup-daily-29840100'] = { job: jobObj('geo-backup-daily-29840100', 'complete', { completionTime: '2026-09-26T14:02:00Z' }),
          pods: [podObj('geo-backup-daily-29840100', 'Succeeded', verdictMsg('complete'))] };
      }
      if (x.jobs[JOB]) finish('complete', verdictMsg('complete'))(x, JOB);
    },
  });
  const res = await runW(w);
  const createIdx = w.calls.findIndex((c) => c.startsWith('create'));
  ok('active Job: waits, then creates and passes', res.go && createIdx > 2 && res.logs.some((l) => l.includes('waiting: active backup Job(s) geo-backup-daily-29840100')));
}
// ── 3. active Job that never finishes → refuse, no create ──
{
  const w = mkWorld({ jobs: { ...prevComplete, 'geo-backup-premep-1111111-1-1': { job: jobObj('geo-backup-premep-1111111-1-1', 'running'), pods: [] } } });
  const res = await runW(w, { ...ENV, ACTIVE_WAIT_SECONDS: '600' });
  ok('active Job never ends: refused (backup already running), nothing created', !res.go && res.err.title === 'backup already running' && noWrite(w));
  ok('active Job wait bounded by ACTIVE_WAIT_SECONDS', w.t - T0 >= 600000 && w.t - T0 <= 600000 + 15000);
}
// ── 3b. an active non-backup Job does not block ──
{
  const w = mkWorld({ jobs: { ...prevComplete, 'geo-fetch-29840000': { job: jobObj('geo-fetch-29840000', 'running', { daily: false }), pods: [] } }, onCreate: finish('complete', verdictMsg('complete')) });
  ok('active Job outside geo-backup-* does not block', (await runW(w)).go);
}
// ── 4. created Job failed → refuse ──
{
  const w = mkWorld({ jobs: prevComplete, onCreate: finish('failed') });
  const res = await runW(w);
  ok('created Job Failed: refused (backup failed)', !res.go && res.err.title === 'backup failed' && createdOnce(w));
  ok('failure diagnostics: status only, no logs', res.logs.some((l) => l.startsWith('diag job')) && w.calls.every((c) => !c.startsWith('logs')));
}
// ── 4b. FailureTarget (podFailurePolicy FailJob, pods still terminating) → refuse at once ──
{
  const w = mkWorld({ jobs: prevComplete, onCreate: finish('failureTarget') });
  const res = await runW(w);
  ok('created Job FailureTarget: refused without waiting for the deadline', !res.go && res.err.title === 'backup failed' && w.t - T0 < 60000);
}
// ── 5. timeout → refuse ──
{
  const w = mkWorld({ jobs: prevComplete });
  const res = await runW(w);
  ok('created Job never completes: refused (backup timeout)', !res.go && res.err.title === 'backup timeout');
  const bound = (ADS + 600) * 1000;
  ok('timeout = activeDeadlineSeconds + margin (bounded)', w.t - T0 >= bound && w.t - T0 <= bound + 15000);
}
// ── 6. seed not complete (last backup partial) → refuse before any create ──
{
  const prevPartial = { 'geo-backup-daily-29840000': { job: jobObj('geo-backup-daily-29840000', 'complete'), pods: [podObj('geo-backup-daily-29840000', 'Succeeded', verdictMsg('partial'))] } };
  const w = mkWorld({ jobs: prevPartial });
  const res = await runW(w);
  ok('last backup partial: refused (seed not complete), nothing created', !res.go && res.err.title === 'backup seed not complete' && noWrite(w));
}
// ── 7. created Job succeeds but records partial → refuse ──
{
  const w = mkWorld({ jobs: prevComplete, onCreate: finish('complete', verdictMsg('partial')) });
  const res = await runW(w);
  ok('created Job exit 0 but verdict PARTIAL: refused (backup not complete)', !res.go && res.err.title === 'backup not complete');
}
// ── 7b. created Job succeeds but records incomplete / TERMINATED → refuse ──
{
  const inc = JSON.stringify({ format: gate.VERDICT_FORMAT, mode: 'backup', exitCode: 0, verdict: 'INCOMPLETE', status: 'incomplete', date: '2026-09-26', partialReason: 'objects failed' });
  const w = mkWorld({ jobs: prevComplete, onCreate: finish('complete', inc) });
  const res = await runW(w);
  ok('created Job verdict INCOMPLETE: refused (backup not complete), reason logged', !res.go && res.err.title === 'backup not complete' && /status=incomplete/.test(res.err.message) &&
    res.logs.some((l) => l.includes('reason="objects failed"')));
  const term = JSON.stringify({ format: gate.VERDICT_FORMAT, mode: 'backup', exitCode: 1, verdict: 'TERMINATED', status: 'partial', date: '2026-09-26', partialReason: 'terminated (SIGTERM) before the copy finished' });
  const w2 = mkWorld({ jobs: prevComplete, onCreate: finish('complete', term) });
  const res2 = await runW(w2);
  ok('created Job verdict TERMINATED: refused (backup not complete)', !res2.go && res2.err.title === 'backup not complete' && /verdict=TERMINATED/.test(res2.err.message));
  // TERMINATED exits 1: its pod is Failed, never read as a success; a Complete Job whose only
  // readable verdict sits on a Failed pod = unknown → refused.
  const w3 = mkWorld({ jobs: prevComplete, onCreate: (x, name) => { x.jobs[name] = { job: jobObj(name, 'complete'), pods: [podObj(name, 'Failed', verdictMsg('complete'))] }; } });
  const res3 = await runW(w3);
  ok('verdict only on a Failed pod: unknown → refused', !res3.go && /unreadable/.test(res3.err.message));
  const prevInc = { 'geo-backup-daily-29840000': { job: jobObj('geo-backup-daily-29840000', 'complete'), pods: [podObj('geo-backup-daily-29840000', 'Succeeded', inc)] } };
  const w4 = mkWorld({ jobs: prevInc });
  const res4 = await runW(w4);
  ok('last backup incomplete: refused (seed not complete), nothing created', !res4.go && res4.err.title === 'backup seed not complete' && noWrite(w4));
  ok('isCompleteVerdict: only status=complete + verdict=OK + exit 0', gate.isCompleteVerdict(JSON.parse(verdictMsg('complete'))) &&
    !gate.isCompleteVerdict({ ...JSON.parse(verdictMsg('complete')), verdict: 'OK-PURGE-PLAN-FAILED', exitCode: 3 }) &&
    !gate.isCompleteVerdict(JSON.parse(term)) && !gate.isCompleteVerdict(JSON.parse(inc)) && !gate.isCompleteVerdict(null));
}
// ── 8. created Job succeeds without termination message (older script) → refuse ──
{
  const w = mkWorld({ jobs: prevComplete, onCreate: finish('complete', null) });
  const res = await runW(w);
  ok('created Job verdict unreadable: refused (unknown ≠ complete)', !res.go && res.err.title === 'backup not complete' && /unreadable/.test(res.err.message));
}
// ── 9. previous verdict unknown (no Job on record) → the created Job decides ──
{
  const w = mkWorld({ jobs: {}, onCreate: finish('complete', verdictMsg('complete')) });
  const res = await runW(w);
  ok('no previous backup Job: the pre-MEP Job verdict decides (GO when complete)', res.go);
}
// ── 10. inside the scheduled window → refuse, 0 kubectl ──
{
  const w = mkWorld({ jobs: prevComplete, start: Date.parse('2026-09-26T03:30:00Z') });
  const res = await runW(w);
  ok('inside the 03:13–06:30 UTC window: refused, no kubectl call', !res.go && res.err.title === 'inside backup window' && w.calls.length === 0);
}
// ── 11. CronJob unreadable (RBAC not applied) / without activeDeadlineSeconds → refuse ──
{
  const w = mkWorld({ jobs: prevComplete, cronjob: null });
  const res = await runW(w);
  ok('cronjob unreadable: refused, nothing created', !res.go && res.err.title === 'kubectl' && noWrite(w));
  const w2 = mkWorld({ jobs: prevComplete, cronjob: { spec: { jobTemplate: { spec: {} } } } });
  const res2 = await runW(w2);
  ok('cronjob without activeDeadlineSeconds: refused (no poll bound)', !res2.go && res2.err.title === 'cronjob' && noWrite(w2));
}
// ── 12. create refused (AlreadyExists / Forbidden) → refuse ──
{
  const w = mkWorld({ jobs: prevComplete, createFails: true });
  const res = await runW(w);
  ok('create job refused by the API: MEP refused', !res.go && res.err.title === 'create failed');
}
// ── pure helpers ──
ok('verdictFromPods ignores a failed first attempt and picks the succeeded pod',
  gate.isCompleteVerdict(gate.verdictFromPods([podObj('j', 'Failed', verdictMsg('complete')), { ...podObj('j', 'Succeeded', verdictMsg('complete')), metadata: { name: 'j-2', creationTimestamp: '2026-09-26T04:00:00Z' } }])));
ok('verdictFromPods: foreign / malformed message = unknown', gate.verdictFromPods([podObj('j', 'Succeeded', '{"verdict":"OK"}')]) === null &&
  gate.verdictFromPods([podObj('j', 'Succeeded', 'not json')]) === null);

// ── wiring (committed files) ──
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const wf = read('.github/workflows/cd-prod.yml');
const steps = wf.split(/\n(?= {6}- (?:name|uses): )/);
const gi = steps.findIndex((s) => /- name: Porte backup pré-MEP/.test(s));
const di = steps.findIndex((s) => /- name: Deploy prod/.test(s));
const ki = steps.findIndex((s) => /- name: Configure kubeconfig \(prod\)/.test(s));
ok('cd-prod: gate step after kubeconfig and before Deploy prod', gi > ki && ki > 0 && gi < di);
const gs = steps[gi] || '';
ok('cd-prod: gate runs the committed script', /^ {8}run: node deploy\/ci\/backup\/premep-backup-gate\.mjs$/m.test(gs));
ok('cd-prod: gate inputs by env only (github.sha / run_id / run_attempt), no ${{ }} in run', /GIT_SHA: \$\{\{ github\.sha \}\}/.test(gs) &&
  /RUN_ID: \$\{\{ github\.run_id \}\}/.test(gs) && /RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}/.test(gs) && !/run:[^\n]*\$\{\{/.test(gs));
ok('cd-prod: gate not skippable (no if:, no continue-on-error)', !/\n\s+if:/.test(gs) && !/continue-on-error/.test(gs));
ok('cd-prod: still owner-gated by Environment geo-prod', /\n {4}environment: geo-prod\n/.test(wf));
const rbac = read('deploy/k8s/prod/deployer-prod-rbac.yaml');
ok('prod RBAC: batch/jobs get/list/watch/create (no delete/patch/update)', /apiGroups: \["batch"\]\n\s+resources: \["jobs"\]\n\s+verbs: \["get", "list", "watch", "create"\]/.test(rbac));
ok('prod RBAC: batch/cronjobs get on geo-backup-daily only', /apiGroups: \["batch"\]\n\s+resources: \["cronjobs"\]\n\s+resourceNames: \["geo-backup-daily"\]\n\s+verbs: \["get"\]/.test(rbac));
ok('prod RBAC: no pods/log, no secrets', !/pods\/log/.test(rbac.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')) && !/"secrets"/.test(rbac));
ok('backup-daily.cjs writes the verdict termination message', /writeTerminationMessage\(terminationRecord\(mode, r\)\)/.test(read('deploy/ci/backup/backup-daily.cjs')));
ok('CI runs this selftest', read('.github/workflows/ci.yml').includes('node deploy/ci/backup/premep-backup-gate.selftest.mjs'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
