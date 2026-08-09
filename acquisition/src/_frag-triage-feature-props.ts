/**
 * _frag-triage-feature-props.ts — ONE-OFF (zone-contiguity `fragmented` triage
 * mission): dump the FULL properties (all keys, not just zone_code/confidence)
 * of the served feature for a chosen offending zone_code, for each fragmented
 * slug — looking for a `pdf`/`source_url`/`geopdf` provenance breadcrumb that
 * the aggregate coverage-matrix/stats.json don't carry.
 *
 * Usage: npx tsx acquisition/src/_frag-triage-feature-props.ts
 */
import { exists, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";

const PREFIX = "normalized/ca-qc-zonage/";

const TARGETS: Record<string, string> = {
  "notre-dame-de-lourdes--joliette": "H-17",
  "saint-amable": "H-4",
  preissac: "VC-1",
  stratford: "VILL-4",
  "mont-saint-hilaire": "H-101",
  "hemmingford--les-jardins-de-napierville--2": "HA-3",
  cowansville: "RA-8",
  chelsea: "AGV-1",
  boucherville: "H-322",
};

interface Feature {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
}

function zonageKeys(slug: string): string[] {
  return [`${PREFIX}qc-zonage-${slug}.geojson`, `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`];
}

async function main(): Promise<void> {
  const s3 = s3Client();
  for (const [slug, code] of Object.entries(TARGETS)) {
    console.log(`\n=== ${slug} (${code}) ===`);
    let fc: { features: Feature[] } | null = null;
    for (const key of zonageKeys(slug)) {
      if (!(await exists(s3, key))) continue;
      fc = await getGeoJsonFeatureCollection<Feature>(s3, key);
      break;
    }
    if (!fc) {
      console.log("  collection introuvable sur S3");
      continue;
    }
    const feat = fc.features.find((f) => f.properties?.["zone_code"] === code);
    if (!feat) {
      console.log(`  code ${code} introuvable dans la collection`);
      continue;
    }
    console.log(`  properties: ${JSON.stringify(feat.properties, null, 2)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
