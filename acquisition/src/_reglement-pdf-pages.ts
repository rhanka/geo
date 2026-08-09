/**
 * _reglement-pdf-pages.ts — lane P0_1 (provenance règlement).
 *
 * READ-ONLY, $0 (poppler natif). Dump VERBATIM des pages demandées d'un PDF local
 * (work/zonage-norms/<slug>/<file>) pour relever le numéro officiel + le millésime
 * + le propriétaire, sans OCR. Sert à confirmer un candidat AVANT de l'écrire au
 * registre (anti-invention: le nom de fichier ne fait pas foi).
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-pdf-pages.ts <slug> <fileSubstr> [firstPage] [lastPage]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = resolve(ROOT, 'work', 'zonage-norms');

const [slug, fileSub, fp = '1', lp = '3'] = process.argv.slice(2);
if (!slug || !fileSub) {
  console.log('usage: _reglement-pdf-pages.ts <slug> <fileSubstr> [firstPage] [lastPage]');
  process.exit(1);
}
const dir = resolve(CORPUS, slug);
if (!existsSync(dir)) {
  console.log(`NO-DIR ${dir}`);
  process.exit(1);
}
const match = readdirSync(dir).find(
  (f) => f.toLowerCase().endsWith('.pdf') && f.toLowerCase().includes(fileSub.toLowerCase()),
);
if (!match) {
  console.log(`NO-MATCH ${fileSub} in ${dir}`);
  process.exit(1);
}
const path = resolve(dir, match);
console.log(`### ${slug} :: ${match} p${fp}-${lp}`);
const txt = execFileSync(
  'pdftotext',
  ['-f', fp, '-l', lp, '-layout', '-enc', 'UTF-8', path, '-'],
  { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 120_000 },
);
console.log(txt);
