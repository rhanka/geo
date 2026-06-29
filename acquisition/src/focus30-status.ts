/**
 * focus30-status — état de couverture zonage des 30 villes focus démo immo (lecture pure S3).
 *
 * Liste, pour chaque ville focus MTL-banlieue, si une collection `qc-zonage-<slug>`
 * est servie proprement en S3 (normalized/ ou registry/). Sert au TRACK REPORT focus-30.
 *
 * Usage : `npx tsx src/focus30-status.ts`  (depuis acquisition/)
 */
import { s3Client, BUCKET } from "./lib/s3.js";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

// 30 focus immo : 7 déjà servies historiquement + 23 demandées (#74). sainte-catherine = acquisition à part.
const FOCUS_SERVED_BASELINE = [
  "longueuil", "rosemere", "westmount", "hampstead", "cote-saint-luc", "dorval", "chambly",
];
const FOCUS_REQUESTED_23 = [
  "saint-lambert", "mont-royal", "montreal-ouest", "brossard", "sainte-catherine", "la-prairie",
  "delson", "candiac", "montreal-est", "lile-dorval", "saint-constant", "saint-bruno-de-montarville",
  "carignan", "dollard-des-ormeaux", "pointe-claire", "saint-philippe", "saint-mathieu",
  "chateauguay", "sainte-julie", "saint-basile-le-grand", "varennes", "kirkland", "boucherville",
];

async function servedSlugs(): Promise<Set<string>> {
  // Source de vérité = même prefix que coverage-reconcile : normalized/ca-qc-zonage/
  // (layout plat `qc-zonage-<slug>.geojson` OU sous-dossier `qc-zonage-<slug>/qc-zonage-…`).
  const s3 = s3Client();
  const have = new Set<string>();
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: "normalized/ca-qc-zonage/", ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents ?? []) {
      const k = o.Key ?? "";
      const m = k.match(/ca-qc-zonage\/qc-zonage-([^/]+)\.geojson$/) ?? k.match(/ca-qc-zonage\/qc-zonage-([^/]+)\/qc-zonage-/);
      if (m) have.add(m[1]);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return have;
}

async function main(): Promise<void> {
  const have = await servedSlugs();
  const all = [...FOCUS_SERVED_BASELINE, ...FOCUS_REQUESTED_23];
  const served = all.filter((s) => have.has(s));
  const missing = all.filter((s) => !have.has(s));
  console.log(`FOCUS-30 zonage servi : ${served.length}/${all.length}`);
  console.log(`  baseline 7 servies : ${FOCUS_SERVED_BASELINE.filter((s) => have.has(s)).length}/7`);
  console.log(`  lot-23 #74 servies : ${FOCUS_REQUESTED_23.filter((s) => have.has(s)).length}/23`);
  console.log(`SERVIES : ${served.sort().join(", ")}`);
  console.log(`MANQUANTES : ${missing.sort().join(", ")}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
