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
// LISTE COMPLÈTE des 30 (immo, 2026-07-10, mesure zone↔grille sur l'OGC servi), par état.
export const FOCUS_IMMO_OK_LAYER = [ // couche zone↔grille OK ; reste = re-fold + parse au niveau lot
  "saint-amable", "saint-raymond", "mont-saint-hilaire", "saint-stanislas-de-kostka",
  "cowansville", "chelsea", "la-sarre", "saint-gilbert", "neuville",
];
export const FOCUS_IMMO_WINS = [ // corrigées cette session (canon + serving + vision), servies OK
  "mont-tremblant", "saint-frederic", "champlain", "rosemere", "plaisance", "coaticook",
];
export const FOCUS_IMMO_WRONG_SOURCE = [ // 0% malgré grille : mauvaise source / millésime disjoint (swap couche)
  "saint-mathieu-de-beloeil", "hemmingford--les-jardins-de-napierville--2", "saint-charles-borromee", "sutton",
];
export const FOCUS_IMMO_PARTIAL = [ // couverture partielle à remonter
  "sainte-catherine", "rimouski", "saint-come-liniere", "levis", "saint-raphael", "sainte-cecile-de-milton", "preissac",
];
export const FOCUS_IMMO_GRILLE_ABSENTE = ["petite-riviere-saint-francois", "notre-dame-de-lourdes--lerable"];
export const FOCUS_IMMO_ZONAGE_ABSENT = ["alma", "saint-boniface"];
/** Les 30 villes focus AUTORITAIRE immo (liste complète, alignée à l'identique sur son snapshot). */
export const FOCUS_30_SLUGS: readonly string[] = [
  ...FOCUS_IMMO_OK_LAYER, ...FOCUS_IMMO_WINS, ...FOCUS_IMMO_WRONG_SOURCE,
  ...FOCUS_IMMO_PARTIAL, ...FOCUS_IMMO_GRILLE_ABSENTE, ...FOCUS_IMMO_ZONAGE_ABSENT,
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
  console.log(`  ok-layer=${FOCUS_IMMO_OK_LAYER.length} wins=${FOCUS_IMMO_WINS.length} wrong-source=${FOCUS_IMMO_WRONG_SOURCE.length} partial=${FOCUS_IMMO_PARTIAL.length} grille-absente=${FOCUS_IMMO_GRILLE_ABSENTE.length} zonage-absent=${FOCUS_IMMO_ZONAGE_ABSENT.length} (total ${FOCUS_30_SLUGS.length}, autorité immo)`);
  console.log(`SERVIES : ${served.sort().join(", ")}`);
  console.log(`MANQUANTES : ${missing.sort().join(", ")}`);
}

// Exécution directe seulement (l'import de FOCUS_30_SLUGS ne doit pas lancer le scan S3).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
