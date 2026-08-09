/**
 * Print the served `qc-zonage-norms` manifest entry for given slugs.
 *
 * Answers the question the shard selector cannot: "is this slug ALREADY a served
 * norms product, and from WHEN?". `coverage-matrix.json` is rewritten
 * concurrently by several lanes, so its `normes.status` can disagree with the
 * manifest that actually feeds the join. The manifest is the authority.
 *
 * Read-only. Usage:
 *   npx tsx acquisition/src/_norms-manifest-entry.ts --slugs "a,b,c"
 */
import { s3Client, getBytes } from './lib/s3.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

interface Entry {
  slug: string;
  zone_rows?: number;
  unique_zone_codes?: number;
  deposited_at?: string;
  methode?: string;
  source_url?: string;
  key?: string;
}

async function main(): Promise<void> {
  const slugs = (arg('slugs') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!slugs.length) {
    console.log('usage: _norms-manifest-entry.ts --slugs "a,b"');
    process.exit(1);
  }
  const s3 = s3Client();
  const manifest = JSON.parse(
    (await getBytes(s3, 'registry/qc-zonage-norms/manifest.json')).toString('utf8'),
  ) as { entries?: Entry[] };
  const entries = manifest.entries ?? [];
  console.log(`# manifest entries: ${entries.length}`);
  for (const slug of slugs) {
    const e = entries.find((x) => x.slug === slug);
    if (!e) {
      console.log(`${slug}\tNOT-IN-MANIFEST (not served)`);
      continue;
    }
    console.log(
      `${slug}\tSERVED\trows=${e.zone_rows ?? '?'}\tcodes=${e.unique_zone_codes ?? '?'}\tdeposited_at=${e.deposited_at ?? '?'}\tmethode=${e.methode ?? '?'}\tsource=${(e.source_url ?? '?').slice(0, 60)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
