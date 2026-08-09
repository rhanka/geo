/**
 * _reglement-prov-universe-gap.ts — lane P0_1 (provenance règlement).
 *
 * READ-ONLY. Mesure l'ÉCART entre les deux dénominateurs de la lane, qui ne sont
 * PAS le même univers et que les briefs confondent régulièrement :
 *
 *   A) `zonage-enrichment.json` perMuni {served, reglement}  → ce que le fold peut
 *      estampiller AUJOURD'HUI (un polygone servi existe).
 *   B) `registry/qc-zonage-norms/manifest.json`              → les grilles de normes
 *      minées, dont beaucoup n'ont PAS (encore) de polygone de zonage servi.
 *
 * Le brief « 483 grilles ont une URL source sans numéro » parle de (B) ; le sélecteur
 * `_reglement-provenance-targets.ts` travaille sur (A ∩ registre). Cette sonde imprime
 * les deux et surtout **B \ A** = les slugs où écrire une entrée de registre est
 * durable mais NON servable tout de suite (goulot ZONES, pas goulot provenance).
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-prov-universe-gap.ts
 *   npx tsx acquisition/src/_reglement-prov-universe-gap.ts --shard 1/2 --list
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENRICH = resolve(ROOT, 'work', 'coverage', 'zonage-enrichment.json');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');
/** Le manifest des grilles de normes ne vit PAS sous `registry/` (ce dossier n'existe
 *  pas dans ce dépôt) : c'est `work/zonage-norms/manifest-current.json`, un TABLEAU
 *  d'entrées `{slug, present, source_url, reglement, …}`. L'ancien chemin rendait
 *  silencieusement `entrées=0`, donc « B∩A = 0 » était un FAUX ZÉRO. */
const MANIFEST = resolve(ROOT, 'work', 'zonage-norms', 'manifest-current.json');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const LIST = process.argv.includes('--list');

/** Même discriminant que le sélecteur de cibles: le manifest porte des sentinelles
 *  texte ET la sentinelle schémée `https://non-disponible` (pas de point dans l'hôte). */
function httpUrl(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    const h = new URL(v).hostname;
    return h.includes('.') ? v : null;
  } catch {
    return null;
  }
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
// Le registre curé est `{ slugs: { <slug>: {...} } }` (cf. fold-reglement-to-zonage.ts,
// `cfg.slugs[slug]`). Lire `registry.munis ?? registry` itérait la clé `slugs` elle-même
// => curedNum=0 / curedNull=1, donc le filtre `actionable` ne retirait AUCUN slug déjà tranché.
const regEntries: Record<string, any> = registry.slugs ?? registry.munis ?? registry;
const curedNum = new Set<string>();
const curedNull = new Set<string>();
for (const [slug, e] of Object.entries(regEntries)) {
  if (!e || typeof e !== 'object') continue;
  if ((e as any).reglement_numero) curedNum.add(slug);
  else curedNull.add(slug);
}

const manifest = readJson(MANIFEST) ?? {};
const manEntries: any[] = Array.isArray(manifest)
  ? manifest
  : (manifest.entries ?? manifest.munis ?? Object.values(manifest));
const manUrl = new Map<string, string>();
for (const e of manEntries) {
  const slug = e?.slug ?? e?.muni ?? e?.municipality;
  if (!slug) continue;
  const u = httpUrl(e?.source_url ?? e?.reglement_url ?? e?._source_url);
  if (u) manUrl.set(slug, u);
}

console.log(`# A) zonage-enrichment: perMuni=${perMuni.length} served=${served.size} reglement=${withRegl.size}`);
console.log(`#    served && !reglement = ${[...served].filter((s) => !withRegl.has(s)).length}`);
console.log(`# B) manifest qc-zonage-norms: entrées=${manEntries.length} avec URL http réelle=${manUrl.size}`);
console.log(`# registre: numéro=${curedNum.size} null-curé=${curedNull.size}`);

// B \ A : URL de grille connue, aucun polygone servi -> registre durable, fold muet.
const bNotServed = [...manUrl.keys()].filter((s) => !served.has(s)).sort();
// … dont ceux qu'AUCUN curateur n'a encore tranchés : le seul travail NEUF de la lane
// quand `B∩A` est vide. L'entrée de registre y est durable (le fold la servira dès que
// le polygone de zonage arrivera), mais elle ne change rien aujourd'hui.
const bNotServedUntriaged = bNotServed.filter((s) => !curedNum.has(s) && !curedNull.has(s));
// B ∩ A sans numéro ni verdict : le vrai gisement servable.
const actionable = [...manUrl.keys()]
  .filter((s) => served.has(s) && !withRegl.has(s) && !curedNum.has(s) && !curedNull.has(s))
  .sort();

console.log(`# B\\A (URL connue, NON servi -> goulot ZONES) = ${bNotServed.length}`);
console.log(`#    dont JAMAIS tranchés (travail neuf, durable mais non servable) = ${bNotServedUntriaged.length}`);
console.log(`# B∩A non tranché (gisement servable) = ${actionable.length}`);

const sh = arg('shard');
function shardOf(list: string[]): string[] {
  if (!sh) return list;
  const [i, n] = sh.split('/').map(Number);
  return list.filter((_, idx) => idx % n === i);
}

// B\A AVEC numéro déjà curé : rien à LIRE, tout à SERVIR le jour où ZONES livre.
// `served` vient de zonage-enrichment.json, un cache qui ment PAR RETARD
// (cf. zonage-enrichment-cache-gisement-fantome) : ces slugs sont donc les
// candidats à re-passer au `fold --dry-run`, seul juge qui interroge le servi.
const bNotServedCured = bNotServed.filter((s) => curedNum.has(s));
console.log(`#    dont numéro DÉJÀ curé (attente ZONES -> re-tester au fold) = ${bNotServedCured.length}`);

if (LIST) {
  console.log('\n## gisement servable non tranché');
  for (const s of shardOf(actionable)) console.log(`${s}\t${manUrl.get(s)}`);
  console.log('\n## B\\A JAMAIS tranchés (registre durable, fold muet)');
  for (const s of shardOf(bNotServedUntriaged)) console.log(`${s}\t${manUrl.get(s)}`);
  console.log('\n## B\\A numéro curé (re-tester au fold: ZONES a pu livrer depuis)');
  for (const s of shardOf(bNotServedCured)) {
    console.log(`${s}\t${(regEntries as any)[s]?.reglement_numero ?? '?'}`);
  }
}
