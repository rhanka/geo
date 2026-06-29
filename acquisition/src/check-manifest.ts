import { s3Client, getBytes } from './lib/s3.js';

async function main() {
  const s3 = s3Client();
  const manifest = JSON.parse((await getBytes(s3, 'registry/qc-zonage-norms/manifest.json')).toString('utf8'));
  const entries = manifest.entries || [];
  console.log('Manifest entries:', entries.length);
  const today = '2026-06-23';
  entries
    .filter((e: any) => e.deposited_at && e.deposited_at.startsWith(today))
    .forEach((e: any) => console.log(e.slug, '| rows:', e.zone_rows, '| deposited:', e.deposited_at));
}

main().catch(console.error);
