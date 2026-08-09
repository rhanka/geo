// _normes-grille-density-rank — classement $0 de TOUT un shard NORMES.
//
// Discriminant mesuré (shards 0/1/3/5) : un `work/zonage-norms/<slug>/*.pdf` qui
// est le CORPS du règlement ne porte que des renvois en prose (« prévue à la
// grille des usages… ») et jamais plus de ~7 codes SIG sur une page. Une VRAIE
// grille (multizone ou transposée) concentre 10..100+ codes sur une même page.
// Ce scan classe donc les PDF par densité maximale de codes par page, et croise
// avec les codes SIG réellement servis (overlap potentiel) — le tout sans
// dépenser un cent de Mistral.
//
// Sortie triée par densité décroissante : les premiers sont les seuls à nourrir.
//
// Usage: npx tsx acquisition/src/_normes-grille-density-rank.ts --slugs "a,b,c"
//        npx tsx acquisition/src/_normes-grille-density-rank.ts --shard 0 --of 2
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const argv = process.argv.slice(2);
function arg(name: string, def = ''): string {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}

const CODE_RE = /\b[A-Z]{1,4}-\d{1,3}\b/g;
/** Forme numéro-lettre (« 5-F », « 12-RA ») : légende « numéro de zone - vocation ». */
const CODE_NUMFIRST_RE = /\b\d{1,3}-[A-Z]{1,4}\b/g;

function pdfsFor(slug: string): string[] {
  const out: string[] = [];
  const dir = path.join(root, 'work/zonage-norms', slug);
  try {
    for (const f of fs.readdirSync(dir)) if (/\.pdf$/i.test(f)) out.push(path.join(dir, f));
  } catch {}
  for (const p of [
    path.join(root, 'work/zonage-plans', `${slug}.pdf`),
    path.join(root, 'work/pdf-cache', `${slug}.pdf`),
  ]) if (fs.existsSync(p)) out.push(p);
  return out;
}

function scan(pdf: string): { best: number; page: number; pages: number; sample: string[]; textChars: number } {
  let all = '';
  try {
    all = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-'], {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { return { best: -1, page: 0, pages: 0, sample: [], textChars: 0 }; }
  const pgs = all.split('\f');
  let best = 0, page = 0, sample: string[] = [];
  pgs.forEach((p, i) => {
    const a = new Set(p.match(CODE_RE) ?? []);
    const b = new Set(p.match(CODE_NUMFIRST_RE) ?? []);
    const n = Math.max(a.size, b.size);
    if (n > best) { best = n; page = i + 1; sample = [...(a.size >= b.size ? a : b)].slice(0, 6); }
  });
  return { best, page, pages: pgs.length, sample, textChars: all.replace(/\s/g, '').length };
}

let slugs = arg('slugs').split(',').map((s) => s.trim()).filter(Boolean);
if (!slugs.length) {
  const shard = Number(arg('shard', '0'));
  const of = Number(arg('of', '2'));
  const matrix = JSON.parse(fs.readFileSync(path.join(root, 'work/coverage/coverage-matrix.json'), 'utf8'));
  const prod: string[] = [];
  for (const [slug, l] of Object.entries<any>(matrix.cities ?? {})) {
    if (l?.zones?.status === 'done' && l?.normes?.status !== 'done') prod.push(slug);
  }
  prod.sort();
  slugs = prod.filter((_, i) => i % of === shard);
}

type Row = { slug: string; best: number; page: number; pages: number; pdf: string; sample: string[]; sparse: boolean };
const rows: Row[] = [];
for (const slug of slugs) {
  const pdfs = pdfsFor(slug);
  if (!pdfs.length) { rows.push({ slug, best: -2, page: 0, pages: 0, pdf: 'NO-PDF', sample: [], sparse: false }); continue; }
  let top: Row | null = null;
  for (const pdf of pdfs) {
    const r = scan(pdf);
    const cand: Row = {
      slug, best: r.best, page: r.page, pages: r.pages,
      pdf: path.relative(root, pdf), sample: r.sample,
      sparse: r.textChars < 200 * Math.max(1, r.pages),
    };
    if (!top || cand.best > top.best) top = cand;
  }
  rows.push(top!);
}
rows.sort((a, b) => b.best - a.best);
console.log('best\tpage/pages\tslug\tsample\tpdf');
for (const r of rows) {
  const verdict = r.best === -2 ? 'NO-PDF' : r.best === -1 ? 'PDFERR' : r.sparse ? `${r.best}~SCAN` : String(r.best);
  console.log(`${verdict}\tp${r.page}/${r.pages}\t${r.slug}\t${r.sample.join(' ')}\t${r.pdf}`);
}
