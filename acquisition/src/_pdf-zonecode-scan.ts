// Scan every page of a PDF for zone-code-like tokens (N-Voc or Letter-Num) and
// report page count + per-page hit density, to locate a grille / legend page.
// Usage: npx tsx acquisition/src/_pdf-zonecode-scan.ts <pdf>
import { execFileSync } from 'node:child_process';

const pdf = process.argv[2];
if (!pdf) throw new Error('usage: _pdf-zonecode-scan.ts <pdf>');

let nPages = 0;
try {
  const info = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' });
  const m = info.match(/Pages:\s+(\d+)/);
  nPages = m ? parseInt(m[1], 10) : 0;
} catch (e) {
  console.error('pdfinfo failed', e instanceof Error ? e.message : String(e));
}
console.log('pages', nPages);

const reNvoc = /\b\d{1,3}\s?-\s?[A-Za-z]{1,4}\b/g;
const reLnum = /\b[A-Za-z]{1,3}-\d{1,3}\b/g;

for (let p = 1; p <= nPages; p++) {
  let txt = '';
  try {
    txt = execFileSync('pdftotext', ['-layout', '-f', String(p), '-l', String(p), pdf, '-'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {}
  const nv = (txt.match(reNvoc) || []).filter((s) => !/^1[0-9]\s?-\s?(LA|LES|DE|DU)/i.test(s));
  const ln = txt.match(reLnum) || [];
  const distinct = new Set([...nv, ...ln].map((s) => s.replace(/\s/g, '')));
  const chars = txt.replace(/\s/g, '').length;
  if (distinct.size >= 3 || (p >= nPages - 8 && chars < 200)) {
    console.log(
      `p${p}: chars=${chars} nvoc=${nv.length} lnum=${ln.length} distinct=${distinct.size} sample=${JSON.stringify([...distinct].slice(0, 12))}`,
    );
  }
}
