// Crop one PDF page to a page-fraction bbox and emit a single-page vector PDF
// (poppler pdftocairo -pdf), so t2-autogcp's SVG extraction only sees the MAIN
// map frame — dropping inset maps at other scales that inject spurious
// anisotropy into the affine fit (spec §7.3). $0, vectors preserved.
// Usage: _pdf-crop-page.ts <in.pdf> <page> <fx0,fy0,fx1,fy1> <out.pdf>
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [inPdf, pageArg, bboxArg, outPdf] = process.argv.slice(2);
if (!inPdf || !pageArg || !bboxArg || !outPdf) {
  throw new Error('usage: _pdf-crop-page.ts <in.pdf> <page> <fx0,fy0,fx1,fy1> <out.pdf>');
}
const page = Number(pageArg);
const f = bboxArg.split(',').map(Number);
if (f.length !== 4 || !f.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
  throw new Error('bbox must be fx0,fy0,fx1,fy1 in [0,1]');
}
const [fx0, fy0, fx1, fy1] = f as [number, number, number, number];

const info = execFileSync('pdfinfo', ['-f', String(page), '-l', String(page), inPdf], { encoding: 'utf8' });
const m =
  info.match(new RegExp(`Page\\s+${page}\\s+size:\\s*([\\d.]+)\\s*x\\s*([\\d.]+)`)) ??
  info.match(/Page size:\s*([\d.]+)\s*x\s*([\d.]+)/);
if (!m) throw new Error('pdfinfo: could not read page size');
const W = Number(m[1]);
const H = Number(m[2]);

// pdftocairo crop: -x/-y top-left origin, -W/-H extent, in points for vector out.
const x = Math.round(fx0 * W);
const y = Math.round(fy0 * H);
const w = Math.round((fx1 - fx0) * W);
const h = Math.round((fy1 - fy0) * H);

mkdirSync(dirname(outPdf), { recursive: true });
execFileSync(
  'pdftocairo',
  ['-pdf', '-f', String(page), '-l', String(page), '-x', String(x), '-y', String(y), '-W', String(w), '-H', String(h), inPdf, outPdf],
  { stdio: 'inherit' },
);
console.log(`cropped ${inPdf} p${page} [${x},${y} ${w}x${h}] (page ${W}x${H}pt) -> ${outPdf}`);
