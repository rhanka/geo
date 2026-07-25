/**
 * _frag-code-diff.ts — ONE-OFF: diff the zone_code SET between the S3-served
 * collection and a local rebuild, to see exactly which served codes a T1
 * rebuild FAILED to resolve (missing from the new collection) before deciding
 * whether a wholesale replacement is safe.
 *
 * Usage: npx tsx acquisition/src/_frag-code-diff.ts --slug <slug> --after <local.geojson>
 */
import { readFileSync } from "node:fs";
import { exists, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const slug = arg("slug");
const afterPath = arg("after");
if (!slug || !afterPath) throw new Error("required: --slug <slug> --after <local.geojson>");

const PREFIX = "normalized/ca-qc-zonage/";
function zonageKeys(s: string): string[] {
  return [`${PREFIX}qc-zonage-${s}.geojson`, `${PREFIX}qc-zonage-${s}/qc-zonage-${s}.geojson`];
}
interface Feature { properties?: Record<string, unknown> }

async function main(): Promise<void> {
  const s3 = s3Client();
  let before: { features: Feature[] } | null = null;
  for (const key of zonageKeys(slug!)) {
    if (!(await exists(s3, key))) continue;
    before = await getGeoJsonFeatureCollection<Feature>(s3, key);
    break;
  }
  if (!before) throw new Error("served collection introuvable");
  const beforeCodes = new Set(before.features.map((f) => String(f.properties?.["zone_code"] ?? "")));
  const after = JSON.parse(readFileSync(afterPath!, "utf8")) as { features: Feature[] };
  const afterCodes = new Set(after.features.map((f) => String(f.properties?.["zone_code"] ?? "")));
  const missing = [...beforeCodes].filter((c) => !afterCodes.has(c)).sort();
  const added = [...afterCodes].filter((c) => !beforeCodes.has(c)).sort();
  console.log(`before=${beforeCodes.size} after=${afterCodes.size}`);
  console.log(`MANQUANTS (servis avant, absents apres) [${missing.length}]: ${missing.join(", ")}`);
  console.log(`NOUVEAUX (absents avant, presents apres) [${added.length}]: ${added.join(", ")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
