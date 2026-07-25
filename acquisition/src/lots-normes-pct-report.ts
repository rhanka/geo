#!/usr/bin/env -S npx tsx
/**
 * lots-normes-pct-report — lit work/coverage/immo-lots.json (perMuni) et rapporte
 * le taux de lots portant des normes zonage foldées (champ folded-normes) pour
 * une liste de slugs. Sert la métrique lots_normes_pct des rapports PING-IMMO.
 *
 * Usage: npx tsx acquisition/src/lots-normes-pct-report.ts --slugs a,b,c
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

if (slugs.length === 0) {
  console.error('usage: --slugs slug1,slug2,...');
  process.exit(1);
}

const path = arg('--file') ?? resolve(process.cwd(), 'work/coverage/immo-lots.json');
const data = JSON.parse(readFileSync(path, 'utf8')) as {
  generatedAt?: string;
  perMuni?: Array<{
    slug: string;
    numLots: number;
    normesStatus?: string;
    fieldPct?: Record<string, number>;
    fieldNum?: Record<string, number>;
  }>;
};

const byslug = new Map((data.perMuni ?? []).map((m) => [m.slug, m]));
console.log(`# source=${path} generatedAt=${data.generatedAt ?? '?'}`);
for (const slug of slugs) {
  const m = byslug.get(slug);
  if (!m) {
    console.log(`${slug}\tABSENT`);
    continue;
  }
  const pct = m.fieldPct?.['folded-normes'] ?? 0;
  const num = m.fieldNum?.['folded-normes'] ?? 0;
  console.log(
    `${slug}\tlots=${m.numLots}\tfolded_normes_pct=${pct}\tfolded_normes_n=${num}\tnormesStatus=${m.normesStatus ?? '?'}`,
  );
}
