/**
 * _reglement-notes-dump.ts — lane P0_1 (provenance règlement), READ-ONLY.
 *
 * Affiche num/millésime/_note du registre curé pour les slugs passés en argv.
 * Sert à trier les HOLD-NULL: verdict mince (URL / mauvais PDF) = re-qualifiable,
 * verdict « grille lue, ne nomme pas de règlement » = épuisé.
 *
 * Usage: npx tsx acquisition/src/_reglement-notes-dump.ts saint-aime tingwick ...
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');

const reg = (JSON.parse(readFileSync(REGISTRY, 'utf8')) as {
  slugs: Record<string, Record<string, unknown>>;
}).slugs;

for (const s of process.argv.slice(2)) {
  const e = reg[s];
  if (!e) {
    console.log(`${s}: [ABSENT du registre]\n`);
    continue;
  }
  console.log(
    `${s} | num=${JSON.stringify(e['reglement_numero'])} mill=${JSON.stringify(e['reglement_millesime'])} url=${JSON.stringify(e['reglement_url'])}`,
  );
  console.log(`  note: ${(e['_note'] as string) ?? '(aucune)'}\n`);
}
