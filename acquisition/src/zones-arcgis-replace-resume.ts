/**
 * Finish the additive provenance stage of an interrupted ArcGIS replacement.
 *
 * It never fetches a new source and never replaces geometry.  The only allowed
 * mutation is zone_source_url/zone_source_level, copied from the complete v2
 * proof already present on the served object.  This makes a terminated
 * re-enrichment run resumable without manufacturing a URL or re-running a
 * destructive geometry write.
 *
 * Usage:
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/zones-arcgis-replace-resume.ts --slug chambly
 */
import { getBytes, exists, s3Client } from "./lib/s3.js";
import { putServedZoneAdditive } from "./lib/zonage-proof.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "normalized/ca-qc-zonage/";

interface Feature { properties?: Record<string, unknown> | null }
interface Collection { proof?: unknown; features?: Feature[] }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validHttp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch { return null; }
}

/** Pure and deliberately strict: never reconstruct missing proof fields. */
export function sourceStampFromServed(value: unknown): { url: string; level: "documented" } {
  const collection = record(value) as Collection | null;
  const wrapper = record(collection?.proof);
  const source = record(wrapper?.geometry_source);
  const url = validHttp(source?.url);
  if (wrapper?.schema_version !== "2.0" || !url
    || typeof source?.retrieved_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(source.retrieved_at)
    || typeof source?.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(source.sha256)
    || typeof source?.type !== "string" || typeof source?.method !== "string" || typeof source?.reliability !== "string") {
    throw new Error("preuve géométrique v2 complète absente: reprise de provenance refusée");
  }
  return { url, level: "documented" };
}

function metrics(features: Feature[]): { keys: string[]; values: number } {
  const keys = new Set<string>();
  let values = 0;
  for (const feature of features) {
    const props = feature.properties ?? {};
    const names = Object.keys(props);
    values += names.length;
    for (const name of names) keys.add(name);
  }
  return { keys: [...keys].sort(), values };
}

function slugArg(argv: string[]): string {
  const index = argv.indexOf("--slug");
  const slug = index >= 0 ? argv[index + 1]?.trim() : "";
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error("--slug <slug> requis");
  return slug;
}

async function main(): Promise<void> {
  const slug = slugArg(process.argv.slice(2));
  const s3 = s3Client();
  const flat = `${PREFIX}qc-zonage-${slug}.geojson`;
  const nested = `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  const keys = (await Promise.all([flat, nested].map(async (key) => (await exists(s3, key)) ? key : null))).filter((key): key is string => key !== null);
  if (keys.length === 0) throw new Error(`aucune collection qc-zonage servie pour ${slug}`);
  const result: Array<Record<string, unknown>> = [];
  for (const key of keys) {
    const before = JSON.parse((await getBytes(s3, key)).toString("utf8")) as Collection & { type?: unknown };
    if (before.type !== "FeatureCollection" || !Array.isArray(before.features)) throw new Error(`${key}: FeatureCollection invalide`);
    const stamp = sourceStampFromServed(before);
    const beforeMetrics = metrics(before.features);
    const incoming = JSON.parse(JSON.stringify(before)) as Collection & { type?: unknown };
    for (const feature of incoming.features ?? []) {
      feature.properties = { ...(feature.properties ?? {}), zone_source_url: stamp.url, zone_source_level: stamp.level };
    }
    await putServedZoneAdditive(s3, key, incoming as never, { allowedProps: ["zone_source_url", "zone_source_level"] });
    const after = JSON.parse((await getBytes(s3, key)).toString("utf8")) as Collection & { type?: unknown };
    if (after.type !== "FeatureCollection" || !Array.isArray(after.features)) throw new Error(`${key}: readback invalide`);
    const afterMetrics = metrics(after.features);
    const lost = beforeMetrics.keys.filter((name) => !afterMetrics.keys.includes(name));
    if (lost.length || afterMetrics.values < beforeMetrics.values) {
      throw new Error(`${key}: reprise provenance a appauvri les propriétés servies (${lost.join(", ") || `${beforeMetrics.values}→${afterMetrics.values}`})`);
    }
    const urls = new Set(after.features.map((feature) => feature.properties?.zone_source_url));
    const levels = new Set(after.features.map((feature) => feature.properties?.zone_source_level));
    if (urls.size !== 1 || !urls.has(stamp.url) || levels.size !== 1 || !levels.has(stamp.level)) throw new Error(`${key}: readback provenance non uniforme`);
    result.push({ key, url: stamp.url, level: stamp.level, before: beforeMetrics, after: afterMetrics });
  }
  console.log(JSON.stringify({ slug, resumed: result }, null, 2));
}

const isCliEntrypoint = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCliEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
