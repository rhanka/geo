import { s3Client, BUCKET, getBytes } from './lib/s3.js';
import { ZONAGE_NORMS_MANIFEST_KEY } from './lib/zonage-norms.js';

const client = s3Client();
const bytes = await getBytes(client, ZONAGE_NORMS_MANIFEST_KEY);
const manifest = JSON.parse(new TextDecoder().decode(bytes));
// Slugs come from argv (falls back to the original granby diagnostic set).
const want = process.argv.slice(2).filter(Boolean);
const slugs = want.length ? want : ['granby', 'inverness', 'ham-nord', 'herouxville'];
const entries = (manifest.entries ?? []).filter((e: any) => slugs.includes(e.slug));
const found = new Set(entries.map((e: any) => e.slug));
console.log(JSON.stringify({
  totalEntries: manifest.entries?.length ?? 0,
  asked: slugs,
  present: slugs.filter((s) => found.has(s)),
  absent: slugs.filter((s) => !found.has(s)),
  entries: entries.map((e: any) => ({ slug: e.slug, uzc: e.unique_zone_codes, pub: e.published_field_pct, overlap: e.crossval?.overlap, sig: e.crossval?.sigZoneCodes })),
}, null, 2));
