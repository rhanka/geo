/**
 * _reglement-prov-fold-lag.ts — lane P0_1 (provenance règlement).
 *
 * READ-ONLY. Comble l'angle mort de `_reglement-prov-universe-gap.ts`, qui EXCLUT
 * de son « gisement servable » tout slug déjà présent au registre (`curedNum`).
 * Or il existe une 3e population, mesurée au moins une fois (`matapedia`, passe
 * 2026-07-19) :
 *
 *   served && !reglement && curedNum
 *   = « le polygone existe, le numéro est curé, mais la ville n'affiche RIEN »
 *
 * Deux causes possibles, que seul `fold --dry-run` distingue :
 *   (a) `zonage-enrichment.json` MENT PAR RETARD (le fold a déjà tourné) -> cellsChanged=0 ;
 *   (b) le fold n'a JAMAIS tourné pour ce slug -> cellsChanged>0 = win $0 immédiat.
 *
 * Cette sonde n'imprime QUE la liste des candidats (cause indéterminée) ; c'est
 * `fold --dry-run` qui tranche. Ne jamais conclure « à faire » depuis ce fichier seul
 * (mémoire zonage-enrichment-cache-gisement-fantome).
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-prov-fold-lag.ts
 *   npx tsx acquisition/src/_reglement-prov-fold-lag.ts --shard 1/2
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENRICH = resolve(ROOT, 'work', 'coverage', 'zonage-enrichment.json');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function readJson(p: string): any {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

const enrich = readJson(ENRICH) ?? {};
const perMuni: any[] = enrich.perMuni ?? enrich.munis ?? [];
const served = new Set<string>();
const withRegl = new Set<string>();
for (const m of perMuni) {
  if (m?.served) served.add(m.slug);
  if (m?.reglement) withRegl.add(m.slug);
}

const registry = readJson(REGISTRY) ?? {};
const regEntries: Record<string, any> = registry.slugs ?? registry.munis ?? registry;
const curedNum = new Map<string, any>();
const curedNull = new Set<string>();
for (const [slug, e] of Object.entries(regEntries)) {
  if (!e || typeof e !== 'object') continue;
  if ((e as any).reglement_numero) curedNum.set(slug, e);
  else curedNull.add(slug);
}

const gap = [...served].filter((s) => !withRegl.has(s)).sort();
const foldLag = gap.filter((s) => curedNum.has(s));
const gapNull = gap.filter((s) => curedNull.has(s));
const gapUntriaged = gap.filter((s) => !curedNum.has(s) && !curedNull.has(s));

console.log(`# served=${served.size} reglement=${withRegl.size} -> gap(served && !reglement)=${gap.length}`);
console.log(`#   dont numéro AU REGISTRE (fold en retard OU enrichment périmé) = ${foldLag.length}`);
console.log(`#   dont null CURÉ (verdict documenté, rien à faire)              = ${gapNull.length}`);
console.log(`#   dont JAMAIS tranché (travail neuf servable)                   = ${gapUntriaged.length}`);

const sh = arg('shard');
function shardOf(list: string[]): string[] {
  if (!sh) return list;
  const [i, n] = sh.split('/').map(Number);
  return list.filter((_, idx) => idx % n === i);
}

console.log('\n## candidats fold-lag (trancher par `fold --dry-run`)');
for (const s of shardOf(foldLag)) {
  const e = curedNum.get(s);
  console.log(`${s}\t${e.reglement_numero}\t${e.reglement_millesime ?? 'null'}`);
}
console.log('\n## jamais tranchés (servables)');
for (const s of shardOf(gapUntriaged)) console.log(s);

// Les nulls CURÉS ne sont pas des abandons : chacun porte un critère de réouverture.
// Les relire à chaque passe est le seul moyen d'attraper ceux devenus MESURABLES
// (mémoire note-premisse-mesurable-vs-jugement / reglement-holdnull-requalifiable).
console.log('\n## null CURÉ (relire le critère de réouverture)');
for (const s of shardOf(gapNull)) {
  const note = String((regEntries as any)[s]?._note ?? '').replace(/\s+/g, ' ').slice(0, 160);
  console.log(`${s}\t${note}`);
}
