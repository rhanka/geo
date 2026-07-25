/**
 * _reglement-corpus-locate.ts — lane P0_1: trouver le DOC LOCAL d'un slug.
 *
 * Constat mesuré (shard 0/2, 2026-07-17): le `source_url` du manifest est une
 * impasse pour la majorité des cibles — sentinelle texte «non-disponible», hôte
 * mort, 404, ou page-portail. Or la lane normes a DÉJÀ téléchargé le règlement
 * dans `work/zonage-norms/<slug>/`. C'est ce corpus local, pas l'URL, qui a servi
 * les lots du shard 1/2 («Corpus LOCAL => url null» dans leurs _note).
 *
 * Cet outil INVENTORIE, il ne lit ni ne décide rien: pour chaque slug il liste les
 * PDF locaux avec leur taille et leur nombre de pages, pour choisir lequel ouvrir.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-corpus-locate.ts --slugs a,b,c
 *   npx tsx acquisition/src/_reglement-corpus-locate.ts --shard 0/2   (cibles sans provenance)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = resolve(ROOT, 'work', 'zonage-norms');
const ENRICH = resolve(ROOT, 'work', 'coverage', 'zonage-enrichment.json');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function pdfPages(path: string): string {
  try {
    const info = execFileSync('pdfinfo', [path], { encoding: 'utf8', timeout: 20_000 });
    return /Pages:\s+(\d+)/.exec(info)?.[1] ?? '?';
  } catch {
    return 'ERR';
  }
}

/** PDF locaux d'un slug, les plus gros d'abord (le corps du règlement pèse plus
 *  que la grille; c'est le corps qui porte le numéro officiel). */
function localPdfs(slug: string): Array<{ file: string; mb: string; pages: string }> {
  const dir = resolve(CORPUS, slug);
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.pdf'));
  } catch {
    return [];
  }
  return names
    .map((file) => {
      const p = resolve(dir, file);
      const mb = (statSync(p).size / 1_048_576).toFixed(2);
      return { file, mb, pages: pdfPages(p) };
    })
    .sort((a, b) => Number(b.mb) - Number(a.mb));
}

function shardTargets(spec: string): string[] {
  const enrich = JSON.parse(readFileSync(ENRICH, 'utf8')) as {
    perMuni: Array<{ slug: string; served?: boolean; reglement?: boolean }>;
  };
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')) as { slugs: Record<string, unknown> };
  const all = enrich.perMuni
    .filter((m) => m.served === true && m.reglement === false)
    .map((m) => m.slug)
    .sort();
  const [i, n] = spec.split('/').map(Number);
  return all.filter((_, idx) => idx % n! === i!).filter((s) => !registry.slugs[s]);
}

function main(): void {
  const shard = arg('shard');
  const slugs = shard
    ? shardTargets(shard)
    : (arg('slugs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) {
    console.error('usage: --slugs a,b | --shard 0/2');
    process.exit(2);
  }
  let withDoc = 0;
  for (const slug of slugs) {
    const pdfs = localPdfs(slug);
    if (!pdfs.length) continue;
    withDoc++;
    for (const p of pdfs) console.log(`${slug}\t${p.file}\t${p.mb}MB\tpages=${p.pages}`);
  }
  console.log(`# slugs sondés=${slugs.length} avec PDF local=${withDoc} (sans=${slugs.length - withDoc})`);
}

main();
