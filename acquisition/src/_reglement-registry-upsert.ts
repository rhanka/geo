/**
 * _reglement-registry-upsert.ts — écriture SÛRE dans le registre curé P0_1.
 *
 * `acquisition/config/reglement-provenance.json` est écrit EN PARALLÈLE par les
 * shards de la lane (mesuré 2026-07-17: shard 1/2 committait pendant que shard 0/2
 * lisait). Réécrire le fichier entier depuis une copie lue 10 minutes plus tôt
 * ÉCRASE silencieusement les entrées de l'autre shard. Cet outil fait un
 * read-modify-write ciblé: il relit le fichier JUSTE avant d'écrire et ne touche
 * QUE les slugs passés en entrée.
 *
 * Refuse d'écraser un slug déjà curé sauf --overwrite (une entrée existante a été
 * lue verbatim par quelqu'un; la remplacer à l'aveugle est une régression).
 *
 * Entrée: un fichier JSON {"<slug>": {reglement_numero, reglement_millesime,
 *          reglement_page_source, reglement_url, _note?}, ...}
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-registry-upsert.ts --in /tmp/lot.json
 *   npx tsx acquisition/src/_reglement-registry-upsert.ts --in /tmp/lot.json --overwrite
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');
const FIELDS = ['reglement_numero', 'reglement_millesime', 'reglement_page_source', 'reglement_url'] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

type Entry = Record<string, unknown>;

function main(): void {
  const inPath = arg('in');
  const overwrite = process.argv.includes('--overwrite');
  if (!inPath) {
    console.error('usage: --in <lot.json> [--overwrite]');
    process.exit(2);
  }
  const incoming = JSON.parse(readFileSync(resolve(inPath), 'utf8')) as Record<string, Entry>;

  // Garde-fou de forme AVANT de toucher au registre: un null sans _note est une
  // valeur muette (on ne saurait plus si le doc est muet ou s'il n'a pas été lu).
  for (const [slug, e] of Object.entries(incoming)) {
    if (e['reglement_numero'] == null && !e['_note']) {
      console.error(`REFUS ${slug}: reglement_numero=null sans _note (raison verbatim obligatoire)`);
      process.exit(1);
    }
    for (const f of FIELDS) if (!(f in e)) { console.error(`REFUS ${slug}: champ manquant '${f}'`); process.exit(1); }
  }

  // Relecture JUSTE avant écriture: fenêtre de course minimale avec l'autre shard.
  const raw = readFileSync(REGISTRY, 'utf8');
  const cfg = JSON.parse(raw) as { $comment?: string; slugs: Record<string, Entry> };
  const before = Object.keys(cfg.slugs).length;

  let added = 0;
  let kept = 0;
  for (const [slug, e] of Object.entries(incoming)) {
    if (cfg.slugs[slug] && !overwrite) {
      console.log(`KEEP ${slug} (déjà curé: numero=${JSON.stringify(cfg.slugs[slug]!['reglement_numero'])}) — --overwrite pour forcer`);
      kept++;
      continue;
    }
    cfg.slugs[slug] = e;
    added++;
    console.log(`UPSERT ${slug} numero=${JSON.stringify(e['reglement_numero'])} millesime=${JSON.stringify(e['reglement_millesime'])} page=${JSON.stringify(e['reglement_page_source'])}`);
  }

  writeFileSync(REGISTRY, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  console.log(`DONE slugs ${before} -> ${Object.keys(cfg.slugs).length} (upsert=${added} keep=${kept})`);
}

main();
