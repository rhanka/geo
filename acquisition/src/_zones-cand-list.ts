// Helper: enumerate zones!=done candidates from coverage-matrix, focus PDF tracks.
// Usage: npx tsx acquisition/src/_zones-cand-list.ts [--pdf-only] [--limit N]
import { readFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync('work/coverage/coverage-matrix.json', 'utf8'));
if (process.argv.includes('--keys')) {
  console.log('top keys', Object.keys(raw).slice(0, 30));
  const c = raw.cities;
  console.log('cities type', typeof c, Array.isArray(c) ? 'array len ' + c.length : 'object keys ' + Object.keys(c).length);
  const firstK = Object.keys(c)[0];
  const firstV = Array.isArray(c) ? c[0] : c[firstK];
  console.log('city key', firstK);
  console.log('city val keys', firstV && typeof firstV === 'object' ? Object.keys(firstV) : firstV);
  if (firstV && firstV.zones) console.log('zones sample', JSON.stringify(firstV.zones).slice(0, 300));
  if (firstV && firstV.layers) console.log('layers keys', Object.keys(firstV.layers));
  process.exit(0);
}
let cities: any[];
if (Array.isArray(raw)) cities = raw;
else if (Array.isArray(raw.cities)) cities = raw.cities;
else if (raw.cities && typeof raw.cities === 'object') cities = Object.entries(raw.cities).map(([k, v]: any) => ({ slug: k, ...v }));
else cities = Object.entries(raw).map(([k, v]: any) => ({ slug: k, ...v }));

const pdfOnly = process.argv.includes('--pdf-only');
const limIdx = process.argv.indexOf('--limit');
const limit = limIdx >= 0 ? parseInt(process.argv[limIdx + 1], 10) : Infinity;

function zoneOf(c: any) {
  return c?.zones || c?.layers?.zones || null;
}
function slugOf(c: any) {
  return c?.slug || c?.city || c?.id || c?.name || '?';
}

const cand = cities.filter((c) => {
  const z = zoneOf(c);
  return z && z.status && z.status !== 'done';
});

const byStatus: Record<string, number> = {};
for (const c of cand) {
  const z = zoneOf(c);
  byStatus[z.status] = (byStatus[z.status] || 0) + 1;
}

function tracksStr(c: any) {
  const z = zoneOf(c);
  return JSON.stringify(z?.candidateTracks || z?.tracks || c?.candidateTracks || '');
}

const withPdf = cand.filter((c) => /pdf-/.test(tracksStr(c)));

console.log('total cities', cities.length);
console.log('zones!=done', cand.length);
console.log('statuts', JSON.stringify(byStatus));
console.log('zones!=done avec pdf-track', withPdf.length);

const list = (pdfOnly ? withPdf : cand)
  .map((c) => ({ slug: slugOf(c), status: zoneOf(c).status, tracks: tracksStr(c) }))
  .sort((a, b) => a.slug.localeCompare(b.slug));

console.log('--- list (' + list.length + ') ---');
let n = 0;
for (const it of list) {
  if (n++ >= limit) break;
  console.log(`${it.slug}\t${it.status}\t${it.tracks.slice(0, 120)}`);
}
