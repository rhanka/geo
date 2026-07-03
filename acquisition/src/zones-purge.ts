/**
 * zones-purge.ts — supprime des dépôts zonage (normalized/ca-qc-zonage) explicitement
 * identifiés comme invalides par le conductor (anti-invention : couche affectation/
 * catégorie d'usage, champ technique non-code, faux positif spatial…).
 *
 * Usage:
 *   npx tsx src/zones-purge.ts slug1 slug2 ...
 *
 * N'imprime aucun secret. Idempotent : DeleteObject S3 est OK si la clé est absente.
 * N'écrit PAS la matrice (S3 = vérité ; coverage-reconcile réconciliera).
 */
import { BUCKET, s3Client, deleteObject } from "./lib/s3.js";

const slugs = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
if (slugs.length === 0) {
  console.error("usage: npx tsx src/zones-purge.ts <slug> [...]");
  process.exit(2);
}

const s3 = s3Client();
for (const slug of slugs) {
  const key = `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`;
  await deleteObject(s3, key, BUCKET);
  console.log(`purged ${slug} (${key})`);
}
