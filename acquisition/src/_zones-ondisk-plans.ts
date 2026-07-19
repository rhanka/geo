// Helper: cross-reference on-disk zoning plans vs zones!=done candidates.
// Lists PDF plans on disk whose slug is still zones!=done (unserved) => untried leads.
// Usage: npx tsx acquisition/src/_zones-ondisk-plans.ts
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';

const raw = JSON.parse(readFileSync('work/coverage/coverage-matrix.json', 'utf8'));
const citiesObj = raw.cities as Record<string, any>;
const notDone = new Set(
  Object.entries(citiesObj)
    .filter(([, v]: any) => v?.zones?.status && v.zones.status !== 'done')
    .map(([k]) => k),
);

const dirs = ['work/zonage-plans', 'work/zones-recalage', 'work/zonage-dicts', 'work/gcp'];
const bySlug: Record<string, string[]> = {};

function slugFromFile(f: string): string {
  return f
    .replace(/\.(pdf|json|txt|png|gcp\.json|t3\.gcp\.json)$/i, '')
    .replace(/-(t1|t2|t2-autogcp|t3|t3-raster|lot\d+|plan|zonage|grille|zonage-plan|plan-zonage|retry\d*|reg\d+|r\d+p?\d*)$/gi, '')
    .replace(/-(t1|t2|t3|lot\d+)$/gi, '');
}

for (const d of dirs) {
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) {
    if (!/\.(pdf|json)$/i.test(f)) continue;
    const full = `${d}/${f}`;
    let sz = 0;
    try { sz = statSync(full).size; } catch {}
    const slug = slugFromFile(f);
    (bySlug[slug] ||= []).push(`${d}/${f} (${sz}o)`);
  }
}

// Report: on-disk artifacts whose base slug is still not done.
// --all lists EVERY on-disk artifact (a slug already flagged `done` in the matrix
// can still be unserved or partially served — cf. "done ≠ servi"), --slug filters.
const all = process.argv.includes('--all');
const only = process.argv.includes('--slug') ? process.argv[process.argv.indexOf('--slug') + 1] : undefined;
const leads = Object.entries(bySlug)
  .filter(([slug]) => (all || notDone.has(slug)) && (!only || slug.includes(only)))
  .sort((a, b) => a[0].localeCompare(b[0]));

console.log('zones!=done total', notDone.size);
console.log('on-disk artifacts matching a not-done slug:', leads.length);
for (const [slug, files] of leads) {
  console.log(`\n### ${slug}`);
  for (const f of files) console.log('  ', f);
}
