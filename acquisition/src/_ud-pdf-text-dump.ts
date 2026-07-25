#!/usr/bin/env tsx
/**
 * _ud-pdf-text-dump.ts — vide le texte NATIF d'un PDF (poppler `pdftotext -layout`)
 * dans un fichier .txt, avec un marqueur `[[PAGE n]]` en tête de chaque page.
 *
 * Pourquoi: `_ud-pdf-grep.ts` relance `pdftotext` PAGE PAR PAGE. Sur un corpus
 * compilé (mesuré: new-richmond `discovery-grille-C.pdf`, 1990 pages) une seule
 * recherche coûte plusieurs minutes, et chercher la légende demande une dizaine
 * de motifs différents. Un seul dump rend toutes les recherches suivantes
 * instantanées (grep sur le .txt).
 *
 * ANTI-INVENTION: extraction brute, aucune décision, aucun OCR ($0).
 * Si le PDF n'a pas de couche texte le dump est vide — c'est un `NO-TEXT-LAYER`,
 * PAS un `FIND-0` (cf. mémoire plein-texte-aveugle-sur-scan-find0).
 *
 * Usage:
 *   npx tsx acquisition/src/_ud-pdf-text-dump.ts --pdf <path> --out <path.txt>
 *                                                [--from N] [--to N]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const pdf = arg('pdf');
const out = arg('out');
if (!pdf || !existsSync(pdf) || !out) {
  console.error('usage: --pdf <path existant> --out <path.txt> [--from N] [--to N]');
  process.exit(1);
}

const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8', maxBuffer: 1 << 26 });
const total = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? '0');
const from = Number(arg('from', '1'));
const to = Math.min(Number(arg('to', String(total))), total);

const chunks: string[] = [];
let nonEmpty = 0;
// Découpage par tranches: un seul appel sur 2000 pages sature le buffer.
const STEP = 50;
for (let p = from; p <= to; p += STEP) {
  const last = Math.min(p + STEP - 1, to);
  let txt = '';
  try {
    txt = execFileSync('pdftotext', ['-f', String(p), '-l', String(last), '-layout', pdf, '-'], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    chunks.push(`[[PAGES ${p}-${last} ERREUR]]`);
    continue;
  }
  // pdftotext sépare les pages par \f: on réinjecte le numéro de page réel.
  const pages = txt.split('\f');
  pages.forEach((body, i) => {
    const n = p + i;
    if (n > last) return;
    if (body.trim()) nonEmpty++;
    chunks.push(`[[PAGE ${n}]]\n${body}`);
  });
}

const text = chunks.join('\n');
writeFileSync(out, text, 'utf8');
console.log(
  `# ${pdf} — pages ${from}-${to}/${total}, ${nonEmpty} avec texte, ${text.length} octets -> ${out}`,
);
if (nonEmpty === 0) console.log('# NO-TEXT-LAYER (scan): le plein-texte est AVEUGLE ici.');
