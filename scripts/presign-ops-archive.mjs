#!/usr/bin/env node
// Mint temporary PUT/GET URLs for one OVH ops archive, never export the secret key.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';

const [envFile, objectKey, outputFile] = process.argv.slice(2);
if (!envFile || !outputFile || !/^ops\/decommission\/[0-9]{8}\/[a-zA-Z0-9/_-]+\.[a-z0-9]+$/.test(objectKey ?? '')) {
  throw new Error('Usage: presign-ops-archive.mjs env-file ops/decommission/YYYYMMDD/name.ext new-private-output.json');
}
const env = parseEnv(readFileSync(envFile, 'utf8'));
if (env.S3_ENDPOINT !== 'https://s3.bhs.io.cloud.ovh.net' || env.S3_REGION !== 'bhs' || env.S3_BUCKET !== 'sentropic-geo') {
  throw new Error('Unexpected archive target');
}
if (!env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) throw new Error('Missing S3 credential');
const signer = new SignatureV4({
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  service: 's3', region: 'bhs', sha256: Sha256, uriEscapePath: false,
});
const hostname = new URL(env.S3_ENDPOINT).hostname;
const result = {};
for (const method of ['PUT', 'GET']) {
  const request = await signer.presign({
    protocol: 'https:', hostname, method, path: `/sentropic-geo/${objectKey}`,
    headers: { host: hostname, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' }, query: {},
  }, { expiresIn: 7200 });
  result[`${method.toLowerCase()}Url`] = `https://${hostname}${request.path}?${new URLSearchParams(request.query)}`;
}
writeFileSync(outputFile, JSON.stringify(result) + '\n', { mode: 0o600, flag: 'wx' });
console.log('Two-hour URLs written to the requested private file; secret key not exported.');
