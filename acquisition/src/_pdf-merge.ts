// Fusionne N PDF en un seul (poppler pdfunite), appelé DEPUIS node pour ne pas
// dépendre d'une chaîne bash ad-hoc. Cas d'usage: une muni publie sa grille des
// spécifications en plusieurs fichiers (une série de zones par fichier) — on les
// recolle pour une extraction unique (un seul dépôt parquet par muni).
// Usage: npx tsx acquisition/src/_pdf-merge.ts --out <merged.pdf> --in "a.pdf,b.pdf,..."
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const out = arg('out');
const inCsv = arg('in');
if (!out || !inCsv) { console.error('required: --out <path> --in "a.pdf,b.pdf"'); process.exit(1); }

const inputs = inCsv.split(',').map((s) => s.trim()).filter(Boolean);
const missing = inputs.filter((f) => !fs.existsSync(f));
if (missing.length) { console.error(`missing: ${missing.join(', ')}`); process.exit(1); }
const notPdf = inputs.filter((f) => !fs.readFileSync(f, { encoding: 'latin1' }).slice(0, 5).startsWith('%PDF'));
if (notPdf.length) { console.error(`NOT-PDF (téléchargement échoué?): ${notPdf.join(', ')}`); process.exit(1); }

execFileSync('pdfunite', [...inputs, out], { stdio: 'inherit' });
const size = fs.statSync(out).size;
console.log(`[pdf-merge] ${inputs.length} fichiers -> ${out} (${size} bytes)`);
