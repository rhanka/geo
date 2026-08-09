#!/usr/bin/env -S npx tsx
/**
 * coherence-ping-summary — reads a zone-grille-coherence-gate.ts JSON report and
 * prints, per slug, the compact metrics used by the PING-IMMO report lines:
 * code counts, strict/raw recouvrement, provenance and real_zoning. Read-only.
 *
 * Usage: npx tsx acquisition/src/coherence-ping-summary.ts \
 *          --file <coherence.json> --slugs a,b,c
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const slugs = (arg('--slugs') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const file = arg('--file') ?? resolve(process.cwd(), 'work/coverage/zone-grille-coherence.json');

interface Row {
  slug: string;
  real_zoning: boolean;
  primary_flag: string;
  flags: string[];
  zone_features: number;
  source_url: string | null;
  owner: string | null;
  layer: string | null;
  codes_zone: string[];
  codes_grille: string[];
  communs: string[];
  communs_raw: string[];
  recouvrement_strict: number;
  recouvrement_raw: number;
}

const report = JSON.parse(readFileSync(file, 'utf8')) as {
  generated_at?: string;
  rows: Record<string, Row>;
};

console.log(`# source=${file} generated_at=${report.generated_at ?? '?'}`);
const wanted = slugs.length ? slugs : Object.keys(report.rows);
for (const slug of wanted) {
  const r = report.rows[slug];
  if (!r) {
    console.log(`${slug}\tABSENT`);
    continue;
  }
  const pctS = (r.recouvrement_strict * 100).toFixed(2);
  const pctR = (r.recouvrement_raw * 100).toFixed(2);
  console.log(
    [
      slug,
      `real_zoning=${r.real_zoning}`,
      `flag=${r.primary_flag}`,
      `zone_features=${r.zone_features}`,
      `codes_zone=${r.codes_zone.length}`,
      `codes_grille=${r.codes_grille.length}`,
      `communs=${r.communs.length}`,
      `recouvrement_strict=${pctS}%`,
      `recouvrement_raw=${pctR}%`,
      `source_url=${r.source_url ?? ''}`,
      `owner=${r.owner ?? ''}`,
      `layer=${r.layer ?? ''}`,
    ].join('\t'),
  );
}
