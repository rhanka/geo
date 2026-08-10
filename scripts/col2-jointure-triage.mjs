#!/usr/bin/env node
/**
 * col2-jointure-triage.mjs
 * COL2-JOINTURE-TRIAGE — classification 121 villes incomplete lot-zone,
 * identification 31 prioritaires pour la lane jointures.
 *
 * Usage: node scripts/col2-jointure-triage.mjs
 * Output: work/coverage/col2-jointure-triage-20260807.json
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const SOURCE_REF = '9995acf1:work/coverage/lot-zone-consistency-scale-20260725.json';
const OUT_PATH = resolve(ROOT, 'work/coverage/col2-jointure-triage-20260807.json');

// ── Read source from git history ────────────────────────────────────────────
const raw = execSync(`git show ${SOURCE_REF}`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
const data = JSON.parse(raw.toString('utf8'));
const cities = data.cities;

// ── Filter: mismatch_pct ≥ 5% ───────────────────────────────────────────────
const high = cities.filter(c => c.mismatch_pct != null && c.mismatch_pct >= 5);
console.error(`Cities with mismatch_pct >= 5%: ${high.length}`);

// ── Classification ───────────────────────────────────────────────────────────
/**
 * @param {{ assigned: number; misassigned: number; outside_all: number }} c
 * @returns {{ categorie: string; levier: string }}
 */
function classify(c) {
  const { assigned, misassigned, outside_all } = c;

  if (assigned <= 5) {
    return { categorie: 'trivial_sample', levier: 'bruit_statistique' };
  }

  if (misassigned > 0 && outside_all > 0) {
    const ratio = misassigned / outside_all;
    if (ratio >= 3)   return { categorie: 'misassigned_dominant', levier: 'jointure-lane' };
    if (ratio <= 0.33) return { categorie: 'outside_all_dominant', levier: 'jointure-lane' };
    return { categorie: 'mixed', levier: 'jointure-lane' };
  }
  if (misassigned > 0 && outside_all === 0) return { categorie: 'misassigned_dominant', levier: 'jointure-lane' };
  if (outside_all > 0 && misassigned === 0) return { categorie: 'outside_all_dominant', levier: 'jointure-lane' };
  return { categorie: 'mixed', levier: 'jointure-lane' };
}

// ── Build classified list with mismatch_volume ───────────────────────────────
const allClassified = high.map(c => {
  const { categorie, levier } = classify(c);
  return {
    slug: c.slug,
    mismatch_pct: c.mismatch_pct,
    assigned: c.assigned,
    misassigned: c.misassigned,
    outside_all: c.outside_all,
    categorie,
    levier,
    _vol: c.misassigned + c.outside_all,
  };
});

// ── Select prioritaires: top 31 by mismatch_volume, assigned >= 100, non-trivial
const byVolume = [...allClassified].sort((a, b) => b._vol - a._vol);
const actionable = byVolume.filter(e => e.assigned >= 100 && e.categorie !== 'trivial_sample');
console.error(`Actionable (assigned>=100, non-trivial): ${actionable.length}`);

const prioSlugs = new Set(actionable.slice(0, 31).map(e => e.slug));

const prio = [];
const autres = [];
for (const e of allClassified) {
  // eslint-disable-next-line no-unused-vars
  const { _vol, ...entry } = e;
  if (prioSlugs.has(e.slug)) prio.push(entry);
  else autres.push(entry);
}

// Sort prioritaires and autres by mismatch_pct desc
prio.sort((a, b) => b.mismatch_pct - a.mismatch_pct);
autres.sort((a, b) => b.mismatch_pct - a.mismatch_pct);

// ── Category counters ────────────────────────────────────────────────────────
function countCats(arr) {
  const acc = {};
  for (const e of arr) acc[e.categorie] = (acc[e.categorie] || 0) + 1;
  return acc;
}

const catsAll   = countCats(allClassified);
const catsPrio  = countCats(prio);
const catsAutres = countCats(autres);

// ── Build output ─────────────────────────────────────────────────────────────
const output = {
  $meta: {
    contract: 'COL2-JOINTURE-TRIAGE-v1',
    generated_at: '2026-08-07T00:00:00Z',
    source: 'work/coverage/lot-zone-consistency-scale-20260725.json',
    source_commit: '9995acf1',
    method: {
      kpi_threshold: 'mismatch_pct >= 5% => incomplete col-2',
      classification_rules: {
        trivial_sample: 'assigned <= 5 lots — bruit statistique, conclusion fragile',
        misassigned_dominant:
          'misassigned/outside_all >= 3 OU outside_all=0 — lot dans autre zone — revision jointure ou zones chevauchantes — levier: jointure-lane',
        outside_all_dominant:
          'misassigned/outside_all <= 0.33 OU misassigned=0 — lot hors toute zone — probleme geometrie/CRS/offset — levier: jointure-lane',
        mixed:
          'ratio misassigned/outside_all entre 0.33 et 3 — cause mixte — levier: jointure-lane',
      },
      prioritaire_selection:
        'Top 31 par mismatch_volume (misassigned+outside_all absolus) parmi villes avec assigned >= 100 et categorie != trivial_sample',
      levier_jointure_lane_actions: [
        'correction geometrie zones incorrecte',
        'correction CRS mismatch',
        'correction offset geographique',
        'revision jointure lot-zone (zones chevauchantes)',
        'revision classification code_zone',
      ],
    },
  },
  summary: {
    total_incomplete: allClassified.length,
    prioritaire_count: prio.length,
    autres_count: autres.length,
    selection_basis:
      'top 31 par volume de lots en mismatch (misassigned + outside_all), assigned >= 100',
    partition_by_categorie_all_121: catsAll,
    partition_by_categorie_prioritaires_31: catsPrio,
    partition_by_categorie_autres_90: catsAutres,
  },
  cities_prioritaires: prio,
  cities_autres: autres,
};

// ── Write output ─────────────────────────────────────────────────────────────
writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.error(`Written: ${OUT_PATH}`);
console.error(`Prioritaires: ${prio.length}`);
console.error(`Autres: ${autres.length}`);
console.error(`Cats all:   ${JSON.stringify(catsAll)}`);
console.error(`Cats prio:  ${JSON.stringify(catsPrio)}`);
console.error(`Cats autres:${JSON.stringify(catsAutres)}`);
console.error('Done.');
