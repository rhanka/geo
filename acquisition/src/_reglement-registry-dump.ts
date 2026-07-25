/**
 * _reglement-registry-dump.ts — lane P0_1 (provenance règlement).
 *
 * READ-ONLY. Affiche les entrées curées du registre reglement-provenance.json
 * pour une liste de slugs, afin de lire le `_note` (jugement vs fait mesurable)
 * AVANT de re-qualifier un HOLD-NULL. Mémoire note-premisse-mesurable-vs-jugement:
 * un _note qui est un JUGEMENT (« l'URL était une grille ») se re-mesure à $0;
 * un _note qui est un FAIT mesuré (« PDF lu en entier, aucun numéro ») est terminal.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-registry-dump.ts slug1 slug2 ...
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
  slugs: Record<string, Record<string, unknown>>;
};

const slugs = process.argv.slice(2);
for (const s of slugs) {
  const e = registry.slugs[s];
  console.log(`=== ${s} ===`);
  console.log(e ? JSON.stringify(e, null, 1) : '(absent du registre)');
}
