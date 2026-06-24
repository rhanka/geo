import { s3Client, BUCKET, exists } from './lib/s3.js';
const client = s3Client();
const slugs = ['herouxville', 'inverness', 'granby', 'ham-nord', 'ham-sud', 'gracefield',
                'godmanchester', 'hatley-township-municipality', 'havelock', 'huntingdon',
                'grenville', 'hatley', 'henryville', 'hampstead', 'grand-remous', 
                'grand-saint-esprit', 'gatineau'];
for (const slug of slugs) {
  const key = `registry/qc-zonage-norms/qc-zonage-norms-${slug}.parquet`;
  const e = await exists(client, key);
  console.log(`${slug}: ${e ? 'EXISTS' : 'not found'}`);
}
