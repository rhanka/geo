#!/usr/bin/env npx tsx
// Compact per-slug summary of a zone-grille-coherence-gate.ts --out JSON.
// Reads the (large) gate output and prints only scalar overlap metrics so we
// never have to page thousands of lines of code-array dumps.
// Usage: npx tsx acquisition/src/cohere-shard-summary.ts <gate.json> [slug,slug,...]
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: cohere-shard-summary.ts <gate.json> [slug,slug]');
  process.exit(1);
}
const only = (process.argv[3] || '').split(',').map((s) => s.trim()).filter(Boolean);
const j = JSON.parse(readFileSync(path, 'utf8'));
const rows = j.rows || {};
const slugs = only.length ? only : Object.keys(rows);

const uniq = (a: unknown): string[] => Array.isArray(a) ? Array.from(new Set(a.map(String))) : [];
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(2) + '%' : 'n/a');

for (const slug of slugs) {
  const r = rows[slug];
  if (!r) { console.log(`\n== ${slug} == ABSENT du gate`); continue; }
  const z = uniq(r.codes_zone);
  const g = uniq(r.codes_grille);
  const c = uniq(r.communs);
  const zset = new Set(z);
  const gset = new Set(g);
  const strictCommon = z.filter((x) => gset.has(x)).length; // servi ∩ grille (exact)
  const grilleInZone = g.filter((x) => zset.has(x)).length;
  console.log(`\n== ${slug} ==`);
  console.log(`  real_zoning      : ${r.real_zoning}`);
  console.log(`  primary_flag     : ${r.primary_flag}  flags=${JSON.stringify(r.flags)}`);
  console.log(`  zone_features    : ${r.zone_features}`);
  console.log(`  codes_zone (servi): ${z.length}`);
  console.log(`  codes_grille      : ${g.length}`);
  console.log(`  communs (gate)    : ${c.length}`);
  console.log(`  strict servi∩grille: ${strictCommon} / ${z.length} = ${pct(strictCommon, z.length)}`);
  console.log(`  grille∩servi      : ${grilleInZone} / ${g.length} = ${pct(grilleInZone, g.length)}`);
  console.log(`  source_url        : ${r.source_url}`);
  console.log(`  owner/layer       : ${r.owner} / ${r.layer}`);
  console.log(`  served_grille_key : ${r.served_grille_key}`);
}
