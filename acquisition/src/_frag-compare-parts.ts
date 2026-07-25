/**
 * _frag-compare-parts.ts — ONE-OFF: compare part-count (contiguity) BEFORE
 * (served on S3) vs AFTER (a local rebuilt geojson, e.g. a T1 --dry-run
 * output) for a slug. Prints total parts, max parts, mean parts, and the
 * count of urban zones still >=8 parts (the zone-contiguity-audit FRAG_PARTS
 * threshold) on both sides — the avant/après proof for a rectification.
 *
 * Usage: npx tsx acquisition/src/_frag-compare-parts.ts --slug <slug> --after <local.geojson>
 */
import { readFileSync } from "node:fs";
import { exists, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const slug = arg("slug");
const afterPath = arg("after");
if (!slug || !afterPath) throw new Error("required: --slug <slug> --after <local.geojson>");

const PREFIX = "normalized/ca-qc-zonage/";
function zonageKeys(s: string): string[] {
  return [`${PREFIX}qc-zonage-${s}.geojson`, `${PREFIX}qc-zonage-${s}/qc-zonage-${s}.geojson`];
}

interface Feature { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }

function countParts(geom: { type?: string; coordinates?: unknown } | undefined): number {
  if (!geom) return 0;
  if (geom.type === "Polygon") return 1;
  if (geom.type === "MultiPolygon") return (geom.coordinates as unknown[]).length;
  return 0;
}

function summarize(label: string, features: Feature[]): void {
  const perZone = features.map((f) => ({
    code: String(f.properties?.["zone_code"] ?? ""),
    parts: countParts(f.geometry),
  }));
  const totalParts = perZone.reduce((s, z) => s + z.parts, 0);
  const maxParts = perZone.reduce((m, z) => Math.max(m, z.parts), 0);
  const meanParts = perZone.length ? totalParts / perZone.length : 0;
  const over8 = perZone.filter((z) => z.parts >= 8);
  console.log(`\n=== ${label} ===`);
  console.log(`  zones=${perZone.length} totalParts=${totalParts} maxParts=${maxParts} meanParts=${meanParts.toFixed(2)}`);
  console.log(`  zones >=8 parts (${over8.length}): ${over8.map((z) => `${z.code}(${z.parts})`).join(", ") || "(aucune)"}`);
}

async function main(): Promise<void> {
  const s3 = s3Client();
  let before: { features: Feature[] } | null = null;
  for (const key of zonageKeys(slug!)) {
    if (!(await exists(s3, key))) continue;
    before = await getGeoJsonFeatureCollection<Feature>(s3, key);
    break;
  }
  if (!before) throw new Error(`served collection introuvable pour ${slug}`);
  summarize("AVANT (S3 servi)", before.features);

  const after = JSON.parse(readFileSync(afterPath!, "utf8")) as { features: Feature[] };
  summarize("APRÈS (local rebuild)", after.features);
}

main().catch((e) => { console.error(e); process.exit(1); });
