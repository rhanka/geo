/**
 * _s3-cat.ts — diagnostic READ-ONLY: imprime une clé S3 texte (meta.json,
 * stats.json, manifest…) telle quelle.
 *
 * Raison d'être: trancher « quelle source geo-api sert-il vraiment ? » sans
 * deviner. Utilisé sur boischatel (deux clés qc-zonage coexistantes).
 *
 * Usage:
 *   npx tsx acquisition/src/_s3-cat.ts --key normalized/ca-qc-zonage/qc-zonage-boischatel/qc-zonage-boischatel.meta.json
 */
import { s3Client, getBytes } from './lib/s3.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const key = arg('key');
  const max = Number(arg('max') ?? '4000');
  if (!key) {
    console.log('usage: _s3-cat.ts --key <s3-key> [--max 4000]');
    process.exit(1);
  }
  const buf = await getBytes(s3Client(), key);
  console.log(buf.toString('utf8').slice(0, max));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
