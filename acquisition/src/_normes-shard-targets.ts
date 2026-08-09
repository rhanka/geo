// Liste les cibles NORMES productibles (zones=done & normes!=done) pour un shard.
// Autorité: coverage-matrix pour l'état zones/normes, + presence d'un PDF local
// (work/zonage-norms/<slug>/*.pdf, work/zonage-plans/<slug>*.pdf) pour prioriser
// le levier #1 (réutiliser le PDF règlement déjà téléchargé).
//
// Usage: npx tsx acquisition/src/_normes-shard-targets.ts --shard 0 --of 2 [--limit 40] [--with-pdf-only]
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const argv = process.argv.slice(2);
function arg(name: string, dflt?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const shard = Number(arg('shard', '0'));
const of = Number(arg('of', '2'));
const limit = Number(arg('limit', '0'));
const withPdfOnly = argv.includes('--with-pdf-only');

const matrix = JSON.parse(
  fs.readFileSync(path.join(root, 'work/coverage/coverage-matrix.json'), 'utf8'),
);

const productible: string[] = [];
for (const [slug, layers] of Object.entries<any>(matrix.cities ?? {})) {
  const zones = layers?.zones?.status;
  const normes = layers?.normes?.status;
  if (zones === 'done' && normes !== 'done') productible.push(slug);
}
productible.sort();

function pdfFor(slug: string): string | null {
  const nd = path.join(root, 'work/zonage-norms', slug);
  const prefer = path.join(nd, 'grille.pdf');
  if (fs.existsSync(prefer)) return path.relative(root, prefer);
  try {
    const f = fs.readdirSync(nd).find((x) => /\.pdf$/i.test(x));
    if (f) return path.relative(root, path.join(nd, f));
  } catch {}
  const plan = path.join(root, 'work/zonage-plans', `${slug}.pdf`);
  if (fs.existsSync(plan)) return path.relative(root, plan);
  return null;
}

const mine = productible.filter((_, i) => i % of === shard);
let rows = mine.map((slug) => ({ slug, pdf: pdfFor(slug) }));
if (withPdfOnly) rows = rows.filter((r) => r.pdf);
if (limit > 0) rows = rows.slice(0, limit);

console.log(`productible-total=${productible.length} shard=${shard}/${of} mine=${mine.length} shown=${rows.length}`);
for (const r of rows) console.log(`${r.slug}\t${r.pdf ?? 'NO-PDF'}`);
