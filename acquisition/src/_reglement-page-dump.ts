/**
 * _reglement-page-dump.ts — lane P0_1 (provenance règlement).
 *
 * Sonde READ-ONLY, $0 (natif poppler). Dump VERBATIM du texte intégral des pages
 * demandées d'un PDF, pour DÉSAMBIGUÏSER un numéro candidat repéré par
 * `_reglement-local-probe.ts` / `_reglement-numero-probe.ts` (ex: un corps codifié
 * qui cite à la fois son numéro courant ET le numéro qu'il remplace).
 *
 * Source du PDF (par priorité):
 *   --file <path>            : un PDF précis (local ou déjà téléchargé)
 *   --slug <slug> [--nth k]  : le k-ième PDF (0=plus gros) de work/zonage-norms/<slug>/
 *
 * ANTI-INVENTION: n'écrit rien, ne décide rien. Imprime le texte tel quel + le n°
 * de page. L'opérateur relève le numéro officiel verbatim.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-page-dump.ts --slug fort-coulonge --pages 2
 *   npx tsx acquisition/src/_reglement-page-dump.ts --file /path/to.pdf --pages 3
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = resolve(ROOT, 'work', 'zonage-norms');

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

function localPdfs(slug: string): string[] {
  const dir = resolve(CORPUS, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => resolve(dir, f))
    .filter((p) => statSync(p).size > 4096)
    .sort((a, b) => statSync(b).size - statSync(a).size);
}

function main(): void {
  const file = arg('file');
  const slug = arg('slug');
  const nth = Number(arg('nth', '0'));
  const firstPage = Number(arg('from', '1'));
  const maxPages = Number(arg('pages', '2'));

  let path: string | undefined = file;
  if (!path && slug) {
    const pdfs = localPdfs(slug);
    path = pdfs[nth];
    if (!path) {
      console.log(`NO-PDF slug=${slug} nth=${nth} (found ${pdfs.length} pdf)`);
      process.exit(0);
    }
    console.log(`# slug=${slug} nth=${nth}/${pdfs.length} file=${path.replace(ROOT + '/', '')}`);
  }
  if (!path) {
    console.log('usage: _reglement-page-dump.ts (--file p | --slug s [--nth k]) [--from 1] [--pages 2]');
    process.exit(1);
  }

  let info = '';
  try {
    info = execFileSync('pdfinfo', [path], { encoding: 'utf8' });
  } catch {
    /* continue */
  }
  const pagesTotal = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? '0');

  // --grep <regex>: owner-gate / toponyme. Scanne TOUT le doc et imprime les lignes
  // qui matchent + leur page. Répond « ce document NOMME-t-il bien sa muni ? »
  // (mémoire corpus-slug-owner-mismatch: exiger que le doc nomme la muni).
  const grep = arg('grep');
  if (grep) {
    const re = new RegExp(grep, 'i');
    const full = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', path, '-'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: 180_000,
    });
    let shown = 0;
    full.split('\f').forEach((p, i) => {
      for (const raw of p.split(/\r?\n/)) {
        const l = raw.trim();
        if (l.length < 2 || !re.test(l)) continue;
        if (shown++ > 40) return;
        console.log(`p${i + 1}\t${l}`);
      }
    });
    console.log(`# grep=/${grep}/i pagesTotal=${pagesTotal} matches=${shown}`);
    return;
  }

  const lastPage = firstPage + maxPages - 1;
  const txt = execFileSync(
    'pdftotext',
    ['-f', String(firstPage), '-l', String(lastPage), '-layout', '-enc', 'UTF-8', path, '-'],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 120_000 },
  );
  console.log(`# pagesTotal=${pagesTotal} dump p${firstPage}-${lastPage}`);
  txt.split('\f').forEach((p, i) => {
    console.log(`\n----- page ${firstPage + i} -----`);
    console.log(p.replace(/[ \t]+$/gm, '').trim());
  });
}

main();
