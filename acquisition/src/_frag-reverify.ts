/**
 * _frag-reverify.ts — ONE-OFF: re-run the zone-contiguity-audit `auditCity()`
 * logic for ONE slug against the CURRENT S3-served collection, WITHOUT ever
 * touching work/coverage/zone-contiguity.json (imports the pure function,
 * does its own read — the shared report stays untouched, unlike
 * `zone-contiguity-audit.ts --slugs` which rewrites the whole file).
 *
 * Usage: npx tsx acquisition/src/_frag-reverify.ts --slug <slug>[,<slug>...]
 */
import { auditCity } from "./zone-contiguity-audit.js";
import { exists, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";

const PREFIX = "normalized/ca-qc-zonage/";
function zonageKeys(slug: string): string[] {
  return [`${PREFIX}qc-zonage-${slug}.geojson`, `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const slugsArg = arg("slug");
  if (!slugsArg) throw new Error("required: --slug <slug>[,<slug>...]");
  const slugs = slugsArg.split(",").map((s) => s.trim()).filter(Boolean);
  const s3 = s3Client();
  for (const slug of slugs) {
    let fc: { features: unknown[] } | null = null;
    for (const key of zonageKeys(slug)) {
      if (!(await exists(s3, key))) continue;
      fc = await getGeoJsonFeatureCollection(s3, key);
      break;
    }
    if (!fc) { console.log(`${slug}: collection introuvable`); continue; }
    const r = auditCity(slug, fc.features as never);
    console.log(`\n=== ${slug} (re-vérif $0, work/coverage/zone-contiguity.json NON touché) ===`);
    console.log(JSON.stringify(r, null, 2));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
