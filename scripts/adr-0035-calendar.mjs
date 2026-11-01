// Earliest-start calendar of the ADR-0035 transition plan, from a T0 hypothesis given as argument.
// Working days = Mon-Fri minus the Quebec holidays listed; fixed windows in calendar days.
// Radar agent-day estimates (radar-lots-estimates.md) are rounded UP to whole working days.
// Usage: node scripts/adr-0035-calendar.mjs 2026-11-16
const T0 = process.argv[2] || '2026-11-16';
const HOLIDAYS = new Set(['2026-12-25', '2027-01-01', '2027-03-26', '2027-05-24', '2027-06-24', '2027-07-01']);
const iso = (d) => d.toISOString().slice(0, 10);
const isWd = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !HOLIDAYS.has(iso(d));
const nextWd = (d) => { const x = new Date(d); while (!isWd(x)) x.setUTCDate(x.getUTCDate() + 1); return x; };
// Adds n working days: returns [start, end] (end = last working day used).
const addWd = (start, n) => { const s = nextWd(start); let e = new Date(s); for (let i = 1; i < n; i++) { e.setUTCDate(e.getUTCDate() + 1); e = nextWd(e); } return [s, e]; };
const addCal = (start, n) => { const s = new Date(start); const e = new Date(s); e.setUTCDate(e.getUTCDate() + n - 1); return [s, e]; };
const after = (d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + 1); return x; };
const rows = [];
// A track is a sequence of steps starting at a given date; returns the day after its last step.
const track = (from, steps, tag = '') => {
  let cur = new Date(from);
  for (const [id, label, kind, n] of steps) {
    const [s, e] = kind === 'wd' ? addWd(cur, n) : addCal(cur, n);
    rows.push([id, `${tag}${label}`, `${n} ${kind === 'wd' ? 'wd' : 'cal d'}`, iso(s), iso(e)]);
    cur = after(e);
  }
  return cur;
};
const t0 = new Date(`${T0}T00:00:00Z`);
const print = (endLabel, end) => {
  rows.sort((a, b) => (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));
  console.log(`T0 = ${T0} ; ${endLabel} ${iso(end)}`);
  console.log('| step | content | duration | start | end |\n|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.join(' | ')} |`);
};
// One-iteration plan (docs/adr-0035-one-iteration-plan.md): `node scripts/adr-0035-calendar.mjs <T0> one`.
// Agents work every calendar day, so the iteration is counted in calendar days; T0 = D1.
if (process.argv[3] === 'one') {
  const devEnd = track(t0, [['D1–D7', 'Development, 4 parallel lanes (G-A capture, G-B extraction, G-C contract + parity, R radar)', 'cal', 7]]);
  const end = track(devEnd, [
    ['G0', 'Owner approval: deploy the shadow jobs (geo-prod Environment), then shadow starts at the next radar slot', 'cal', 1],
    ['T1', 'Shadow: 4 consecutive cycles (24 h), radar authoritative, radar dry-run each cycle', 'cal', 1],
    ['T2', 'Parity report against the ADR-0035 gate values; re-run cycle only for failed cities', 'cal', 1],
    ['G1+C', 'Owner go, then cut-over in 2 waves the same day (2 radar slots); radar suspended', 'cal', 1],
  ]);
  print('iteration (dev + test + cut-over) ends before', end);
  process.exit(0);
}
// Short plan (docs/adr-0035-short-plan.md): `node scripts/adr-0035-calendar.mjs <T0> short [one-slot]`.
// `one-slot` = only one geo PR slot free (2-open-PR limit), so S1 and S2 run one after the other.
if (process.argv[3] === 'short') {
  const oneSlot = process.argv[4] === 'one-slot';
  const s1end = track(t0, [['S1', 'Capture: radar 528 cities on the existing geo PV chain, size guard, CronJob dedup (3 + 2)', 'wd', 5]], '[geo] ');
  const buildEnd = track(oneSlot ? s1end : t0, [['S2', 'Extraction: port radar refresh extraction as-is + contract writer (6 + 3)', 'wd', 9]], '[geo] ');
  track(t0, [['S2.k', 'Seat keyring for the geo extraction pod: mint + rotation documented (hypothesis)', 'wd', 2]], '[k8s+radar] ');
  track(t0, [
    ['L0.r1', 'Token instrumentation (0.5 agent-day)', 'wd', 1],
    ['L0.r2', 'Release + prod promotion (hypothesis)', 'wd', 2],
    ['L0.r3', 'Baseline measurement window', 'cal', 7],
  ], '[radar] ');
  track(t0, [
    ['L4.c', 'radar-pv-consume: contract client, mapping, dry-run report (2 + 1 buffer)', 'wd', 3],
    ['L5/6.r', 'Allowlist + refresh skip, rollback script (1)', 'wd', 1],
  ], '[radar] ');
  const shadowEnd = track(buildEnd, [
    ['S3', 'Single shadow window: geo capture + extraction on 528 cities, radar unchanged; radar dry-run; rollback rehearsed in preprod', 'cal', 7],
    ['S3.p', 'Parity report (L3 + L4 gate values) + 1 wd margin', 'wd', 3],
    ['G1', 'Owner go: cut-over (geo-prod Environment)', 'wd', 1],
  ]);
  const end = track(shadowEnd, [
    ['S4.1', 'Prod cohort 1 (~50 cities), radar skips them', 'cal', 3],
    ['S4.2', 'Prod cohort 2 (all remaining cities); radar refresh suspended, kept deployed', 'wd', 1],
    ['S5', 'Observation, radar suspended = instant rollback', 'cal', 7],
    ['G2', 'Owner go: retire radar chain', 'wd', 1],
    ['S6', 'Radar retirement (1 + 0.5 option)', 'wd', 2],
  ]);
  print('short plan ends before', end);
  process.exit(0);
}
// Critical path, part 1: L0 (geo).
const l0end = track(t0, [
  ['L0.a', 'Hygiene PR', 'wd', 2],
  ['L0.b', 'Canary build (remaining pieces)', 'wd', 5],
  ['G1', 'Owner go: VAP + apply + run', 'wd', 2],
  ['L0.c', 'Canary run, 4 proofs + 3 refusals, report', 'wd', 3],
  ['G2', 'Owner go: canary ratification', 'wd', 2],
]);
// Radar L0 baseline, beside L0 from T0: instrumentation, release + prod promotion (hypothesis 2 wd), 7-day clock.
const baselineEnd = track(t0, [
  ['L0.r1', 'Token instrumentation (0.5 agent-day)', 'wd', 1],
  ['L0.r2', 'Release + prod promotion (hypothesis)', 'wd', 2],
  ['L0.r3', 'Baseline measurement window', 'cal', 7],
], '[radar] ');
// L1/L2 beside L3 (bounded by Engram 0.24.0 and F-CM1..3, whose dates are not given yet).
track(l0end, [
  ['L1.r', 'Engram 0.24.0 bump + profile folder + digest CI, then F-EN4 adoption (0.5 + 0.5 + 0.5 buffer)', 'wd', 2],
], '[radar] ');
track(l0end, [
  ['L1.g', 'Pin shared profile (git sha + digest, CI check)', 'wd', 2],
  ['L2.g', 'Lane SA + token exchange, flag', 'wd', 3],
  ['L2.v', 'Job-creator SA boundary (VAP), negative test (1 + 1)', 'wd', 2],
], '[geo] ');
// Critical path, part 2: L3 then L4 (geo).
const l3end = track(l0end, [
  ['L3.b', 'Extend chain to 528 cities + bounded-memory collection', 'wd', 8],
  ['L3.r', 'Shadow: 3 consecutive geo cycles', 'cal', 3],
  ['L3.p', 'Parity analysis + re-run margin', 'wd', 3],
]);
// Radar consumer build beside L4.g (golden contract fixture, so not blocked on geo L4).
track(l3end, [
  ['L4.c', 'radar-pv-consume: contract client, mapping, dry-run report (2 + 1 buffer)', 'wd', 3],
  ['L5/6.r', 'Allowlist + refresh skip, prod overlay, rollback runbook (1)', 'wd', 1],
], '[radar] ');
const g3end = track(l3end, [
  ['L4.g', 'extract/verify/reconcile/signals/contract build', 'wd', 14],
  ['L4.r', 'Shadow on Q2 sample + v101b + radar dry-run', 'wd', 5],
  ['G3', 'Owner go: L4 parity accepted', 'wd', 2],
]);
// Critical path, part 3: cohorts, window, retirement.
const l5end = track(g3end, [1, 2, 3].map((i) => [`L5.${i}`, `Preprod cohort ${i} window`, 'cal', 7]));
const g4end = track(l5end, [['G4', 'Owner go: prod', 'wd', 2]]);
const l6end = track(g4end, [1, 2, 3].flatMap((i) => [[`L6.${i}a`, `Prod cohort ${i} approval (geo-prod)`, 'wd', 1], [`L6.${i}`, `Prod cohort ${i} window`, 'cal', 7]]));
// L7 inside the 28-day window.
track(l6end, [
  ['L7.g', 'join + contract geo_resolutions source (3 + 2 buffer)', 'wd', 5],
  ['L7.m', 'F-CM5 geo MCP provider in s3-dag 0.2.0, city freshness (3 + 2 buffer)', 'wd', 5],
], '[geo] ');
track(l6end, [
  ['L7.r', 'geo_resolutions writer + shadow diff (1)', 'wd', 1],
  ['L7.s', 'Shadow period (radar proposal)', 'cal', 7],
  ['L7.o', 'Switch off run-geo-mapper and populate-geo resolve (0.5)', 'wd', 1],
], '[radar] ');
const g6end = track(l6end, [
  ['W28', '28-day window before L8 (L7 runs inside)', 'cal', 28],
  ['G6', 'Owner go: L8', 'wd', 2],
]);
track(g6end, [['L8.r', 'Retire refresh-pv, watchdog, keyring PVC, PV use of RECUEIL (1 + 0.5 option)', 'wd', 2]], '[radar] ');
const end = track(g6end, [['L8.g', 'PV adapters into qc-sources', 'wd', 3]], '[geo] ');
rows.sort((a, b) => (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));
console.log(`T0 = ${T0} ; L0 baseline ends before ${iso(baselineEnd)} ; L8 ends before ${iso(end)}`);
console.log('| step | content | duration | start | end |\n|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
