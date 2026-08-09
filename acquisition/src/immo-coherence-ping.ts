#!/usr/bin/env npx tsx
/**
 * immo-coherence-ping — assemble les lignes PING-IMMO de la mission
 * "cohérence zone↔grille des villes prioritaires IMMO".
 *
 * Lit UNIQUEMENT des artefacts déjà produits (aucun appel réseau, aucun dépôt) :
 *   - work/coverage/zone-grille-coherence.json  (gate live : codes, flags, provenance)
 *   - work/coverage/immo-lots.json              (fold normes par muni)
 * et émet une ligne PING-IMMO par slug de la liste-priorité IMMO.
 *
 * usage:
 *   npx tsx acquisition/src/immo-coherence-ping.ts [--slugs a,b,c] [--keys]
 *   --keys : dump les clés d'une row du gate (introspection de schéma)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '../..');
const GATE = resolve(REPO, 'work/coverage/zone-grille-coherence.json');
const LOTS = resolve(REPO, 'work/coverage/immo-lots.json');

/** Liste-priorité IMMO (P0→P3), ordre = autorité du brief immo. */
const IMMO_PRIORITY = [
  'mont-tremblant',
  'saint-mathieu-de-beloeil',
  'rosemere',
  'plaisance',
  'hemmingford--les-jardins-de-napierville--2',
  'saint-charles-borromee',
  'sutton',
  'saint-frederic',
  'champlain',
  'coaticook',
  'petite-riviere-saint-francois',
  'notre-dame-de-lourdes--lerable',
  'alma',
  'saint-boniface',
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const gate = JSON.parse(readFileSync(GATE, 'utf8'));

if (process.argv.includes('--keys')) {
  const first = Object.keys(gate.rows)[0];
  const row = gate.rows[first];
  console.log(`# row schema (slug=${first})`);
  for (const [k, v] of Object.entries(row)) {
    const kind = Array.isArray(v) ? `array[${v.length}]` : v === null ? 'null' : typeof v;
    const peek = Array.isArray(v) ? JSON.stringify(v.slice(0, 3)) : JSON.stringify(v);
    console.log(`  ${k.padEnd(28)} ${kind.padEnd(12)} ${String(peek).slice(0, 90)}`);
  }
  process.exit(0);
}

/**
 * fold normes par slug depuis immo-lots.json (perMuni[].fieldPct['folded-normes']),
 * même lecture que lots-normes-pct-report.ts. Artefact daté : le header rappelle
 * son generatedAt pour que le lecteur juge la fraîcheur.
 */
const lotsData = JSON.parse(readFileSync(LOTS, 'utf8')) as {
  generatedAt?: string;
  perMuni?: Array<{
    slug: string;
    numLots: number;
    normesStatus?: string;
    fieldPct?: Record<string, number>;
    fieldNum?: Record<string, number>;
  }>;
};

const folds = new Map(
  (lotsData.perMuni ?? []).map((m) => [
    m.slug,
    { pct: m.fieldPct?.['folded-normes'] ?? 0, lots: m.numLots, status: m.normesStatus ?? '?' },
  ]),
);
const slugs = (arg('--slugs')?.split(',') ?? IMMO_PRIORITY).map((s) => s.trim());

console.log(`# gate generated_at=${gate.generated_at} decision_overlap=${gate.decision_overlap}`);
console.log(`# fold source=work/coverage/immo-lots.json generatedAt=${lotsData.generatedAt ?? '?'}`);

for (const slug of slugs) {
  const row = gate.rows?.[slug];
  if (!row) {
    console.log(`PING-IMMO slug=${slug} action=ABSENT-DU-GATE`);
    continue;
  }
  // Anti-invention : on NE recalcule PAS l'intersection ici. Le gate aligne les formes
  // (canon Lettre-Num vs raw SIG : cf. alma codes_grille=["1","106"] ↔ communs=["AA-1"]),
  // donc une intersection naïve rendrait un faux 0%. `communs`/`recouvrement_strict` du
  // gate sont l'autorité.
  const cz: string[] = row.codes_zone ?? [];
  const cg: string[] = row.codes_grille ?? [];
  const communs = (row.communs ?? []).length;
  const rec = 100 * (row.recouvrement_strict ?? row.recouvrement ?? 0);
  const f = folds.get(slug);
  const flags = (row.flags ?? []).join('+') || 'none';
  console.log(
    [
      `PING-IMMO slug=${slug}`,
      `flags=${flags}`,
      `codes_zone=${cz.length}`,
      `codes_grille=${cg.length}`,
      `communs=${communs}`,
      `recouvrement=${rec.toFixed(2)}%`,
      `source_url=${row.source_url ?? '-'}`,
      `owner=${row.owner ?? '-'}`,
      `layer=${row.layer ?? '-'}`,
      `champ_code=${row.champ_code ?? row.code_field ?? '-'}`,
      `lots_normes_pct=${f ? f.pct.toFixed(2) : 'ABSENT'}`,
      `real_zoning=${row.real_zoning}`,
    ].join(' '),
  );
}
