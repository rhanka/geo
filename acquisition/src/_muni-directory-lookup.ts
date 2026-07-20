/**
 * _muni-directory-lookup.ts — sonde READ-ONLY $0, gate HOMONYME.
 *
 * La lane provenance-règlement a mesuré trois contaminations où un slug portait le
 * règlement de sa municipalité HOMONYME (notre-dame-de-lourdes--lerable, les-hauteurs,
 * notre-dame-du-bon-conseil--drummond). Le test décisif est toujours le même: comparer
 * ce que dit le DOCUMENT (désignation « Ville » / « Canton » / « Paroisse », MRC, site
 * officiel) avec ce que l'annuaire municipal attache au SLUG.
 *
 * Cette sonde imprime, pour chaque motif de nom, toutes les entrées de
 * `packages/qc-sources/src/geo/qc-municipal-directory.json` avec leurs champs
 * distinctifs (code géographique, désignation, MRC, site web) — de quoi trancher sans
 * ouvrir un navigateur.
 *
 * ANTI-INVENTION: n'écrit rien, ne décide rien.
 *
 * Usage (repo root):
 *   npx tsx acquisition/src/_muni-directory-lookup.ts --match stanstead
 *   npx tsx acquisition/src/_muni-directory-lookup.ts --match sainte-felicite,saint-alexandre
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = resolve(ROOT, 'packages', 'qc-sources', 'src', 'geo', 'qc-municipal-directory.json');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function main(): void {
  const patterns = (arg('match') ?? '')
    .split(',')
    .map((s) => fold(s.trim()))
    .filter(Boolean);
  if (!patterns.length) {
    console.error('usage: --match <motif[,motif...]>');
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(DIR, 'utf8')) as unknown;
  // L'annuaire peut être un tableau ou un objet indexé; on aplatit dans les deux cas.
  // Forme réelle: { $schema, generatedAt, source, stats, entries: { <slug>: {...} } }.
  const bag = Array.isArray(raw) ? raw : ((raw as Record<string, unknown>).entries ?? raw);
  const rows: Array<Record<string, unknown>> = Array.isArray(bag)
    ? (bag as Array<Record<string, unknown>>)
    : Object.entries(bag as Record<string, unknown>).flatMap(([k, v]) =>
        v && typeof v === 'object' ? [{ _key: k, ...(v as Record<string, unknown>) }] : [],
      );
  console.log(`# annuaire: ${rows.length} entrées — ${DIR}`);
  for (const p of patterns) {
    console.log(`\n## match «${p}»`);
    let n = 0;
    for (const r of rows) {
      const hay = fold(JSON.stringify(Object.values(r).filter((v) => typeof v === 'string').join(' ')));
      if (!hay.includes(p)) continue;
      n += 1;
      console.log(JSON.stringify(r));
    }
    if (!n) console.log('  (aucune entrée)');
  }
}

main();
