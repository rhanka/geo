import { s3Client, BUCKET, getBytes } from './lib/s3.js';
import { ZONAGE_NORMS_MANIFEST_KEY } from './lib/zonage-norms.js';

const client = s3Client();
const bytes = await getBytes(client, ZONAGE_NORMS_MANIFEST_KEY);
const manifest = JSON.parse(new TextDecoder().decode(bytes));
const entry = manifest.entries?.find((e: any) => ['granby', 'inverness', 'ham-nord', 'herouxville'].includes(e.slug));
const entries = manifest.entries?.filter((e: any) => ['granby', 'inverness', 'ham-nord', 'herouxville'].includes(e.slug));
console.log(JSON.stringify(entries, null, 2));
