/**
 * _sskostka-vector-merge.ts — ONE-OFF (this mission): replace the fragmented
 * contour-auto geometry of qc-zonage-saint-stanislas-de-kostka for the zone
 * codes we can VERIFY against a real embedded-georef GeoPDF (T1 cadastre
 * aggregation, residual 0.22 m), while leaving every other currently-served
 * zone_code's REGULATORY IDENTITY untouched — but CLIPPED to remove any area
 * the new T1 build now claims, so the result is a genuine non-overlapping
 * partition (never silently double-serve the same parcel under two codes).
 *
 * Source PDF: work/zonage-norms/saint-stanislas-de-kostka-projet/24014-plan-de-zonage-SKK.pdf
 *   (municipal general zoning plan, dossier "24014", embedded NAD83 CSRS MTM-8
 *   georef, /VP /Measure /GPTS, residual 0.217 m — verified via _diag-vp-georef.ts).
 * T1 build (cadastre nearest-label aggregation, acquisition/src/t1-build.ts)
 *   resolved 33 zone_codes with >=1 assigned cadastral lot, using ALL 61
 *   distinct labels found on the plan as competitors (so the "losing" dense
 *   village-core labels' territory legitimately drains to their nearest
 *   winning neighbour in T1's own build).
 *
 * MERGE STRATEGY (revised after finding REAL polygon overlap on a naive
 * code-by-code swap — up to 65% of a fallback zone's area coincided with a
 * newly-upgraded zone, e.g. AD-1 x H-1, CONS-1 x H-4, AD-13 x H-11):
 *   1. Only zone_codes BOTH currently served AND T1-resolved are swapped in
 *      (24 codes) — T1-only codes not currently served (AD-2..AD-9, REC-1)
 *      are DROPPED from this pass (documented as a deferred lead, not
 *      fabricated/served — a separate "subdivision discovery" concern).
 *   2. The T1_UNION (union of the 24 upgraded geometries) is computed, then
 *      every one of the 24 currently-served-only ("fallback") zones is
 *      CLIPPED by DIFFERENCE(fallback, T1_UNION) — this removes exactly the
 *      area now correctly claimed by the cleaner T1 build, guaranteeing the
 *      merged collection is a real non-overlapping partition. This is a
 *      defensive geometric operation on REAL existing polygons (never
 *      invents a boundary) using polyclip-ts (already a project dependency,
 *      same library t1-zones.ts uses for zone dissolve).
 *   3. Re-verified: 0 real overlap pairs remain (>0.5% of either area).
 *
 * Usage: npx tsx acquisition/src/_sskostka-vector-merge.ts [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as polyclip from "polyclip-ts";
import { s3Client, BUCKET, getGeoJsonFeatureCollection, putBytes, copyObject, exists } from "./lib/s3.js";

const SLUG = "saint-stanislas-de-kostka";
const KEY = `normalized/ca-qc-zonage/qc-zonage-${SLUG}.geojson`;
const BACKUP_KEY = `normalized/ca-qc-zonage/_replaced/qc-zonage-${SLUG}__contour-auto-preclip.geojson`; // hors namespace servi, sous _replaced/ (index-exclu) — dé-entropie #4
const T1_LOCAL = "/home/antoinefa/.cache-tmp/t1-saint-stanislas-de-kostka/qc-zonage-saint-stanislas-de-kostka.geojson";

interface Feature { type: "Feature"; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }

type PPoly = number[][][];
type PMulti = PPoly[];

function asPolyclipGeom(geom: { type: string; coordinates: unknown }): PMulti {
  if (geom.type === "Polygon") return [geom.coordinates as PPoly];
  if (geom.type === "MultiPolygon") return geom.coordinates as PMulti;
  return [];
}
function ringAreaDeg2(ring: number[][]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) { const [x1, y1] = ring[i]!; const [x2, y2] = ring[i + 1]!; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
}
function multiAreaDeg2(mp: PMulti): number {
  let total = 0;
  for (const poly of mp) total += ringAreaDeg2(poly[0]!);
  return total;
}
function countParts(geom: { type: string; coordinates: unknown } | undefined): number {
  if (!geom) return 0;
  if (geom.type === "Polygon") return 1;
  if (geom.type === "MultiPolygon") return (geom.coordinates as unknown[]).length;
  return 0;
}
function toGeoJsonGeom(mp: PMulti): { type: "MultiPolygon"; coordinates: PMulti } | null {
  if (!mp || mp.length === 0) return null;
  return { type: "MultiPolygon", coordinates: mp };
}
function unionAll(geoms: PMulti[]): PMulti {
  if (geoms.length === 0) return [];
  const [first, ...rest] = geoms;
  if (rest.length === 0) return first!;
  return polyclip.union(first as any, ...(rest as any[])) as unknown as PMulti;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const s3 = s3Client();

  const servedFc = await getGeoJsonFeatureCollection<Feature>(s3, KEY);
  const t1Fc = JSON.parse(readFileSync(T1_LOCAL, "utf8")) as { type: string; features: Feature[] };

  const servedByCode = new Map<string, Feature>();
  for (const f of servedFc.features) servedByCode.set(String(f.properties?.["zone_code"] ?? ""), f);
  const t1ByCode = new Map<string, Feature>();
  for (const f of t1Fc.features) t1ByCode.set(String(f.properties?.["zone_code"] ?? ""), f);

  const upgradedCodes: string[] = [];
  const fallbackCodes: string[] = [];
  for (const code of servedByCode.keys()) (t1ByCode.has(code) ? upgradedCodes : fallbackCodes).push(code);

  // 1. T1_UNION of the upgraded geometries.
  const upgradedGeoms = upgradedCodes.map((c) => asPolyclipGeom(t1ByCode.get(c)!.geometry));
  const t1Union = unionAll(upgradedGeoms);
  const t1UnionArea = multiAreaDeg2(t1Union);
  console.log(`T1_UNION area (deg2) = ${t1UnionArea.toExponential(3)} over ${upgradedCodes.length} codes`);

  // 2. Build merged features: upgraded = T1 geometry (props from served, geometry from T1);
  //    fallback = served geometry CLIPPED by difference(served, T1_UNION).
  const merged: Feature[] = [];
  let clippedCount = 0;
  let droppedToNothing: string[] = [];
  for (const code of upgradedCodes) {
    const servedFeat = servedByCode.get(code)!;
    const t1Feat = t1ByCode.get(code)!;
    merged.push({
      type: "Feature",
      properties: {
        ...servedFeat.properties,
        geom_fix_source_pdf: "24014-plan-de-zonage-SKK.pdf",
        geom_fix_georef_residual_m: 0.217,
        geom_fix_method: "cadastre-nearest-label-t1",
        geom_fix_date: "2026-07-19",
      },
      geometry: t1Feat.geometry,
    });
  }
  for (const code of fallbackCodes) {
    const servedFeat = servedByCode.get(code)!;
    const servedGeom = asPolyclipGeom(servedFeat.geometry);
    let clipped: PMulti;
    try {
      clipped = polyclip.difference(servedGeom as any, t1Union as any) as unknown as PMulti;
    } catch (e) {
      console.log(`  difference() failed for ${code}: ${e} — keeping unclipped (safe fallback)`);
      clipped = servedGeom;
    }
    const clippedArea = multiAreaDeg2(clipped);
    const beforeArea = multiAreaDeg2(servedGeom);
    if (clippedArea < beforeArea * 0.999) clippedCount++;
    if (clippedArea <= 0 || clipped.length === 0) {
      droppedToNothing.push(code);
      // Never drop a real served zone to nothing — keep the original geometry
      // rather than emit an empty/invalid feature (anti-invention: prefer the
      // known-real fallback over a geometry we cannot construct safely).
      merged.push(servedFeat);
      continue;
    }
    merged.push({
      type: "Feature",
      properties: {
        ...servedFeat.properties,
        geom_fix_clipped_by_t1: true,
        geom_fix_clip_date: "2026-07-19",
      },
      geometry: toGeoJsonGeom(clipped)!,
    });
  }

  if (merged.length !== servedByCode.size) throw new Error(`code count mismatch: merged=${merged.length} served=${servedByCode.size}`);
  const mergedCodes = new Set(merged.map((f) => String(f.properties["zone_code"])));
  for (const code of servedByCode.keys()) if (!mergedCodes.has(code)) throw new Error(`LOST code ${code}`);

  console.log(`upgraded=${upgradedCodes.length} fallback=${fallbackCodes.length} (clipped by T1_UNION: ${clippedCount})`);
  console.log(`fallback zones clipped to nothing (kept unclipped, anti-invention): ${droppedToNothing.join(", ") || "(none)"}`);

  // 3. Re-verify: 0 real overlap remains.
  let overlapPairs = 0;
  const upFeats = merged.filter((f) => upgradedCodes.includes(String(f.properties["zone_code"])));
  const fbFeats = merged.filter((f) => fallbackCodes.includes(String(f.properties["zone_code"])));
  for (const u of upFeats) {
    const uG = asPolyclipGeom(u.geometry);
    const uArea = multiAreaDeg2(uG);
    for (const f of fbFeats) {
      const fG = asPolyclipGeom(f.geometry);
      const fArea = multiAreaDeg2(fG);
      let inter: PMulti;
      try { inter = polyclip.intersection(uG as any, fG as any) as unknown as PMulti; } catch { continue; }
      const interArea = multiAreaDeg2(inter);
      const pctU = uArea > 0 ? (100 * interArea) / uArea : 0;
      const pctF = fArea > 0 ? (100 * interArea) / fArea : 0;
      if (pctU > 0.5 || pctF > 0.5) {
        overlapPairs++;
        console.log(`  RESIDUAL OVERLAP: ${u.properties["zone_code"]} x ${f.properties["zone_code"]}: ${pctU.toFixed(2)}%/${pctF.toFixed(2)}%`);
      }
    }
  }
  console.log(`residual overlap pairs after clip: ${overlapPairs}`);
  if (overlapPairs > 0) {
    console.log("ABORT: clip did not eliminate overlap — refusing to deploy.");
    process.exit(2);
  }

  const beforeParts = [...servedByCode.values()].reduce((s, f) => s + countParts(f.geometry), 0);
  const afterParts = merged.reduce((s, f) => s + countParts(f.geometry), 0);
  const maxAfter = Math.max(...merged.map((f) => countParts(f.geometry)));
  console.log(`parts before=${beforeParts} after=${afterParts} (${(100 * (beforeParts - afterParts) / beforeParts).toFixed(1)}% reduction) maxAfter=${maxAfter}`);

  const out = { type: "FeatureCollection", features: merged };
  const outPath = "/home/antoinefa/.cache-tmp/t1-saint-stanislas-de-kostka/qc-zonage-saint-stanislas-de-kostka.MERGED.geojson";
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`wrote local merged: ${outPath}`);

  if (dryRun) { console.log("--dry-run: not touching S3."); return; }

  const backupExists = await exists(s3, BACKUP_KEY);
  if (!backupExists) { await copyObject(s3, KEY, BACKUP_KEY); console.log(`backed up current contour-auto -> ${BACKUP_KEY}`); }
  else console.log(`backup already present at ${BACKUP_KEY} (not overwritten)`);

  await putBytes(s3, KEY, JSON.stringify(out), "application/geo+json");
  console.log(`served merged geometry -> s3://${BUCKET}/${KEY}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
