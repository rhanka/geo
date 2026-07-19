/**
 * _frag-triage-part-stats.ts — ONE-OFF (zone-contiguity `fragmented` triage
 * mission): for every over_fragmented_zone of every fragmented city (except
 * saint-stanislas-de-kostka, already rectified), compute PER-PART geometry
 * evidence beyond the audit's parts-count: min/median/max part area (m²,
 * roughly deg²→m² via local latitude), the min/max ratio (a huge ratio =
 * many tiny SLIVER shards mixed with a real parcel = classic contour-auto
 * raster-vectorisation noise), and centroid dispersion (already in the shared
 * audit) — the discriminator between "genuinely many separate real parcels of
 * comparable size" (legitimate multi-site zoning) and "auto-derived contour
 * noise" (many degenerate slivers).
 *
 * Read-only: does NOT touch work/coverage/zone-contiguity.json.
 *
 * Usage: npx tsx acquisition/src/_frag-triage-part-stats.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exists, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const REPORT = join(ROOT, "work", "coverage", "zone-contiguity.json");
const PREFIX = "normalized/ca-qc-zonage/";

interface CityReport {
  slug: string;
  status: string;
  over_fragmented_zones: string[];
}

interface Feature {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
}

function zonageKeys(slug: string): string[] {
  return [`${PREFIX}qc-zonage-${slug}.geojson`, `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`];
}

function isRing(r: unknown): r is number[][] {
  return Array.isArray(r) && r.length >= 3 && r.every((p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number");
}
function outerRings(geom: { type?: string; coordinates?: unknown }): number[][][] {
  if (!geom || !Array.isArray(geom.coordinates)) return [];
  const out: number[][][] = [];
  if (geom.type === "Polygon") {
    const r = (geom.coordinates as unknown[])[0];
    if (isRing(r)) out.push(r);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates as unknown[]) {
      const r = Array.isArray(poly) ? poly[0] : undefined;
      if (isRing(r)) out.push(r);
    }
  }
  return out;
}
function ringAreaDeg2(ring: number[][]): number {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % n]!;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
function ringCentroid(ring: number[][]): [number, number] {
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  const n = ring.length || 1;
  return [sx / n, sy / n];
}
// rough deg2 -> m2 at latitude lat (WGS84, local equirectangular approx).
function deg2ToM2(areaDeg2: number, latDeg: number): number {
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos((latDeg * Math.PI) / 180);
  return areaDeg2 * mPerDegLat * mPerDegLon;
}

async function main(): Promise<void> {
  const data = JSON.parse(readFileSync(REPORT, "utf8")) as { cities: CityReport[] };
  const frag = data.cities.filter((c) => c.status === "fragmented" && c.slug !== "saint-stanislas-de-kostka");
  const s3 = s3Client();

  for (const c of frag) {
    console.log(`\n########## ${c.slug} ##########`);
    let fc: { features: Feature[] } | null = null;
    for (const key of zonageKeys(c.slug)) {
      if (!(await exists(s3, key))) continue;
      fc = await getGeoJsonFeatureCollection<Feature>(s3, key);
      break;
    }
    if (!fc) { console.log("  collection introuvable"); continue; }

    // city bbox diag + rough lat0
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of fc.features) for (const r of outerRings(f.geometry ?? {})) for (const [x, y] of r) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const lat0 = (minY + maxY) / 2;
    const diagDeg = Math.hypot(maxX - minX, maxY - minY) || 1;

    for (const code of c.over_fragmented_zones) {
      const feat = fc.features.find((f) => f.properties?.["zone_code"] === code);
      if (!feat) { console.log(`  ${code}: INTROUVABLE`); continue; }
      const rings = outerRings(feat.geometry ?? {});
      const areasM2 = rings.map((r) => deg2ToM2(ringAreaDeg2(r), lat0));
      areasM2.sort((a, b) => a - b);
      const centroids = rings.map(ringCentroid);
      let maxSep = 0;
      for (let i = 0; i < centroids.length; i++) for (let j = i + 1; j < centroids.length; j++) {
        const d = Math.hypot(centroids[i]![0] - centroids[j]![0], centroids[i]![1] - centroids[j]![1]);
        if (d > maxSep) maxSep = d;
      }
      const dispersion = maxSep / diagDeg;
      const min = areasM2[0] ?? 0;
      const median = areasM2[Math.floor(areasM2.length / 2)] ?? 0;
      const max = areasM2[areasM2.length - 1] ?? 0;
      const ratio = min > 0 ? max / min : Infinity;
      const usageDominant = feat.properties?.["usage_dominant"];
      const kind = feat.properties?.["kind"];
      console.log(
        `  ${code}\tparts=${rings.length}\tarea m2[min=${min.toFixed(0)} med=${median.toFixed(0)} max=${max.toFixed(0)}]\tratio=${ratio.toFixed(1)}\tdispersion=${dispersion.toFixed(3)}\tkind=${kind}\tusage_dominant=${usageDominant}`,
      );
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
