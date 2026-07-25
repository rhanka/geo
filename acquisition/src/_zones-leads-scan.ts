// Helper: RECURSIVE on-disk lead scan for zones!=done slugs.
//
// `_zones-ondisk-plans.ts` only reads the TOP level of a handful of dirs, so a
// plan filed under `work/zones-recalage/<lot>/…` was invisible. This walks the
// whole work/ tree and attaches every PDF to a not-done slug by longest-prefix
// match on the filename (the file names the muni, the directory may lie —
// cf. memory `corpus-slug-owner-mismatch`).
//
// Usage: npx tsx acquisition/src/_zones-leads-scan.ts [--roots a,b] [--slug <s>] [--min-size N]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};

const raw = JSON.parse(readFileSync('work/coverage/coverage-matrix.json', 'utf8'));
const cities = raw.cities as Record<string, any>;
const notDone = Object.entries(cities)
  .filter(([, v]: any) => v?.zones?.status && v.zones.status !== 'done')
  .map(([k]) => k)
  .sort((a, b) => b.length - a.length); // longest first: prefix match must prefer the specific slug

const only = opt('--slug');
const minSize = Number(opt('--min-size') || 20000);
const roots = (opt('--roots') || 'work').split(',');

const hits: Record<string, { path: string; size: number }[]> = {};

function matchSlug(name: string): string | undefined {
  const n = name.toLowerCase().replace(/_/g, '-');
  for (const s of notDone) {
    if (n.startsWith(s)) {
      // guard the homonym-filename trap: `saint-nazaire` must not swallow
      // `saint-nazaire-dacton`. Longest-first ordering already prefers the
      // specific slug; here we only reject a match cut mid-token.
      const rest = n.slice(s.length);
      if (rest === '' || /^[-._]/.test(rest)) return s;
    }
  }
  return undefined;
}

function walk(dir: string, depth: number) {
  if (depth > 8) return;
  let ents: string[];
  try {
    ents = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of ents) {
    if (e === 'node_modules' || e === '.git') continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, depth + 1);
    else if (/\.pdf$/i.test(e) && st.size >= minSize) {
      const s = matchSlug(e);
      if (s && (!only || s === only)) (hits[s] ||= []).push({ path: p, size: st.size });
    }
  }
}

for (const r of roots) walk(r, 0);

const slugs = Object.keys(hits).sort();
console.log(`zones!=done = ${notDone.length} · slugs avec >=1 PDF sur disque = ${slugs.length}`);
for (const s of slugs) {
  const files = hits[s]!.sort((a, b) => b.size - a.size);
  console.log(`\n### ${s}  (${files.length} pdf)`);
  for (const f of files.slice(0, 6)) console.log(`   ${String(f.size).padStart(9)}  ${f.path}`);
}
console.log('\n--- slugs SANS pdf sur disque ---');
console.log(notDone.filter((s) => !hits[s]).sort().join(' '));
