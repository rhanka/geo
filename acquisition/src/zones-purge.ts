/**
 * zones-purge.ts — supprime des dépôts zonage (normalized/ca-qc-zonage) explicitement
 * identifiés comme invalides par le conductor (anti-invention : couche affectation/
 * catégorie d'usage, champ technique non-code, faux positif spatial…).
 *
 * Usage:
 *   npx tsx src/zones-purge.ts --dry-run --slug slug1,slug2
 *   npx tsx src/zones-purge.ts --slug slug1,slug2
 *   npx tsx src/zones-purge.ts slug1 slug2 ...
 *   npx tsx src/zones-purge.ts --file <path>   # slugs un-par-ligne (# = commentaire)
 *
 * N'imprime aucun secret. Idempotent : DeleteObject S3 est OK si la clé est absente.
 * N'écrit PAS la matrice (S3 = vérité ; coverage-reconcile réconciliera).
 */
import { readFileSync } from "node:fs";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";

import { BUCKET, s3Client, deleteObject, exists } from "./lib/s3.js";

const PREFIX = "normalized/ca-qc-zonage/";

const argv = process.argv.slice(2);
const slugs: string[] = [];
let dryRun = false;
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
  } else if (a === "--slug" || a === "--slugs") {
    const value = argv[++i];
    if (!value) {
      console.error(`${a} requiert un slug ou CSV de slugs`);
      process.exit(2);
    }
    slugs.push(...value.split(",").map((s) => s.trim()).filter(Boolean));
  } else if (a === "--dry-run") {
    dryRun = true;
  } else {
    const s = a.trim();
    if (s) slugs.push(s);
  }
}
if (slugs.length === 0) {
  console.error("usage: npx tsx src/zones-purge.ts [--dry-run] --slug <slug[,slug...]> | <slug> [...] | --file <path>");
  process.exit(2);
}

const s3 = s3Client();
const uniqueSlugs = [...new Set(slugs)];

async function listSubdirKeys(slug: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  const prefix = `${PREFIX}qc-zonage-${slug}/`;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of r.Contents ?? []) if (o.Key) out.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function keysForSlug(slug: string): Promise<string[]> {
  const flatCandidates = [
    ...(slug.includes(".geojson.") ? [`${PREFIX}qc-zonage-${slug}`] : []),
    `${PREFIX}qc-zonage-${slug}.geojson`,
    `${PREFIX}qc-zonage-${slug}.meta.json`,
    `${PREFIX}qc-zonage-${slug}.stats.json`,
  ];
  const flat: string[] = [];
  for (const key of flatCandidates) {
    if (await exists(s3, key, BUCKET)) flat.push(key);
  }
  return [...flat, ...(await listSubdirKeys(slug))];
}

let total = 0;
for (const slug of uniqueSlugs) {
  const keys = [...new Set(await keysForSlug(slug))];
  total += keys.length;
  for (const key of keys) {
    if (dryRun) console.log(`would purge ${slug} (${key})`);
    else {
      await deleteObject(s3, key, BUCKET);
      console.log(`purged ${slug} (${key})`);
    }
  }
}
console.log(`${dryRun ? "DRY-RUN" : "DONE"} slugs=${uniqueSlugs.length} keys=${total}`);
