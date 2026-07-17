/**
 * $0 PRE-GATE for the NORMES lane: prove a candidate PDF's IDENTITY before
 * burning Mistral on it.
 *
 * Measured cause #1 of stagnation on shards 1/3/5 is NOT extraction quality:
 * it is that `work/zonage-norms/<slug>/grille.pdf` frequently is NOT a grille
 * (an error/JS-gate page, a comite-consultatif bylaw, a rives/littoral extract,
 * the bylaw BODY whose grille annexe lives in a separate unpublished file, or
 * another municipality's document entirely). Mistral reading "0 zone" out of
 * such a file is a DISCOVERY failure being misread as an extraction failure.
 *
 * This probe runs poppler inside node (execFile, not gated by the ad-hoc bash
 * hook), costs $0, and reports per PDF:
 *   - byte size + page count (tiny file => almost surely an HTML error page)
 *   - the first non-empty lines of page 1 (the document's real title)
 *   - pages matching the canonical grille headers, and pages carrying SIG-shaped
 *     zone codes, so the operator can pick a real OCR window or reject the file.
 *
 * Reports verbatim only: it never infers a title the PDF does not carry.
 *
 * Usage:
 *   npx tsx acquisition/src/_normes-doc-identity.ts --slugs "a,b,c"
 *   npx tsx acquisition/src/_normes-doc-identity.ts --pdf <path>
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const root = resolve(process.cwd());

/** Canonical grille headers (the classifieur signal from the retained design). */
const GRILLE_RE =
  /grille\s+(des?\s+)?(usages?\s+et\s+)?(des?\s+)?(sp[ée]cifications?|normes?)|grille\s+de\s+zonage/i;
/** SIG-shaped zone codes: 1-4 letters, dash, digits (H-12, RA-3, AF-33, CH-10). */
const CODE_RE = /\b[A-Z]{1,4}-\d{1,3}\b/g;

function pdfPages(pdf: string): number {
  try {
    const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
    const m = info.match(/^Pages:\s+(\d+)/m);
    return m ? Number(m[1]) : -1;
  } catch {
    return -1;
  }
}

function pdfText(pdf: string, first?: number, last?: number): string {
  const args = ['-layout', '-enc', 'UTF-8'];
  if (first) args.push('-f', String(first));
  if (last) args.push('-l', String(last));
  args.push(pdf, '-');
  try {
    return execFileSync('pdftotext', args, {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

function candidatePdfs(slug: string): string[] {
  const out: string[] = [];
  const dir = resolve(root, 'work/zonage-norms', slug);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.pdf')) out.push(resolve(dir, f));
    }
  }
  for (const p of [
    resolve(root, 'work/zonage-plans', `${slug}.pdf`),
    resolve(root, 'work/pdf-cache', `${slug}.pdf`),
  ]) {
    if (existsSync(p)) out.push(p);
  }
  return out;
}

function probe(pdf: string): void {
  const size = statSync(pdf).size;
  const pages = pdfPages(pdf);
  const rel = pdf.replace(`${root}/`, '');
  console.log(`\n--- ${rel}`);
  console.log(`    size=${(size / 1024).toFixed(0)}KB pages=${pages}`);
  if (pages < 0) {
    console.log('    VERDICT: UNREADABLE-BY-POPPLER (damaged or not a PDF)');
    return;
  }
  const p1 = pdfText(pdf, 1, 1);
  const head = p1
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 8);
  console.log(`    TITLE-P1: ${head.length ? head.join(' | ').slice(0, 300) : '(no text layer on p1 — scan?)'}`);

  const all = pdfText(pdf);
  const pgs = all.split('\f');
  const grillePages: number[] = [];
  const codePages: Array<{ page: number; n: number; sample: string[] }> = [];
  pgs.forEach((p, i) => {
    if (GRILLE_RE.test(p)) grillePages.push(i + 1);
    const codes = [...new Set(p.match(CODE_RE) ?? [])];
    if (codes.length >= 3) codePages.push({ page: i + 1, n: codes.length, sample: codes.slice(0, 6) });
  });
  console.log(
    `    GRILLE-HEADER pages: ${grillePages.length ? `[${grillePages.slice(0, 20).join(',')}]${grillePages.length > 20 ? '…' : ''}` : 'NONE'}`,
  );
  if (codePages.length) {
    const top = codePages.slice().sort((a, b) => b.n - a.n).slice(0, 5);
    console.log(`    CODE-DENSE pages (>=3 SIG-shaped codes): ${codePages.length} page(s)`);
    for (const c of top) console.log(`      p${c.page}: ${c.n} codes — ${c.sample.join(' ')}`);
  } else {
    console.log('    CODE-DENSE pages: NONE');
  }
  const textChars = all.replace(/\s/g, '').length;
  console.log(
    `    TEXT-LAYER: ${textChars} chars ${textChars < 200 * Math.max(1, pages) ? '(sparse => scan/image, OCR route)' : '(native text)'}`,
  );
}

const pdfArg = arg('pdf');
if (pdfArg) {
  probe(resolve(pdfArg));
  process.exit(0);
}

const slugs = (arg('slugs') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (!slugs.length) {
  console.log('usage: _normes-doc-identity.ts --slugs "a,b" | --pdf <path>');
  process.exit(1);
}

for (const slug of slugs) {
  const pdfs = candidatePdfs(slug);
  console.log(`\n===== ${slug} : ${pdfs.length} candidate PDF(s)`);
  if (!pdfs.length) console.log('    NO-PDF (discovery required)');
  for (const p of pdfs) probe(p);
}
