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

// AUTORITÉ = agent immo (radar-immobilier), mesure zone↔grille live via API OGC (h2a loop-mrf5dl5b, 2026-07-10).
// L'ancienne liste curée geo (banlieues MTL: longueuil/westmount/brossard/…) est SUPPRIMÉE — désalignée de la
// perception immo (recouvrement quasi nul). Ici = les villes qu'immo priorise (cohérence zone↔grille cassée),
// par tier. Full 30/31 en attente de la liste complète d'immo (demandée sur le thread focus30).
export const FOCUS_IMMO_P0 = ["mont-tremblant"]; // P0 millésime disjoint (626 codes SIG vs 54 grille, 8% communs)
export const FOCUS_IMMO_P1 = [ // grille servie mais 0% mappé (millésime/couplage)
  "saint-mathieu-de-beloeil", "rosemere", "plaisance",
  "hemmingford--les-jardins-de-napierville--2", "saint-charles-borromee", "sutton",
];
export const FOCUS_IMMO_P2 = [ // grille absente (zone servie sans normes)
  "saint-frederic", "champlain", "coaticook", "petite-riviere-saint-francois", "notre-dame-de-lourdes--lerable",
];
export const FOCUS_IMMO_P3 = ["alma", "saint-boniface"]; // zonage absent
// Partiels à remonter (nommés par immo au fil de l'eau, 2026-07-10 — mesure OGC servie).
export const FOCUS_IMMO_PARTIALS = ["sainte-catherine", "rimouski", "saint-come-liniere", "stratford", "preissac"];
/** Villes focus AUTORITAIRE immo (P0-P3 + partiels nommés). Remplacer par la liste totale 30/31 dès qu'immo l'envoie. */
export const FOCUS_30_SLUGS: readonly string[] = [
  ...FOCUS_IMMO_P0, ...FOCUS_IMMO_P1, ...FOCUS_IMMO_P2, ...FOCUS_IMMO_P3, ...FOCUS_IMMO_PARTIALS,
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
  const all = [...FOCUS_30_SLUGS];
  const served = all.filter((s) => have.has(s));
  const missing = all.filter((s) => !have.has(s));
  console.log(`FOCUS-IMMO zonage servi : ${served.length}/${all.length}`);
  console.log(`  P0=${FOCUS_IMMO_P0.length} P1=${FOCUS_IMMO_P1.length} P2=${FOCUS_IMMO_P2.length} P3=${FOCUS_IMMO_P3.length} (autorité immo)`);
  console.log(`SERVIES : ${served.sort().join(", ")}`);
  console.log(`MANQUANTES : ${missing.sort().join(", ")}`);
}

// Exécution directe seulement (l'import de FOCUS_30_SLUGS ne doit pas lancer le scan S3).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
