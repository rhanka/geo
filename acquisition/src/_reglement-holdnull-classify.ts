/**
 * _reglement-holdnull-classify.ts — lane P0_1 (provenance règlement).
 *
 * READ-ONLY. Pour les slugs d'un shard donné, lit le registre curé et classe les
 * HOLD-NULL (numero===null) selon que leur `_note` décrit un blocage RE-MESURABLE
 * à $0 (hôte injoignable / lien 404 / re-découverte d'URL) ou un fait TERMINAL
 * (mauvais doc homonyme / projet non adopté / annexe muette lue en entier).
 *
 * Mémoire: reglement-holdnull-requalifiable + note-premisse-mesurable-vs-jugement.
 *
 * L'univers de cibles et le sharding sont IDENTIQUES à _reglement-provenance-targets.ts
 * (served && !reglement, trié par slug, idx % n == i) pour rester alignés.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-holdnull-classify.ts --shard 1/2
 *   npx tsx acquisition/src/_reglement-holdnull-classify.ts --shard 1/2 --remeasurable
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENRICH = resolve(ROOT, 'work', 'coverage', 'zonage-enrichment.json');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

interface Muni {
  slug: string;
  served?: boolean;
  reglement?: boolean;
}

// Signatures de blocage RE-MESURABLES à $0 (le fait sous-jacent peut avoir changé:
// un hôte qui répondait 000/404 peut répondre 200 maintenant, une URL peut être
// re-découverte). On ne les tient PAS pour terminaux.
const REMEASURABLE = [
  /INJOIGNABLE/i,
  /LIEN MORT/i,
  /HTTP 404/i,
  /http=000/i,
  /re-?essai/i,
  /re-?d[ée]couverte/i,
  /panne d'h[ôo]te/i,
  /timeout/i,
];

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
  slugs: Record<string, { reglement_numero?: unknown; _note?: string }>;
};
const enrich = JSON.parse(readFileSync(ENRICH, 'utf8')) as { perMuni: Muni[] };

const shardSpec = arg('shard');
const onlyRemeasurable = process.argv.includes('--remeasurable');

const targets = enrich.perMuni
  .filter((m) => m.served === true && m.reglement === false)
  .map((m) => m.slug)
  .sort();

let mine = targets;
if (shardSpec) {
  const [i, n] = shardSpec.split('/').map(Number);
  mine = targets.filter((_, idx) => idx % n === i);
}

let remeasurable = 0;
let terminal = 0;
for (const slug of mine) {
  const e = registry.slugs[slug];
  if (!e || e.reglement_numero) continue; // pas HOLD-NULL
  const note = e._note ?? '';
  const isRe = REMEASURABLE.some((rx) => rx.test(note));
  if (isRe) remeasurable++;
  else terminal++;
  if (onlyRemeasurable && !isRe) continue;
  const tag = isRe ? 'REMEASURE' : 'terminal ';
  console.log(`${tag}\t${slug}\t${note.slice(0, 140).replace(/\s+/g, ' ')}`);
}
console.log(`# shard=${shardSpec ?? 'all'} holdnull remeasurable=${remeasurable} terminal=${terminal}`);
