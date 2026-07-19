/**
 * _frag-dump-dict.ts — ONE-OFF: dump the served zone_code list for a slug (all
 * distinct codes currently on S3) as a JSON array, to feed t1-build --dict when
 * attempting a T1 rebuild of an already-served (but fragmented) collection.
 *
 * Usage: npx tsx acquisition/src/_frag-dump-dict.ts --slug <slug> --out <path.json>
 */
import { writeFileSync } from "node:fs";
import { exists, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const slug = arg("slug");
const out = arg("out");
if (!slug || !out) throw new Error("required: --slug <slug> --out <path.json>");

const PREFIX = "normalized/ca-qc-zonage/";
function zonageKeys(s: string): string[] {
  return [`${PREFIX}qc-zonage-${s}.geojson`, `${PREFIX}qc-zonage-${s}/qc-zonage-${s}.geojson`];
}

interface Feature { properties?: Record<string, unknown> }

async function main(): Promise<void> {
  const s3 = s3Client();
  let fc: { features: Feature[] } | null = null;
  for (const key of zonageKeys(slug!)) {
    if (!(await exists(s3, key))) continue;
    fc = await getGeoJsonFeatureCollection<Feature>(s3, key);
    break;
  }
  if (!fc) throw new Error(`collection introuvable pour ${slug}`);
  const codes = [...new Set(fc.features.map((f) => String(f.properties?.["zone_code"] ?? "")).filter(Boolean))].sort();
  writeFileSync(out!, JSON.stringify({ codes }, null, 2));
  console.log(`${codes.length} codes -> ${out}`);
  console.log(codes.join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); });
