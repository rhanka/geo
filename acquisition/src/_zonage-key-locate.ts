/**
 * _zonage-key-locate.ts — diagnostic READ-ONLY (lane P0_1 provenance règlement).
 *
 * Répond à: "sous quelle(s) clé(s) S3 vit le POLYGONE zonage d'un slug, et
 * geo-api la sert-il sous un id de collection NON standard (bare-slug) ?"
 *
 * Motif: fold-reglement-to-zonage stampe `qc-zonage-<slug>.geojson`, mais geo-api
 * sert parfois la même muni sous l'id bare `<slug>` (clé S3 sans le préfixe
 * `qc-zonage-`). Un stamp sur la clé standard reste alors INVISIBLE côté API.
 * (cf. mémoire fold-double-key-s3-serving + geo-api-collection-cache.)
 *
 * Usage: npx tsx acquisition/src/_zonage-key-locate.ts --slug tres-saint-redempteur
 */
import { s3Client, BUCKET } from './lib/s3.js';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const slug = arg('slug');
  if (!slug) { console.error('usage: --slug <slug>'); process.exit(2); }
  const s3 = s3Client();
  const prefixes = ['normalized/ca-qc-zonage/', 'normalized/qc-zonage/'];
  const needle = slug.toLowerCase();
  let hits = 0;
  for (const Prefix of prefixes) {
    let token: string | undefined;
    do {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix, ContinuationToken: token, MaxKeys: 1000 }));
      for (const o of res.Contents ?? []) {
        const k = o.Key ?? '';
        if (k.toLowerCase().includes(needle) && k.endsWith('.geojson')) {
          console.log(`${o.Size ?? '?'}\t${k}`);
          hits++;
        }
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
  console.log(`# hits=${hits} slug=${slug}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
