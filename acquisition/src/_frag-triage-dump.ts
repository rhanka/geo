/**
 * _frag-triage-dump.ts — ONE-OFF (zone-contiguity `fragmented` triage mission):
 * dump the full per-city detail for every city with status:"fragmented" in
 * work/coverage/zone-contiguity.json (10 cities as of 2026-07-19), without
 * touching/rewriting the shared report file (read-only).
 *
 * Usage: npx tsx acquisition/src/_frag-triage-dump.ts
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const REPORT = join(ROOT, "work", "coverage", "zone-contiguity.json");

interface CityReport {
  slug: string;
  status: string;
  features: number;
  multipart_zones: number;
  max_parts: number;
  mean_parts: number;
  sliver_zones: number;
  dispersed_urban_zones: string[];
  over_fragmented_zones: string[];
  confidence?: string;
  contour_auto?: boolean;
  source?: string;
}

const data = JSON.parse(readFileSync(REPORT, "utf8")) as { cities: CityReport[] };
const frag = data.cities.filter((c) => c.status === "fragmented").sort((a, b) => b.mean_parts - a.mean_parts);
console.log(`fragmented cities: ${frag.length}`);
for (const c of frag) {
  console.log(`\n=== ${c.slug} ===`);
  console.log(`  features=${c.features} multipart_zones=${c.multipart_zones} max_parts=${c.max_parts} mean_parts=${c.mean_parts}`);
  console.log(`  confidence=${c.confidence} contour_auto=${c.contour_auto}`);
  console.log(`  source=${c.source}`);
  console.log(`  over_fragmented_zones (${c.over_fragmented_zones.length}): ${c.over_fragmented_zones.join(", ")}`);
}
