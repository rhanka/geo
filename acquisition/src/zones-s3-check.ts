/**
 * zones-s3-check — contrôle la présence RÉELLE en S3 des collections zonage
 * déposées, pour diagnostiquer un écart dépôt-agent vs comptage reconcile.
 * Liste normalized/ca-qc-zonage/ et rapporte le total + la présence des slugs passés.
 *
 * Usage : npx tsx acquisition/src/zones-s3-check.ts windsor coteau-du-lac pontiac ...
 */
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3Client, BUCKET } from "./lib/s3.js";

async function main(): Promise<void> {
  const wanted = process.argv.slice(2);
  const s3 = s3Client();
  const prefix = "normalized/ca-qc-zonage/";
  const slugs = new Set<string>();
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents ?? []) {
      const k = o.Key ?? "";
      const m = k.match(/ca-qc-zonage\/qc-zonage-([^/]+)\.geojson$/) ?? k.match(/ca-qc-zonage\/qc-zonage-([^/]+)\/qc-zonage-/);
      if (m) slugs.add(m[1]);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  console.log(`ca-qc-zonage slugs en S3 : ${slugs.size}`);
  for (const w of wanted) console.log(`  ${w.padEnd(40)} ${slugs.has(w) ? "PRÉSENT" : "ABSENT"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
