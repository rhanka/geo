import { s3Client, BUCKET } from './lib/s3.js';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

async function main() {
  const s3 = s3Client();
  const r = await s3.send(new ListObjectsV2Command({Bucket: BUCKET, Prefix: 'registry/qc-zonage-norms/'}));
  console.log('S3 objects:', r.Contents?.length ?? 0);
  r.Contents?.forEach(o => console.log(' ', o.Key));
}

main().catch(console.error);
