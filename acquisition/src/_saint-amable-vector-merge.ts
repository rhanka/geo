/**
 * _saint-amable-vector-merge.ts — ONE-OFF (this mission, zone-contiguity
 * `fragmented` triage): replace the contour-auto geometry of
 * qc-zonage-saint-amable (104 zones, 967 parts, max 34 — status "fragmented",
 * 31 over_fragmented_zones) for every zone_code a T1 rebuild resolves, off a
 * NEWLY-DISCOVERED dedicated "Plan de zonage" GeoPDF (distinct from the
 * codified règlement text, same pattern as notre-dame-de-lourdes--joliette):
 *   https://www.st-amable.qc.ca/wp-content/uploads/2023/02/saint-amable-plan-zonage-urbanisme-ville.pdf
 * 2-page ArcGIS Pro export (p1 = territory overview 1:40000, p2 = urban-core
 * detail inset "A" 1:17000), embedded WGS84 Web-Mercator georef, residual
 * 0.00 m (verified via _diag-vp-georef.ts). Labels are SELECTABLE TEXT (no
 * vision needed): t1-build --labels text (default), reading BOTH pages
 * (pdftotext with no --page pools every page), 104/104 dict-authoritative
 * codes matched, 100% lots assigned, spatial gate 0.38 km.
 *
 * PARTIAL merge attempted (like _sskostka-vector-merge.ts, NOT a wholesale
 * replacement like _ndl-joliette-vector-merge.ts): the T1 cadastre-aggregation
 * (single 104-code nearest-label competition, buildZones) assigned ZERO lots
 * to 18/104 codes (their label text was read and dict-validated, but every
 * nearby cadastral lot was nearest to a DIFFERENT competing label — small
 * infill zones systematically losing to a bigger/closer neighbour).
 *
 * ⛔ BLOCKED, NOT DEPLOYED (--dry-run only, S3 untouched): because T1 reached
 * 100% lot-to-zone coverage using ALL 104 labels as competitors, T1_UNION
 * (the union of the 86 upgraded zones) geometrically covers the ENTIRE
 * municipality — so DIFFERENCE(fallback_zone, T1_UNION) is EMPTY for every
 * one of the 18 fallback codes (verified: all 18 hit `clippedArea<=0`, not a
 * couple of edge cases). The anti-invention "never drop a real zone to
 * nothing" safeguard then falls back to the UNCLIPPED old geometry — which
 * genuinely overlaps the new T1 zones (up to 100% of a fallback zone's area,
 * e.g. I-31 x H-138), because T1 already reassigned that exact ground to a
 * neighbour. There is no correct partial merge here: dropping the 18 codes
 * would silently remove regulated zones (incl. C-27/H-42/H-54/H-71/H-4, which
 * WERE over-fragmented) that other systems may still expect to resolve;
 * keeping them unclipped creates real double-served overlap. This is a
 * structural limitation of pure nearest-single-label-point competition on a
 * dense 104-zone urban mosaic, not a data/georef problem (the plan and its
 * georef are proven, residual 0.00 m) — needs a smarter aggregation (e.g.
 * area-weighted or buffered zone footprints) that is OUT OF SCOPE for this
 * $0 triage pass. Documented here so a future session does not re-grind this.
 *
 * Usage: npx tsx acquisition/src/_saint-amable-vector-merge.ts --dry-run
 *   (no non-dry-run path should be exercised until the aggregation issue above
 *   is actually solved — the script intentionally still ABORTS on overlap>0)
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as polyclip from "polyclip-ts";
import { s3Client, BUCKET, getGeoJsonFeatureCollection, putBytes, copyObject, exists } from "./lib/s3.js";

const SLUG = "saint-amable";
const KEY = `normalized/ca-qc-zonage/qc-zonage-${SLUG}.geojson`;
const BACKUP_KEY = `normalized/ca-qc-zonage/_replaced/qc-zonage-${SLUG}__contour-auto-preclip.geojson`; // hors namespace servi, sous _replaced/ (index-exclu) — dé-entropie #4
const T1_LOCAL = "/home/antoinefa/.cache-tmp/frag-triage/t1-sa-both/qc-zonage-saint-amable.geojson";

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
function countParts(geom: { type?: string; coordinates?: unknown } | undefined): number {
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

  const upgradedGeoms = upgradedCodes.map((c) => asPolyclipGeom(t1ByCode.get(c)!.geometry));
  const t1Union = unionAll(upgradedGeoms);
  const t1UnionArea = multiAreaDeg2(t1Union);
  console.log(`T1_UNION area (deg2) = ${t1UnionArea.toExponential(3)} over ${upgradedCodes.length} codes`);

  const merged: Feature[] = [];
  let clippedCount = 0;
  const droppedToNothing: string[] = [];
  for (const code of upgradedCodes) {
    const servedFeat = servedByCode.get(code)!;
    const t1Feat = t1ByCode.get(code)!;
    merged.push({
      type: "Feature",
      properties: {
        ...servedFeat.properties,
        geom_fix_source_pdf: "st-amable.qc.ca saint-amable-plan-zonage-urbanisme-ville.pdf (Plan de zonage, reglement 712-00-2013, p1+p2)",
        geom_fix_georef_residual_m: 0,
        geom_fix_method: "cadastre-nearest-label-t1-text",
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
  console.log(`fallback codes: ${fallbackCodes.join(", ")}`);
  console.log(`fallback zones clipped to nothing (kept unclipped, anti-invention): ${droppedToNothing.join(", ") || "(none)"}`);

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
  const outPath = "/home/antoinefa/.cache-tmp/frag-triage/t1-sa-both/qc-zonage-saint-amable.MERGED.geojson";
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
