import { s3Client, BUCKET } from './lib/s3.js';
import { ZONAGE_NORMS_PREFIX } from './lib/zonage-norms.js';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

const client = s3Client();
const cmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: ZONAGE_NORMS_PREFIX, MaxKeys: 1000 });
const res = await client.send(cmd);
const keys = (res.Contents || []).map((o: any) => o.Key).filter(Boolean);
console.log(JSON.stringify(keys));
