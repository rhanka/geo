/**
 * _hemmingford-vector-merge.ts — ONE-OFF (this mission, zone-contiguity
 * `fragmented` triage): replace the contour-auto geometry of
 * qc-zonage-hemmingford--les-jardins-de-napierville--2 (38 zones, 180 parts,
 * max 10 — status "fragmented", 6 over_fragmented_zones: HA-3/5/6/7/9, HC-2)
 * for every zone_code a T1 rebuild resolves, off a NEWLY-DISCOVERED dedicated
 * "Annexe A - Plan de zonage général" GeoPDF:
 *   villagedehemmingford.ca/.../20220718135723-reg293-annexe-a-plan-de-zonage-
 *   general-version-administrative.pdf
 * Embedded NAD83 Transverse Mercator georef, residual 0.073 m (verified via
 * _diag-vp-georef.ts). Labels are selectable text: t1-build --labels text
 * (default) resolves 37/38 dict codes, spatial gate 1.76 km.
 *
 * NOTE on scope: this composite slug's attached cadastre spans ~124 km²
 * (total_cadastre_area_km2) while the Village of Hemmingford's own zoned plan
 * only covers ~12.8 km² (pct_area_covered 10.27%) — the slug pools a much
 * larger regional cadastre (Hemmingford + Les Jardins-de-Napierville) than
 * the Village's own zoning territory. This is NOT a regression: the
 * currently-served collection ALREADY only carries the Village's 38
 * HA/HB/HC/CV/AF/IN/MX/PU codes (same limited scope), so this rebuild matches
 * the EXISTING territorial scope, just with materially cleaner geometry.
 *
 * PARTIAL merge ATTEMPTED (like _sskostka-vector-merge.ts): T1 resolves
 * 37/38 codes; 1 code (HC-4, NOT itself over-fragmented) gets 0 lots.
 *
 * ⛔ BLOCKED, NOT DEPLOYED (--dry-run only, S3 untouched): the SAME structural
 * issue as _saint-amable-vector-merge.ts, just at N=1 instead of N=18 —
 * DIFFERENCE(HC-4_old, T1_UNION) is EMPTY (HC-4's old footprint is entirely
 * inside the new T1 zones' territory, mostly HA-9 at 82.8% of HC-4's area),
 * so the anti-invention "never drop to nothing" fallback keeps HC-4
 * unclipped, which then REALLY overlaps HA-8/HA-9/HB-4. Dropping HC-4 instead
 * would silently remove one regulated code that wasn't even part of the
 * fragmentation problem being fixed. For consistency with the saint-amable
 * call (same failure mode, same reasoning), this is left UNDEPLOYED rather
 * than making an ad-hoc one-code exception.
 *
 * Usage: npx tsx acquisition/src/_hemmingford-vector-merge.ts --dry-run
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as polyclip from "polyclip-ts";
import { s3Client, BUCKET, getGeoJsonFeatureCollection, putBytes, copyObject, exists } from "./lib/s3.js";

const SLUG = "hemmingford--les-jardins-de-napierville--2";
const KEY = `normalized/ca-qc-zonage/qc-zonage-${SLUG}.geojson`;
const BACKUP_KEY = `normalized/ca-qc-zonage/_replaced/qc-zonage-${SLUG}__contour-auto-preclip.geojson`; // hors namespace servi, sous _replaced/ (index-exclu) — dé-entropie #4
const T1_LOCAL = "/home/antoinefa/.cache-tmp/frag-triage/t1-hemm/qc-zonage-hemmingford--les-jardins-de-napierville--2.geojson";

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
  console.log(`T1_UNION area (deg2) = ${multiAreaDeg2(t1Union).toExponential(3)} over ${upgradedCodes.length} codes`);

  const merged: Feature[] = [];
  const droppedToNothing: string[] = [];
  for (const code of upgradedCodes) {
    const servedFeat = servedByCode.get(code)!;
    const t1Feat = t1ByCode.get(code)!;
    merged.push({
      type: "Feature",
      properties: {
        ...servedFeat.properties,
        geom_fix_source_pdf: "villagedehemmingford.ca reg293-annexe-a-plan-de-zonage-general-version-administrative.pdf (reglement 293)",
        geom_fix_georef_residual_m: 0.073,
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
      console.log(`  difference() failed for ${code}: ${e} — keeping unclipped`);
      clipped = servedGeom;
    }
    const clippedArea = multiAreaDeg2(clipped);
    if (clippedArea <= 0 || clipped.length === 0) {
      droppedToNothing.push(code);
      merged.push(servedFeat);
      continue;
    }
    merged.push({
      type: "Feature",
      properties: { ...servedFeat.properties, geom_fix_clipped_by_t1: true, geom_fix_clip_date: "2026-07-19" },
      geometry: toGeoJsonGeom(clipped)!,
    });
  }

  if (merged.length !== servedByCode.size) throw new Error(`code count mismatch`);
  console.log(`upgraded=${upgradedCodes.length} fallback=${fallbackCodes.join(", ")}`);
  console.log(`fallback clipped to nothing (kept unclipped): ${droppedToNothing.join(", ") || "(none)"}`);

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
  const outPath = "/home/antoinefa/.cache-tmp/frag-triage/t1-hemm/qc-zonage-hemmingford.MERGED.geojson";
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
