/**
 * purge-bad-normes.ts — supprime des dépôts normes explicitement identifiés
 * comme invalides par le conductor (anti-invention: <3 zones ou 0% champs).
 *
 * Usage:
 *   npx tsx src/purge-bad-normes.ts slug1 slug2 ...
 *
 * N'imprime aucun secret. Idempotent: DeleteObject S3 est OK si absent.
 */
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { BUCKET, s3Client } from "./lib/s3.js";

const slugs = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
if (slugs.length === 0) {
  console.error("usage: npx tsx src/purge-bad-normes.ts <slug> [...]");
  process.exit(2);
}

const s3 = s3Client();
for (const slug of slugs) {
  const Key = `registry/qc-zonage-norms/qc-zonage-norms-${slug}.parquet`;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key }));
  console.log(`purged ${slug}`);
}
