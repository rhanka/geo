/**
 * _reglement-corps-read.ts — lane P0_1 (provenance règlement).
 *
 * Sonde READ-ONLY, $0 (poppler natif, aucun OCR). Comble l'angle mort des deux
 * sondes existantes:
 *   - `_reglement-numero-probe.ts --local` ne lit que le PLUS GROS PDF (souvent la
 *     grille, pas le corps: mémoire reglement-probe-lit-que-le-plus-gros-pdf).
 *   - `_reglement-owner-gate.ts --all-pdfs` lit chaque PDF mais n'imprime les lignes
 *     candidates qu'avec un `--find` fourni à la main.
 *
 * Ici, pour CHAQUE PDF local du slug (corps/cdx/reglement d'abord, grille
 * ensuite), on imprime en un seul passage: (1) le verdict propriétaire (nom complet
 * plié NFD, jeton distinctif), (2) les lignes VERBATIM portant un numéro de règlement
 * de zonage ou une date d'adoption/vigueur, avec leur page. C'est le gisement des
 * `corps-disc.pdf` déposés APRÈS un verdict null (mémoire null-verdict-perime-par-
 * depot-amont): la note du registre a été écrite sur la grille, jamais sur ce corps.
 *
 * ANTI-INVENTION: n'extrait rien, ne décide rien, n'écrit rien. L'opérateur relève
 * le numéro officiel VERBATIM (le nom de fichier ne fait pas foi).
 *
 * Usage (from repo root):
 *   npx tsx acquisition/src/_reglement-corps-read.ts --slugs a,b
 *   npx tsx acquisition/src/_reglement-corps-read.ts --slugs a --file corps --pages 12
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

/** Lignes qui PEUVENT porter le numéro officiel du règlement de zonage. */
const NUM_RE =
  /(r[eè]glement[s]?\s+(de\s+)?(zonage|d[eu]\s+zonage)|zonage\s+(num[eé]ro|n[°ºo]))|r[eè]glement\s*(num[eé]ro|n[°ºo]|#)\s*[:.]?\s*[0-9]|porte\s+(le\s+)?(num[eé]ro|titre)/i;
/** Lignes de millésime: adoption / entrée en vigueur / codification. */
const DATE_RE =
  /(entr[eé]e?\s+en\s+vigueur|en\s+vigueur\s+le|adopt[eé]|adoption|codification\s+administrative|consolid)/i;

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const SEP = "[\\s\\-\\u2010-\\u2015\\u00ad’']";

function nameOf(slug: string): string {
  return slug.split('--')[0]!;
}

function fullNameRe(slug: string): RegExp {
  const parts = nameOf(slug).split('-').filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(parts.join(`${SEP}*`), 'gi');
}

const STOP = new Set([
  'saint', 'sainte', 'st', 'ste', 'de', 'du', 'des', 'la', 'le', 'les',
  'l', 'd', 'sur', 'aux', 'au', 'et', 'notre', 'dame', 'lac', 'mont', 'ville', 'canton', 'paroisse',
]);

function coreToken(slug: string): string | undefined {
  return nameOf(slug)
    .split('-')
    .filter((t) => t.length > 2 && !STOP.has(t))
    .sort((a, b) => b.length - a.length)[0];
}

function count(hay: string, re: RegExp): number {
  return (hay.match(re) ?? []).length;
}

/** corps/cdx/reglement d'abord (portent le numéro), grille ensuite. */
function rank(name: string): number {
  const n = name.toLowerCase();
  if (/^corps/.test(n)) return 0;
  if (/^cdx-/.test(n)) return 1;
  if (/(reglement|règlement)/.test(n)) return 1;
  if (/grille|grid|annexe|table/.test(n)) return 3;
  return 2;
}

function localPdfs(slug: string, fileSub?: string): string[] {
  const dir = resolve(CORPUS, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .filter((f) => !fileSub || f.toLowerCase().includes(fileSub.toLowerCase()))
    .map((f) => resolve(dir, f))
    .filter((p) => statSync(p).size > 4096)
    .sort((a, b) => rank(a.split('/').pop()!) - rank(b.split('/').pop()!) || statSync(b).size - statSync(a).size);
}

function probe(slug: string, path: string, maxPages: number): void {
  const rel = path.replace(ROOT + '/', '');
  let info = '';
  try {
    info = execFileSync('pdfinfo', [path], { encoding: 'utf8' });
  } catch { /* continue */ }
  const pagesTotal = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? '0');
  let txt = '';
  try {
    txt = execFileSync(
      'pdftotext',
      ['-f', '1', '-l', String(maxPages), '-layout', '-enc', 'UTF-8', path, '-'],
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 120_000 },
    );
  } catch {
    console.log(`  ${rel}\tERR-PDFTOTEXT (image/protégé?) pages=${pagesTotal}`);
    return;
  }
  const folded = fold(txt);
  const full = count(folded, fullNameRe(slug));
  const tok = coreToken(slug);
  const core = tok ? count(folded, new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) : 0;
  const verdict = full > 0 ? 'OWNER-OK' : core > 0 ? 'OWNER-WEAK' : 'OWNER-ABSENT';
  const chars = txt.replace(/\s/g, '').length;
  if (chars < 40) {
    console.log(`\n--- ${rel} (pages=${pagesTotal}) ---\n  NO-TEXT-LAYER (scan) — route vision`);
    return;
  }
  console.log(`\n--- ${rel} (pages=${pagesTotal}, sonde p1-${Math.min(maxPages, pagesTotal || maxPages)}) ---`);
  console.log(`  ${verdict}\tnom-complet=${full}\tjeton«${tok ?? '-'}»=${core}`);
  const pages = txt.split('\f');
  let shown = 0;
  pages.forEach((p, i) => {
    for (const raw of p.split(/\r?\n/)) {
      const l = raw.trim();
      if (l.length < 3 || l.length > 160) continue;
      const isNum = NUM_RE.test(l);
      const isDate = DATE_RE.test(l);
      if (!isNum && !isDate) continue;
      if (shown++ > 50) return;
      console.log(`  p${i + 1}\t${isNum ? 'NUM ' : 'DATE'}\t${l}`);
    }
  });
  if (shown === 0) console.log(`  NO-CANDIDATE-LINE p1-${maxPages}`);
}

function main(): void {
  const slugs = (arg('slugs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const fileSub = arg('file');
  const maxPages = Number(arg('pages', '10'));
  if (!slugs.length) {
    console.log('usage: _reglement-corps-read.ts --slugs a,b [--file corps] [--pages 10]');
    process.exit(1);
  }
  for (const slug of slugs) {
    console.log(`\n===== ${slug} =====`);
    const pdfs = localPdfs(slug, fileSub);
    if (!pdfs.length) {
      console.log('  NO-LOCAL-PDF');
      continue;
    }
    for (const p of pdfs) probe(slug, p, maxPages);
  }
}

main();
