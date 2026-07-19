// Helper: for every zones!=done slug WITH a PDF on disk, say what has already
// been ATTEMPTED (a work/gcp/<slug>*.report.json exists) and with what verdict.
//
// Purpose: separate "ground and refused, with a numeric reason" from "never
// tried" — the second is the only cheap gisement left, the first must not be
// re-ground blindly (memory `zones-gisement-jamais-tente`).
//
// Usage: npx tsx acquisition/src/_zones-attempt-ledger.ts [--untried] [--slug s]
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const only = argv.includes('--slug') ? argv[argv.indexOf('--slug') + 1] : undefined;
const untriedOnly = argv.includes('--untried');

const raw = JSON.parse(readFileSync('work/coverage/coverage-matrix.json', 'utf8'));
const notDone = Object.entries(raw.cities as Record<string, any>)
  .filter(([, v]: any) => v?.zones?.status && v.zones.status !== 'done')
  .map(([k]) => k)
  .sort();

const gcpDir = 'work/gcp';
const reports = existsSync(gcpDir) ? readdirSync(gcpDir).filter((f) => f.endsWith('.json')) : [];

interface Row {
  slug: string;
  reports: { file: string; pass?: boolean; reason?: string; resid?: number; svg?: number }[];
}
const rows: Row[] = [];

for (const slug of notDone) {
  if (only && slug !== only) continue;
  const mine = reports.filter((f) => f === `${slug}.report.json` || f.startsWith(`${slug}-`) || f.startsWith(`${slug}.`));
  const parsed = mine.map((f) => {
    try {
      const j = JSON.parse(readFileSync(`${gcpDir}/${f}`, 'utf8'));
      return {
        file: f,
        pass: j.pass,
        reason: typeof j.reason === 'string' ? j.reason.slice(0, 140) : undefined,
        resid: j.residual_max_m ?? j.best?.residual_max_m,
        svg: j.svg_points,
      };
    } catch {
      return { file: f };
    }
  });
  rows.push({ slug, reports: parsed });
}

const tried = rows.filter((r) => r.reports.length > 0);
const untried = rows.filter((r) => r.reports.length === 0);

console.log(`zones!=done = ${rows.length} · DÉJÀ TENTÉ (report gcp) = ${tried.length} · JAMAIS TENTÉ = ${untried.length}`);

if (!untriedOnly) {
  console.log('\n=== DÉJÀ TENTÉ ===');
  for (const r of tried) {
    console.log(`\n### ${r.slug}`);
    for (const rep of r.reports)
      console.log(
        `   ${rep.file}  pass=${rep.pass}  svg=${rep.svg ?? '?'}  resid=${rep.resid ?? '?'}\n     reason: ${rep.reason ?? '(aucune)'}`,
      );
  }
}

console.log('\n=== JAMAIS TENTÉ (aucun report gcp) ===');
console.log(untried.map((r) => r.slug).join(' '));
