/**
 * _frag-one-code-props.ts — ONE-OFF: dump full served properties for ONE
 * zone_code of a slug, to check e.g. whether a code the T1 rebuild drops is
 * known junk (like cowansville's PZ-2016-01, a leaked plan number) before
 * deciding whether dropping it from a merge is safe.
 *
 * Usage: npx tsx acquisition/src/_frag-one-code-props.ts --slug <slug> --code <code>
 */
import { exists, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const slug = arg("slug");
const code = arg("code");
if (!slug || !code) throw new Error("required: --slug <slug> --code <code>");

const PREFIX = "normalized/ca-qc-zonage/";
function zonageKeys(s: string): string[] {
  return [`${PREFIX}qc-zonage-${s}.geojson`, `${PREFIX}qc-zonage-${s}/qc-zonage-${s}.geojson`];
}
interface Feature { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }

async function main(): Promise<void> {
  const s3 = s3Client();
  let fc: { features: Feature[] } | null = null;
  for (const key of zonageKeys(slug!)) {
    if (!(await exists(s3, key))) continue;
    fc = await getGeoJsonFeatureCollection<Feature>(s3, key);
    break;
  }
  if (!fc) throw new Error("collection introuvable");
  const feat = fc.features.find((f) => f.properties?.["zone_code"] === code);
  if (!feat) { console.log(`${code}: introuvable`); return; }
  const parts = feat.geometry?.type === "MultiPolygon" ? (feat.geometry.coordinates as unknown[]).length : 1;
  console.log(`parts=${parts}`);
  console.log(JSON.stringify(feat.properties, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
