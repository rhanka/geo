#!/usr/bin/env -S npx tsx
/**
 * coherence-brief-report — lit un rapport zone-grille-coherence-gate.ts (JSON) et
 * imprime, pour une liste de slugs, les compteurs compacts servant les lignes
 * PING-IMMO : codes_zone / codes_grille / communs / recouvrement (strict + raw) /
 * real_zoning / provenance. Read-only : ne recalcule rien, ne touche pas S3.
 *
 * Usage:
 *   npx tsx acquisition/src/coherence-brief-report.ts --report <path.json> --slugs a,b,c
 * Défaut report: work/coverage/zone-grille-coherence.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Row {
  slug: string;
  real_zoning: boolean;
  primary_flag: string;
  flags: string[];
  codes_zone: string[];
  codes_grille: string[];
  communs: string[];
  communs_raw: string[];
  recouvrement_strict: number;
  recouvrement_raw: number;
  recouvrement_bridged: number;
  source_url: string | null;
  owner: string | null;
  layer: string | null;
  title: string | null;
}

const slugs = (arg('--slugs') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (slugs.length === 0) {
  console.error('usage: --slugs slug1,slug2,... [--report path.json]');
  process.exit(1);
}

const path = arg('--report') ?? resolve(process.cwd(), 'work/coverage/zone-grille-coherence.json');
const report = JSON.parse(readFileSync(path, 'utf8')) as {
  generated_at?: string;
  rows?: Record<string, Row>;
};

const pct = (v: number): string => (v * 100).toFixed(2) + '%';

console.log(`# source=${path} generated_at=${report.generated_at ?? '?'}`);
for (const slug of slugs) {
  const r = report.rows?.[slug];
  if (!r) {
    console.log(`${slug}\tABSENT`);
    continue;
  }
  console.log(
    [
      slug,
      `codes_zone=${r.codes_zone.length}`,
      `codes_grille=${r.codes_grille.length}`,
      `communs=${r.communs.length}`,
      `communs_raw=${r.communs_raw.length}`,
      `strict=${pct(r.recouvrement_strict)}`,
      `raw=${pct(r.recouvrement_raw)}`,
      `bridged=${pct(r.recouvrement_bridged)}`,
      `real_zoning=${r.real_zoning}`,
      `flags=${r.flags.join(',')}`,
      `source_url=${r.source_url ?? '?'}`,
      `owner=${r.owner ?? '?'}`,
      `layer=${r.layer ?? '?'}`,
    ].join('\t'),
  );
}
