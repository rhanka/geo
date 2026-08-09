// Helper: does normalized/qc-cadastre-lots/<slug>.geojson exist on S3?
// Gate $0 AVANT d'investir de la vision : sans cadastre, aucun recalage ne peut
// servir (cf. austin — 125 lectures parfaites, 0 dépôt possible).
// Usage: npx tsx acquisition/src/_cadastre-exists.ts --slugs a,b,c
import { exists, s3Client } from './lib/s3.js';

const i = process.argv.indexOf('--slugs');
const slugs = (i >= 0 ? process.argv[i + 1] ?? '' : '').split(',').map((s) => s.trim()).filter(Boolean);
if (!slugs.length) throw new Error('required: --slugs a,b,c');

const s3 = s3Client();
const ok: string[] = [];
const ko: string[] = [];
for (const slug of slugs) {
  const key = `normalized/qc-cadastre-lots/${slug}.geojson`;
  const e = await exists(s3, key);
  console.log(`${e ? 'OK  ' : 'ABS '} ${slug}  ${key}`);
  (e ? ok : ko).push(slug);
}
console.log(`\ncadastre PRÉSENT (${ok.length}): ${ok.join(' ')}`);
console.log(`cadastre ABSENT  (${ko.length}): ${ko.join(' ')}`);
