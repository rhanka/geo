/**
 * _frag-triage-s3-stats.ts — ONE-OFF (zone-contiguity `fragmented` triage
 * mission): read normalized/ca-qc-zonage/qc-zonage-<slug>.stats.json on S3 for
 * each fragmented slug — the T1 build report carries the ORIGINAL `pdf` field
 * (URL or local path used at build time) plus label/georef stats, even when
 * the source PDF is no longer on local disk. This is the $0 lead to re-fetch
 * the exact GeoPDF that was already proven to have embedded georef (since
 * confidence:"contour-auto" is the t1-build signature — it ONLY sets that tag,
 * cf. acquisition/src/lib/t1-zones.ts:309).
 *
 * Usage: npx tsx acquisition/src/_frag-triage-s3-stats.ts
 */
import { exists, getJson, s3Client } from "./lib/s3.js";

const SLUGS = [
  "notre-dame-de-lourdes--joliette",
  "saint-amable",
  "preissac",
  "stratford",
  "mont-saint-hilaire",
  "hemmingford--les-jardins-de-napierville--2",
  "cowansville",
  "chelsea",
  "boucherville",
];

async function main(): Promise<void> {
  const s3 = s3Client();
  for (const slug of SLUGS) {
    const key = `normalized/ca-qc-zonage/qc-zonage-${slug}.stats.json`;
    console.log(`\n=== ${slug} ===`);
    const has = await exists(s3, key);
    if (!has) {
      console.log(`  ${key}: ABSENT`);
      continue;
    }
    const stats = await getJson<Record<string, unknown>>(s3, key);
    console.log(`  source=${stats["source"]} confidence=${stats["confidence"]} label_mode=${stats["label_mode"]}`);
    console.log(`  pdf=${stats["pdf"]}`);
    console.log(`  crs=${stats["crs"]} georef_residual_m=${stats["georef_residual_m"]} n_label_codes=${stats["n_label_codes"]}`);
    console.log(`  n_lots_assigned=${stats["n_lots_assigned"]} n_lots_total=${stats["n_lots_total"]} lot_to_zone_pct=${stats["lot_to_zone_pct"]}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
