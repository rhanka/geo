#!/usr/bin/env node
// Read S3 version/delete-marker and incomplete-upload inventories before retirement.
// Input: Kubernetes Secret JSON on stdin. Output: metadata only, never credentials.
import { readFileSync } from 'node:fs';
import { S3Client, GetBucketVersioningCommand, ListObjectVersionsCommand, ListMultipartUploadsCommand } from '@aws-sdk/client-s3';
const secret = JSON.parse(readFileSync(0, 'utf8'));
const value = key => {
  if (!secret.data?.[key]) throw new Error(`Missing ${key}`);
  return Buffer.from(secret.data[key], 'base64').toString('utf8');
};
const endpoint = value('S3_ENDPOINT'), region = value('S3_REGION'), Bucket = value('S3_BUCKET');
const client = new S3Client({ endpoint, region, forcePathStyle: true, credentials: { accessKeyId: value('S3_ACCESS_KEY'), secretAccessKey: value('S3_SECRET_KEY') } });
const versioning = await client.send(new GetBucketVersioningCommand({ Bucket }));
let KeyMarker, VersionIdMarker, latest = 0, noncurrent = 0, deleteMarkers = 0;
do {
  const page = await client.send(new ListObjectVersionsCommand({ Bucket, KeyMarker, VersionIdMarker }));
  for (const version of page.Versions ?? []) version.IsLatest ? latest++ : noncurrent++;
  deleteMarkers += page.DeleteMarkers?.length ?? 0;
  if (page.IsTruncated && !page.NextKeyMarker) throw new Error('Truncated version inventory without cursor');
  KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
  VersionIdMarker = page.NextVersionIdMarker;
} while (KeyMarker);
let UploadIdMarker;
const uploads = [];
do {
  const page = await client.send(new ListMultipartUploadsCommand({ Bucket, KeyMarker, UploadIdMarker }));
  uploads.push(...(page.Uploads ?? []).map(upload => ({ key: upload.Key, uploadId: upload.UploadId, initiated: upload.Initiated })));
  if (page.IsTruncated && !page.NextKeyMarker) throw new Error('Truncated upload inventory without cursor');
  KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
  UploadIdMarker = page.NextUploadIdMarker;
} while (KeyMarker);
console.log(JSON.stringify({ at: new Date().toISOString(), endpoint, region, bucket: Bucket, versioning: versioning.Status ?? 'never-enabled', latest, noncurrent, deleteMarkers, uploads }, null, 2));
