/**
 * $0 per-ZONE proof that effet_densifiant (4a) is actually served.
 *
 * Two traps this exists to avoid (both already fallen into, see memories):
 *  - probing the OGC API instead of S3: geo-api caches the collection, so a
 *    fresh fold reads back stale => FALSE NEGATIVE. Proof must come from S3.
 *  - probing `features[0]`: the touched zone is almost never the first feature,
 *    so a null there proves nothing. This reads the NAMED zones.
 *
 * Usage (repo root):
 *   npx tsx acquisition/src/_effet-served-zone-verify.ts --slug alma --zones Cb50,Cb1
 */
import { pathToFileURL } from "node:url";

import { exists, getBytes, s3Client } from "./lib/s3.js";

const PREFIX = "normalized/ca-qc-zonage/";
const FIELDS = [
  "densite_avant",
  "densite_avant_reglement",
  "densite_avant_millesime",
  "densite_apres",
  "densite_apres_reglement",
  "densite_apres_millesime",
  "effet_densifiant",
  "effet_densifiant_delta",
] as const;

interface FeatureLike {
  properties?: Record<string, unknown>;
}

function arg(key: string): string | undefined {
  const i = process.argv.indexOf(`--${key}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const slug = arg("slug");
  const zones = arg("zones")?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!slug || !zones?.length) throw new Error("usage: --slug <slug> --zones A-1,B-2");

  const s3 = s3Client();
  let found = 0;
  for (const key of [`${PREFIX}qc-zonage-${slug}.geojson`, `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`]) {
    if (!(await exists(s3, key))) continue;
    found++;
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as { features?: FeatureLike[] };
    console.log(`--- ${key} (features=${fc.features?.length ?? 0}) ---`);
    for (const zone of zones) {
      const hits = (fc.features ?? []).filter((f) => f.properties?.["zone_code"] === zone);
      if (hits.length === 0) {
        console.log(`${zone}\tABSENT de la collection`);
        continue;
      }
      const p = hits[0]!.properties!;
      console.log(
        `${zone}\tn=${hits.length}\t` + FIELDS.map((f) => `${f}=${JSON.stringify(p[f] ?? null)}`).join(" "),
      );
    }
  }
  if (found === 0) throw new Error(`collection S3 introuvable pour ${slug}`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
