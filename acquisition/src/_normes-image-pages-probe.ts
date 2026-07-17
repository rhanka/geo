// _normes-image-pages-probe — gate $0 : trouve l'ANNEXE-GRILLE EN IMAGE cachée
// dans un corps de règlement NATIF.
//
// POINT AVEUGLE COMBLÉ (mesuré sur le shard 1/2, 4 passes) :
//   `_normes-doc-identity` et `normes-window-probe` lisent la COUCHE TEXTE.
//   Un corps de règlement natif dont l'annexe « grille des usages et normes »
//   est un SCAN/IMAGE collé en fin de document rend donc :
//       GRILLE-HEADER: NONE + CODE-DENSE: NONE
//   ...alors que la grille EST dans le PDF. Verdict « corps sans grille » =
//   FAUX NÉGATIF, et on jette une cible déposable.
//
// Ce probe, à $0 et sans Mistral :
//   1) pdfinfo → nombre de pages,
//   2) pdftotext page par page → chars de la couche texte,
//   3) pdfimages -list par page → surface image (une page-grille scannée = 1
//      grande image plein cadre, une page de prose illustrée = petites images),
//   4) rapporte les PLAGES de pages « texte quasi-vide + image dominante » =
//      fenêtre candidate à router vers Mistral OCR avec --first-page/--last-page.
//
// Anti-invention : ne rapporte que ce que poppler mesure ; aucune extrapolation.
// Sortie vide = preuve $0 qu'il n'y a pas d'annexe-image (verdict « corps sans
// grille » alors CONFIRMÉ, pas supposé).
//
// Usage:
//   npx tsx acquisition/src/_normes-image-pages-probe.ts --slugs a,b,c
//   npx tsx acquisition/src/_normes-image-pages-probe.ts --pdf <path>
//   [--min-chars 120]   seuil « page sans texte utile » (défaut 120)
//   [--max-pages 400]   garde-fou
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function arg(name: string, def = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const MIN_CHARS = Number(arg('min-chars', '120'));
const MAX_PAGES = Number(arg('max-pages', '400'));

function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  } catch {
    return '';
  }
}

function pageCount(pdf: string): number {
  const out = sh('pdfinfo', [pdf]);
  const m = out.match(/^Pages:\s+(\d+)/m);
  return m ? Number(m[1]) : 0;
}

function pageChars(pdf: string, p: number): number {
  return sh('pdftotext', ['-f', String(p), '-l', String(p), pdf, '-']).replace(/\s+/g, '').length;
}

// surface image dominante sur la page (ratio approx. vs une page ~612x792 pt @72dpi)
function pageImageArea(pdf: string, p: number): { n: number; maxPx: number } {
  const out = sh('pdfimages', ['-list', '-f', String(p), '-l', String(p), pdf]);
  const lines = out.split('\n').slice(2).filter((l) => l.trim());
  let maxPx = 0;
  for (const l of lines) {
    const c = l.trim().split(/\s+/);
    const w = Number(c[3]);
    const h = Number(c[4]);
    if (Number.isFinite(w) && Number.isFinite(h)) maxPx = Math.max(maxPx, w * h);
  }
  return { n: lines.length, maxPx };
}

function ranges(pages: number[]): string[] {
  const out: string[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const p of pages) {
    if (start === null) { start = prev = p; continue; }
    if (prev !== null && p === prev + 1) { prev = p; continue; }
    out.push(start === prev ? `${start}` : `${start}..${prev}`);
    start = prev = p;
  }
  if (start !== null) out.push(start === prev ? `${start}` : `${start}..${prev}`);
  return out;
}

function candidatePdfs(slug: string): string[] {
  const found: string[] = [];
  const dir = path.join('work/zonage-norms', slug);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) if (f.toLowerCase().endsWith('.pdf')) found.push(path.join(dir, f));
  }
  return found;
}

function probe(pdf: string): void {
  const n = pageCount(pdf);
  if (!n) { console.log(`  ${pdf}\n    UNREADABLE (pdfinfo muet — stub HTML / PDF corrompu ?)`); return; }
  if (n > MAX_PAGES) { console.log(`  ${pdf}\n    SKIP pages=${n} > --max-pages ${MAX_PAGES}`); return; }

  const imagePages: number[] = [];
  const sparse: number[] = [];
  for (let p = 1; p <= n; p++) {
    const chars = pageChars(pdf, p);
    if (chars >= MIN_CHARS) continue;
    sparse.push(p);
    const { maxPx } = pageImageArea(pdf, p);
    // >= ~0.5 Mpx sur une page sans texte = image plein cadre (scan), pas un logo
    if (maxPx >= 500_000) imagePages.push(p);
  }
  console.log(`  ${pdf}  pages=${n}`);
  console.log(`    texte-vide(<${MIN_CHARS} ch): ${sparse.length} page(s) ${sparse.length ? ranges(sparse).join(',') : '—'}`);
  if (imagePages.length) {
    console.log(`    🔎 IMAGE-DOMINANTE (candidat annexe-grille scannée): ${ranges(imagePages).join(',')}`);
    console.log(`       → router Mistral BORNÉ: --route ocr --first-page <a> --last-page <b> --budget-usd 1`);
  } else {
    console.log(`    aucune page image-dominante ⇒ pas d'annexe-image ⇒ « corps sans grille » CONFIRMÉ à $0`);
  }
}

const pdfArg = arg('pdf');
if (pdfArg) {
  console.log(`===== ${pdfArg}`);
  probe(pdfArg);
} else {
  const slugs = arg('slugs').split(',').map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) {
    console.log('usage: _normes-image-pages-probe.ts --slugs a,b,c | --pdf <path> [--min-chars 120] [--max-pages 400]');
    process.exit(1);
  }
  for (const slug of slugs) {
    const pdfs = candidatePdfs(slug);
    console.log(`===== ${slug} : ${pdfs.length} PDF`);
    for (const p of pdfs) probe(p);
  }
}
