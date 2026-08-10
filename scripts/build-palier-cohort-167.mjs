#!/usr/bin/env node
// Dérive le fichier cohorte du palier (167 villes) depuis le TSV canonique
// set-167-bprime.tsv (i-cond), lu en LECTURE SEULE depuis le dépôt radar au ref
// épinglé — même provenance que le compteur aboutir-167. Sortie committée =
// l'input reproductible du générateur palier-matrix-report.mjs.
//
// Anti-invention : slug/priorityRank VERBATIM du TSV ; graph_matched dérivé de
// la colonne `match` (UNMATCHED -> PENDING-GRAPH-NODE) ; rien de fabriqué.
//
// Usage : node scripts/build-palier-cohort-167.mjs [--ref=<gitref>] [--out=<path>]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RADAR = '/home/antoinefa/src/radar-immobilier';
const opt = (n, d = null) => {
  const p = `--${n}=`;
  const v = process.argv.slice(2).find((a) => a.startsWith(p));
  return v === undefined ? d : v.slice(p.length);
};
const REF = opt('ref', '800ee90');
const TSV_PATH = 'docs/spec/reports/set-167-bprime.tsv';
const OUT = resolve(ROOT, opt('out', 'work/coverage/palier-matrix-cohort-167.json'));

const tsv = execFileSync('git', ['show', `${REF}:${TSV_PATH}`], { cwd: RADAR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lines = tsv.split('\n').filter((l) => l.length > 0 && !l.startsWith('#'));
const header = lines[0].split('\t');
const iSlug = header.indexOf('slug');
const iRank = header.indexOf('priorityRank');
const iMatch = header.indexOf('match');
if (iSlug < 0 || iRank < 0 || iMatch < 0) throw new Error(`en-tête TSV inattendu: ${header.join('|')}`);

const cities = lines.slice(1).map((line) => {
  const c = line.split('\t');
  const slug = c[iSlug];
  const rank = Number(c[iRank]);
  const match = c[iMatch];
  if (!slug || !Number.isInteger(rank)) throw new Error(`ligne TSV invalide: ${line}`);
  const matched = match !== 'UNMATCHED';
  return { priorityRank: rank, slug, graph_matched: matched, ...(matched ? {} : { flag: 'PENDING-GRAPH-NODE' }) };
}).sort((a, b) => a.priorityRank - b.priorityRank);

const ranks = new Set(cities.map((c) => c.priorityRank));
if (ranks.size !== cities.length) throw new Error('priorityRank dupliqués dans le TSV');

const out = {
  contract: 'city-kpi-matrix-slug-cohort/v1',
  cohort: 'set-167-bprime',
  source: `radar ${REF}:${TSV_PATH} (i-cond, canonique priorityRank<=167 figé 2026-08-02) — slug/priorityRank VERBATIM, graph_matched dérivé de match!=UNMATCHED`,
  note: `${cities.length} villes ; ${cities.filter((c) => !c.graph_matched).length} PENDING-GRAPH-NODE. La vue 30 = priorityRank<=30.`,
  cities,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ out: OUT.replace(ROOT + '/', ''), cities: cities.length, pending: cities.filter((c) => !c.graph_matched).length, ranks: `${Math.min(...ranks)}..${Math.max(...ranks)}` }, null, 2));
