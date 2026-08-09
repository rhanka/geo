// Batch-render page 1 of several candidate zoning PDFs to PNG for fast visual triage
// (real zoning plan vs locator map vs wrong-doc). $0, poppler only.
// Usage: npx tsx acquisition/src/_zones-batch-render.ts <outdir> <dpi> <pdf1> [pdf2 ...]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';

const outdir = process.argv[2];
const dpi = process.argv[3] || '100';
const pdfs = process.argv.slice(4);
if (!outdir || pdfs.length === 0) throw new Error('usage: _zones-batch-render.ts <outdir> <dpi> <pdf...>');
mkdirSync(outdir, { recursive: true });

for (const pdf of pdfs) {
  if (!existsSync(pdf)) {
    console.log(`MISSING ${pdf}`);
    continue;
  }
  const stem = basename(pdf).replace(/\.[^.]+$/, '');
  const prefix = `${outdir}/${stem}`;
  try {
    execFileSync('pdftoppm', ['-png', '-r', String(dpi), '-f', '1', '-l', '1', pdf, prefix], {
      stdio: 'ignore',
    });
    console.log(`OK ${prefix}-1.png  <= ${pdf}`);
  } catch (e) {
    console.log(`FAIL ${pdf}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
