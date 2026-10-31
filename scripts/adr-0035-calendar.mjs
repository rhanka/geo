// Earliest-start calendar of the ADR-0035 transition plan (geo side), from a T0 hypothesis given as argument.
// Working days = Mon-Fri minus the Quebec holidays listed; fixed windows in calendar days. Usage: node scripts/adr-0035-calendar.mjs 2026-11-16
const T0 = process.argv[2] || '2026-11-16';
const HOLIDAYS = new Set(['2026-12-25', '2027-01-01', '2027-03-26', '2027-05-24', '2027-06-24', '2027-07-01']);
const iso = (d) => d.toISOString().slice(0, 10);
const isWd = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !HOLIDAYS.has(iso(d));
const nextWd = (d) => { const x = new Date(d); while (!isWd(x)) x.setUTCDate(x.getUTCDate() + 1); return x; };
// Adds n working days: returns [start, end] (end = last working day used).
const addWd = (start, n) => { let s = nextWd(start); let e = new Date(s); for (let i = 1; i < n; i++) { e.setUTCDate(e.getUTCDate() + 1); e = nextWd(e); } return [s, e]; };
const addCal = (start, n) => { const s = new Date(start); const e = new Date(s); e.setUTCDate(e.getUTCDate() + n - 1); return [s, e]; };
const after = (d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + 1); return x; };
let cur = new Date(`${T0}T00:00:00Z`);
const rows = [];
const step = (id, label, kind, n) => { const [s, e] = kind === 'wd' ? addWd(cur, n) : addCal(cur, n); rows.push([id, label, `${n} ${kind === 'wd' ? 'wd' : 'cal d'}`, iso(s), iso(e)]); cur = after(e); return e; };
step('L0.a', 'Hygiene PR', 'wd', 2);
step('L0.b', 'Canary build (remaining pieces)', 'wd', 5);
step('G1', 'Owner go: VAP + apply + run', 'wd', 2);
step('L0.c', 'Canary run, 4 proofs + 3 refusals, report', 'wd', 3);
step('G2', 'Owner go: canary ratification', 'wd', 2);
const l0end = new Date(cur);
// L1/L2 branch (bounded by external dependencies), computed apart; it does not drive the path.
{ const save = cur; step('L1.g', 'Geo: pin shared profile (git sha + digest, CI check)', 'wd', 2); step('L2.g', 'Geo: lane SA + token exchange, flag', 'wd', 3); rows.push(['', '(L1/L2 branch ends above; runs beside L3)', '', '', '']); cur = save; }
step('L3.b', 'Extend chain to 528 cities + bounded-memory collection', 'wd', 8);
step('L3.r', 'Shadow: 3 consecutive geo cycles', 'cal', 3);
step('L3.p', 'Parity analysis + re-run margin', 'wd', 3);
step('L4.b', 'extract/verify/reconcile/signals/contract build', 'wd', 14);
step('L4.r', 'Shadow on Q2 sample + v101b + radar dry-run', 'wd', 5);
step('G3', 'Owner go: L4 parity accepted', 'wd', 2);
for (let i = 1; i <= 3; i++) step(`L5.${i}`, `Preprod cohort ${i} window`, 'cal', 7);
step('G4', 'Owner go: prod', 'wd', 2);
for (let i = 1; i <= 3; i++) { step(`L6.${i}a`, `Prod cohort ${i} approval (geo-prod)`, 'wd', 1); step(`L6.${i}`, `Prod cohort ${i} window`, 'cal', 7); }
step('W28', '28-day window before L8 (L7 runs inside)', 'cal', 28);
step('G6', 'Owner go: L8', 'wd', 2);
step('L8.g', 'Geo: PV adapters into qc-sources', 'wd', 3);
console.log(`T0 = ${T0} ; L0 ends before ${iso(l0end)}`);
console.log('| step | content | duration | start | end |\n|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.join(' | ')} |`);
