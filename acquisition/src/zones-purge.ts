/**
 * zones-purge.ts — supprime des dépôts zonage (normalized/ca-qc-zonage) explicitement
 * identifiés comme invalides par le conductor (anti-invention : couche affectation/
 * catégorie d'usage, champ technique non-code, faux positif spatial…).
 *
 * Usage:
 *   npx tsx src/zones-purge.ts slug1 slug2 ...
 *   npx tsx src/zones-purge.ts --file <path>   # slugs un-par-ligne (# = commentaire)
 *
 * N'imprime aucun secret. Idempotent : DeleteObject S3 est OK si la clé est absente.
 * N'écrit PAS la matrice (S3 = vérité ; coverage-reconcile réconciliera).
 */
import { readFileSync } from "node:fs";

import { BUCKET, s3Client, deleteObject } from "./lib/s3.js";

const argv = process.argv.slice(2);
const slugs: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--file") {
    const path = argv[++i];
    if (!path) {
      console.error("--file requiert un chemin");
      process.exit(2);
    }
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      const s = raw.trim();
      if (s && !s.startsWith("#")) slugs.push(s);
    }
  } else {
    const s = a.trim();
    if (s) slugs.push(s);
  }
}
if (slugs.length === 0) {
  console.error("usage: npx tsx src/zones-purge.ts <slug> [...] | --file <path>");
  process.exit(2);
}

const s3 = s3Client();
for (const slug of slugs) {
  const key = `normalized/ca-qc-zonage/qc-zonage-${slug}.geojson`;
  await deleteObject(s3, key, BUCKET);
  console.log(`purged ${slug} (${key})`);
}
