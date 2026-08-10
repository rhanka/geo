#!/usr/bin/env node
// Lecteur RÉSOLU d'une matrice palier (palier-matrix-30x167-YYYYMMDD.json).
// Capitalise la définition owner du KPI de synthèse « résolu » (cf. owner_target :
// « CIBLE = 100%-RÉSOLU sur les 20 KPI (0 unknown : complete OU N-A prouvé) »).
//
// RÉSOLU (cellule) = complete OU N-A prouvé. incomplete et unknown NE sont PAS résolus.
// RÉSOLU (global) = Σ(complete + N-A) / Σ(applicable) sur les 20 KPI, chaque KPI
// compté sur SON dénominateur (colonnes dérivées graphe = villes matchées ; colonnes
// immo per-slug `slug_measured` = cohorte entière) — exactement les `per_kpi.counts`
// que le générateur ferme déjà. N'invente rien : lit les compteurs committés.
//
// Usage :
//   node scripts/palier-matrix-resolved.mjs work/coverage/palier-matrix-30x167-YYYYMMDD.json
//   node scripts/palier-matrix-resolved.mjs <new.json> <old.json>   # + Δ résolu
import fs from 'node:fs';

function metrics(path) {
  const p = JSON.parse(fs.readFileSync(path, 'utf8'));
  const acc = { complete: 0, incomplete: 0, unknown: 0, 'N-A': 0 };
  let cellsGraphMatched = 0, cellsImmo = 0;
  for (const k of p.per_kpi) {
    for (const s of ['complete', 'incomplete', 'unknown', 'N-A']) acc[s] += k.counts[s];
    if (k.slug_measured) cellsImmo += k.denom; else cellsGraphMatched += k.denom;
  }
  const applicable = acc.complete + acc.incomplete + acc.unknown + acc['N-A'];
  const resolved = acc.complete + acc['N-A'];
  const present = acc.complete + acc.incomplete + acc['N-A']; // non-unknown (hors strict PV, approximation de présence cellulaire)
  return {
    path, reportDate: p.reportDate, prev: p.previousSnapshotDate,
    cells: applicable, counts: acc,
    resolved, resolved_pct: Math.round((resolved / applicable) * 1000) / 10,
    present, present_pct: Math.round((present / applicable) * 1000) / 10,
    gate_full_presence: `${p.presence_gate.cities_full_presence}/${p.presence_gate.cities_scored}`,
    gate_full_completion: `${p.presence_gate.cities_full_completion}/${p.presence_gate.cities_scored}`,
  };
}

function print(m) {
  console.log(`# ${m.path}`);
  console.log(`  date=${m.reportDate} (prev ${m.prev ?? '—'}) · cellules applicables=${m.cells}`);
  console.log(`  complete=${m.counts.complete} incomplete=${m.counts.incomplete} unknown=${m.counts.unknown} N-A=${m.counts['N-A']}`);
  console.log(`  RÉSOLU (complete+N-A) = ${m.resolved}/${m.cells} = ${m.resolved_pct}%`);
  console.log(`  présence cellulaire (non-unknown) = ${m.present_pct}%`);
  console.log(`  gate villes présence complète = ${m.gate_full_presence} · complétion complète = ${m.gate_full_completion}`);
}

const [a, b] = process.argv.slice(2);
if (!a) { console.error('usage: palier-matrix-resolved.mjs <matrix.json> [<old.json>]'); process.exit(1); }
const mNew = metrics(a);
print(mNew);
if (b) {
  const mOld = metrics(b);
  console.log('');
  print(mOld);
  const d = Math.round((mNew.resolved_pct - mOld.resolved_pct) * 10) / 10;
  console.log('');
  console.log(`Δ RÉSOLU = ${d >= 0 ? '+' : ''}${d} pts (${mOld.resolved_pct}% → ${mNew.resolved_pct}%)`);
}
