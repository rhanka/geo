#!/usr/bin/env node
// Rollup RÉSOLU du palier — dérive un scalaire reproductible de la matrice palier
// committée, pour arrêter de calculer « résolu X→Y% » à la main dans les messages
// de commit (non rejouable, donc invérifiable — principe fondateur).
//
// RÉSOLU (définition owner) = une cellule KPI est résolue ssi `complete` OU
// `N-A prouvé` (0 unknown, 0 incomplete). Le dénominateur est l'ensemble des
// cellules APPLICABLES = complete+incomplete+unknown+N-A, avec les MÊMES portées
// que le générateur (per_kpi : colonnes graphe sur les villes matchées, colonnes
// immo per-slug sur la cohorte entière). On NE recalcule rien : on somme les
// `per_kpi[].counts` déjà fermés et validés par le générateur.
//
// Usage :
//   node scripts/palier-resolu-rollup.mjs [chemin-matrice.json]
//   (défaut : dernière work/coverage/palier-matrix-30x167-YYYYMMDD.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COV = path.join(ROOT, 'work', 'coverage');

function latestMatrix() {
  if (!fs.existsSync(COV)) return null;
  const hits = fs.readdirSync(COV).filter((f) => /^palier-matrix-30x167-\d{8}\.json$/.test(f)).sort();
  return hits.length ? path.join(COV, hits[hits.length - 1]) : null;
}

function rollup(p) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(j.per_kpi)) throw new Error(`per_kpi absent : ${p}`);
  let resolved = 0, applicable = 0, complete = 0, na = 0, incomplete = 0, unknown = 0;
  for (const k of j.per_kpi) {
    const c = k.counts || {};
    complete += c.complete || 0;
    incomplete += c.incomplete || 0;
    unknown += c.unknown || 0;
    na += c['N-A'] || 0;
  }
  applicable = complete + incomplete + unknown + na; // N-A DANS le dénominateur : une cellule N-A prouvée est RÉSOLUE, pas hors-champ
  resolved = complete + na;
  return {
    file: path.relative(ROOT, p), reportDate: j.reportDate ?? null,
    cells: { complete, incomplete, unknown, na, applicable },
    resolved, resolved_pct: applicable ? Math.round((resolved / applicable) * 1000) / 10 : null,
  };
}

function main() {
  const arg = process.argv[2];
  const p = arg ? path.resolve(ROOT, arg) : latestMatrix();
  if (!p || !fs.existsSync(p)) { console.error('matrice introuvable'); process.exit(1); }
  const r = rollup(p);
  console.log(JSON.stringify(r, null, 2));
  console.log(`\nRÉSOLU ${r.resolved}/${r.cells.applicable} cellules = ${r.resolved_pct}%  (complete ${r.cells.complete} + N-A ${r.cells.na})`);
}
main();
