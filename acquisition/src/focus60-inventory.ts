/**
 * focus60-inventory.ts — inventaire des collections SERVIES (lecture pure S3), pour
 * verrouiller le roster focus-60 avec immo : quelles villes ont ZONAGE **et** GRILLE
 * tous deux servis dans l'OGC (candidates les plus proches du E2E fold-lot).
 *
 * Servi = objet présent sous le préfixe que scanne le geo-api (normalized/) :
 *   zonage : normalized/ca-qc-zonage/qc-zonage-<slug>.geojson            (collection qc-zonage-<slug>)
 *   grille : normalized/qc-zonage-norms/qc-zonage-norms-<slug>.geojson   (collection qc-zonage-norms-<slug>)
 *
 * Usage : npx tsx acquisition/src/focus60-inventory.ts [--json] [--both-only]
 */
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3Client, BUCKET } from "./lib/s3.js";

async function servedUnder(prefix: string, re: RegExp): Promise<Set<string>> {
  const s3 = s3Client();
  const have = new Set<string>();
  let token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
    for (const o of r.Contents ?? []) {
      const m = (o.Key ?? "").match(re);
      if (m) have.add(m[1]);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return have;
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const bothOnly = process.argv.includes("--both-only");
  const zonage = await servedUnder("normalized/ca-qc-zonage/", /ca-qc-zonage\/qc-zonage-([^/]+)\.geojson$/);
  const grille = await servedUnder("normalized/qc-zonage-norms/", /qc-zonage-norms\/qc-zonage-norms-([^/]+)\.geojson$/);
  const both = [...zonage].filter((s) => grille.has(s)).sort();
  const zonageOnly = [...zonage].filter((s) => !grille.has(s)).sort();
  const grilleOnly = [...grille].filter((s) => !zonage.has(s)).sort();
  if (json) {
    console.log(JSON.stringify({ counts: { zonage: zonage.size, grille: grille.size, both: both.length }, both, zonageOnly, grilleOnly }, null, 2));
    return;
  }
  console.log(`SERVI: zonage=${zonage.size} grille=${grille.size} BOTH(zonage+grille)=${both.length}`);
  console.log(`BOTH (${both.length}) — candidates E2E fold-lot :`);
  console.log(both.join(", "));
  if (!bothOnly) {
    console.log(`\nZONAGE-only (${zonageOnly.length}) — grille à servir/extraire :`);
    console.log(zonageOnly.join(", "));
    console.log(`\nGRILLE-only (${grilleOnly.length}) — zonage à acquérir :`);
    console.log(grilleOnly.join(", "));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
