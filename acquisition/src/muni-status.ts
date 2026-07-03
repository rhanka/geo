/**
 * muni-status — état S3 réel (vérité, pas la matrice) des couches zonage/normes/pv
 * pour une liste de slugs passés en argv. Lecture pure (0 écriture, 0 LLM).
 *
 * Sonde, par slug :
 *   - zones   ← normalized/ca-qc-zonage/qc-zonage-<slug>.geojson (plat OU sous-dossier)
 *   - normes  ← registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet
 *   - pv      ← registry/qc-pv/<slug>/index.json
 *   - cadastre← normalized/qc-cadastre-lots/<slug>.geojson
 *
 * Usage : `npx tsx src/muni-status.ts mont-tremblant labelle …`  (depuis acquisition/)
 */
import { s3Client, exists } from "./lib/s3.js";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { BUCKET } from "./lib/s3.js";

async function zonesPresent(s3: S3Client, slug: string): Promise<boolean> {
  // plat OU sous-dossier
  if (await exists(s3, `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`)) return true;
  const r = await s3.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: `normalized/ca-qc-zonage/qc-zonage-${slug}/`,
      MaxKeys: 5,
    }),
  );
  return (r.KeyCount ?? 0) > 0;
}

async function pvPresent(s3: S3Client, slug: string): Promise<boolean> {
  const r = await s3.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: `registry/qc-pv/${slug}/`,
      MaxKeys: 1,
    }),
  );
  return (r.KeyCount ?? 0) > 0;
}

async function main(): Promise<void> {
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) {
    console.error("usage: npx tsx src/muni-status.ts <slug> [slug…]");
    process.exit(2);
  }
  const s3 = s3Client();
  console.log("slug".padEnd(28) + "zones  normes  pv     cadastre");
  for (const slug of slugs) {
    const [z, n, p, c] = await Promise.all([
      zonesPresent(s3, slug),
      exists(s3, `registry/qc-zonage-norms/qc-zonage-norms-${slug}.parquet`),
      pvPresent(s3, slug),
      exists(s3, `normalized/qc-cadastre-lots/${slug}.geojson`),
    ]);
    const mark = (b: boolean): string => (b ? "OK  " : "--  ").padEnd(7);
    console.log(slug.padEnd(28) + mark(z) + mark(n) + mark(p) + mark(c));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
