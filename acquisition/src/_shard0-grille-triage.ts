// Triage helper (shard-0 normes): for a list of slugs with a local PDF, report
// whether the PDF actually CONTAINS an extractable "grille des usages et normes"
// so we only spend Mistral on productive targets.
//
// Per PDF it reports: total pages, pages carrying a text layer, and the pages
// that match grille/norme header anchors (grille des usages|normes, superficie,
// marge, hauteur, frontage) — plus a verdict:
//   GRILLE-TEXT  : header anchors found in the text layer -> native/ocr window.
//   IMAGE-ONLY   : almost no text layer -> scanned; try vision/ocr.
//   NO-GRILLE    : substantial text but no grille anchors -> wrong doc / grille elsewhere.
//
// Usage: npx tsx acquisition/src/_shard0-grille-triage.ts <slug1> <slug2> ...
//   (resolves work/zonage-norms/<slug>/grille.pdf, then any *.pdf in that dir,
//    then work/zonage-plans/<slug>.pdf)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();

function resolvePdf(slug: string): string | null {
  const nd = path.join(root, 'work/zonage-norms', slug);
  const prefer = path.join(nd, 'grille.pdf');
  if (fs.existsSync(prefer)) return prefer;
  try {
    const f = fs.readdirSync(nd).find((x) => /\.pdf$/i.test(x));
    if (f) return path.join(nd, f);
  } catch {}
  const plan = path.join(root, 'work/zonage-plans', `${slug}.pdf`);
  if (fs.existsSync(plan)) return plan;
  return null;
}

const HEADER = /grille des (usages|sp[ée]cifications)|usages et normes|superficie min|marge (avant|lat[ée]rale|arri[èe]re)|hauteur (max|min)|frontage|rapport plancher/i;
const ZONELINE = /\bzone\b[ :]*[A-Z]{1,4}\s?-\s?\d/i;

for (const slug of process.argv.slice(2)) {
  const pdf = resolvePdf(slug);
  if (!pdf) { console.log(`${slug}\tNO-PDF`); continue; }
  let txt = '';
  try {
    txt = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-'], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e: any) { console.log(`${slug}\tPDFERR ${String(e?.message).slice(0, 60)}`); continue; }
  const pages = txt.split('\f');
  const total = pages.length;
  let textPages = 0;
  const headerPages: number[] = [];
  const zonePages: number[] = [];
  pages.forEach((p, i) => {
    const nonEmpty = p.replace(/\s+/g, '').length;
    if (nonEmpty > 40) textPages++;
    if (HEADER.test(p)) headerPages.push(i + 1);
    if (ZONELINE.test(p)) zonePages.push(i + 1);
  });
  let verdict: string;
  if (headerPages.length) verdict = 'GRILLE-TEXT';
  else if (textPages < Math.max(2, total * 0.3)) verdict = 'IMAGE-ONLY';
  else verdict = 'NO-GRILLE';
  const rel = path.relative(root, pdf);
  console.log(
    `${slug}\t${verdict}\tpages=${total} textPages=${textPages}` +
    `\thdr=[${headerPages.slice(0, 12).join(',')}]` +
    `\tzone=[${zonePages.slice(0, 8).join(',')}${zonePages.length > 8 ? ',…' : ''}]` +
    `\t${rel}`,
  );
}
