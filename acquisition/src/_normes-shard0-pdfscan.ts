// _normes-shard0-pdfscan.ts — READ-ONLY, $0.
// Pour chaque slug LIBRE du shard 0/2 (zones=done & normes!=done, index%2==0),
// liste les PDF présents dans work/zonage-norms/<slug>/ avec leur nombre de pages
// (via `pdfinfo`, poppler déjà utilisé par le pipeline). But: repérer les PDF
// GRILLE DÉDIÉS (petits, ~1-5 p) — les seuls productibles en `--route ocr` sans
// auto-grid — vs les gros règlements (grille profonde, mur auto-grid).
// N'invente rien, ne dépose rien. Usage: npx tsx acquisition/src/_normes-shard0-pdfscan.ts
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const mx = JSON.parse(fs.readFileSync(path.join(ROOT, 'work/coverage/coverage-matrix.json'), 'utf8'));
const cities: Record<string, any> = mx.cities || {};
const st = (x: any) => (x && typeof x === 'object' ? x.status : x) || '';

const candidates = Object.entries(cities)
  .filter(([, v]) => st(v.zones) === 'done' && st(v.normes) !== 'done')
  .map(([slug]) => slug)
  .sort();
const shard0 = candidates.filter((_, i) => i % 2 === 0);

function pageCount(pdf: string): number | null {
  try {
    const r = spawnSync('pdfinfo', [pdf], { encoding: 'utf8', timeout: 20000 });
    if (r.status !== 0) return null;
    const m = /Pages:\s*(\d+)/.exec(r.stdout || '');
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

const NORMES = path.join(ROOT, 'work/zonage-norms');
type Row = { slug: string; pdf: string; pages: number | null };
const rows: Row[] = [];
for (const slug of shard0) {
  const dir = path.join(NORMES, slug);
  let files: string[] = [];
  try { files = fs.readdirSync(dir); } catch { continue; }
  const pdfs = files.filter((f) => f.toLowerCase().endsWith('.pdf'));
  for (const f of pdfs) {
    rows.push({ slug, pdf: f, pages: pageCount(path.join(dir, f)) });
  }
}

// Trie: d'abord les PDF <= 8 pages (candidats grille dédiée), par slug.
const small = rows.filter((r) => r.pages !== null && r.pages <= 8);
const big = rows.filter((r) => r.pages === null || r.pages > 8);
console.log(`=== SMALL PDFs (<=8p) — candidats grille dédiée (${small.length}) ===`);
for (const r of small.sort((a, b) => a.slug.localeCompare(b.slug) || a.pages! - b.pages!)) {
  console.log(`${String(r.pages).padStart(3)}p\t${r.slug}\t${r.pdf}`);
}
console.log(`\n=== BIG/UNKNOWN PDFs (>8p) — règlement complet, mur auto-grid (${big.length}) ===`);
for (const r of big.sort((a, b) => a.slug.localeCompare(b.slug))) {
  console.log(`${r.pages === null ? '  ?' : String(r.pages).padStart(3) + 'p'}\t${r.slug}\t${r.pdf}`);
}
