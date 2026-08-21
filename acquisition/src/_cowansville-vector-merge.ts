/**
 * _cowansville-vector-merge.ts — ONE-OFF (this mission, zone-contiguity
 * `fragmented` triage): replace the contour-auto geometry of
 * qc-zonage-cowansville (239 zones, 882 parts, max 11 — status "fragmented",
 * 14 over_fragmented_zones incl. RA-8/RAA-2/RB-16/RC-9/RD-1/RD-6/CBC-1) with a
 * T1 rebuild off a NEWLY-DISCOVERED dedicated "Annexe I - Plan de zonage"
 * GeoPDF (distinct from the codified règlement text):
 *   cowansville.ca/.../plan-de-zonage/1841-ANNEXEI-PZ-2016-01-Amend.1841-25-2020.pdf
 * Single-page ArcGIS Pro export (3600x2016 pt), embedded "Modified TM
 * Projection" georef, residual 0.166 m (verified via _diag-vp-georef.ts).
 * Labels are selectable text: t1-build --labels text resolves 238/239 dict
 * codes, 100% lots assigned, spatial gate 1.05 km.
 *
 * WHOLESALE replacement with ONE documented, justified drop: the single
 * unresolved code is `PZ-2016-01` — already independently identified as
 * PARASITIC in acquisition/config/usage-dominant-map/cowansville.json's
 * verbatim note ("PZ -> null explicite: PZ-2016-01 est le NUMÉRO DU PLAN de
 * zonage fuité dans le champ zone_code du SIG", usage_dominant already null,
 * no reglement article defines it as a zone) — it is the zoning PLAN's own
 * file/sheet number, leaked into the zone_code field by the SIG source, not
 * a real regulated zone. Unlike saint-amable/hemmingford (where the T1
 * rebuild's competition displaced REAL regulated codes), here 100% of the
 * cadastre resolves and the one casualty is confirmed non-regulatory data —
 * DIFFERENCE(PZ-2016-01_old, T1_UNION) is empty (as expected at 100% lot
 * coverage) and this script DROPS it rather than keeping a stale unclipped
 * duplicate that would only re-serve known-bad geometry under a fake code.
 *
 * Usage: npx tsx acquisition/src/_cowansville-vector-merge.ts [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { s3Client, BUCKET, getGeoJsonFeatureCollection, putBytes, copyObject, exists } from "./lib/s3.js";

const SLUG = "cowansville";
const KEY = `normalized/ca-qc-zonage/qc-zonage-${SLUG}.geojson`;
const BACKUP_KEY = `normalized/ca-qc-zonage/_replaced/qc-zonage-${SLUG}__contour-auto-preclip.geojson`; // hors namespace servi, sous _replaced/ (index-exclu) — dé-entropie #4
const T1_LOCAL = "/home/antoinefa/.cache-tmp/frag-triage/t1-cow/qc-zonage-cowansville.geojson";
const KNOWN_JUNK_CODES = new Set(["PZ-2016-01"]);

interface Feature { type: "Feature"; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }

function countParts(geom: { type?: string; coordinates?: unknown } | undefined): number {
  if (!geom) return 0;
  if (geom.type === "Polygon") return 1;
  if (geom.type === "MultiPolygon") return (geom.coordinates as unknown[]).length;
  return 0;
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

  const codes = [...servedByCode.keys()];
  const missing = codes.filter((c) => !t1ByCode.has(c));
  const unexpectedMissing = missing.filter((c) => !KNOWN_JUNK_CODES.has(c));
  if (unexpectedMissing.length > 0) {
    console.log(`ABORT: T1 rebuild is missing ${unexpectedMissing.length} UNEXPLAINED served code(s): ${unexpectedMissing.join(", ")}`);
    console.log("(anti-invention: only pre-vetted known-junk codes may be dropped)");
    process.exit(2);
  }
  console.log(`missing (expected, known-junk): ${missing.join(", ") || "(none)"}`);

  const merged: Feature[] = [];
  for (const code of codes) {
    if (KNOWN_JUNK_CODES.has(code) && !t1ByCode.has(code)) {
      console.log(`DROPPING known-junk code (no T1 resolution, verbatim-documented as parasitic): ${code}`);
      continue; // dropped, not carried forward
    }
    const servedFeat = servedByCode.get(code)!;
    const t1Feat = t1ByCode.get(code)!;
    merged.push({
      type: "Feature",
      properties: {
        ...servedFeat.properties,
        geom_fix_source_pdf: "cowansville.ca 1841-ANNEXEI-PZ-2016-01-Amend.1841-25-2020.pdf (Annexe I - Plan de zonage, reglement 1841)",
        geom_fix_georef_residual_m: 0.166,
        geom_fix_method: "cadastre-nearest-label-t1-text",
        geom_fix_date: "2026-07-19",
      },
      geometry: t1Feat.geometry,
    });
  }

  const droppedCount = codes.length - merged.length;
  if (droppedCount !== missing.length) throw new Error(`unexpected drop count: ${droppedCount} vs missing ${missing.length}`);

  const beforeParts = codes.reduce((s, c) => s + countParts(servedByCode.get(c)!.geometry), 0);
  const afterParts = merged.reduce((s, f) => s + countParts(f.geometry), 0);
  const maxAfter = Math.max(...merged.map((f) => countParts(f.geometry)));
  console.log(`codes before=${codes.length} after=${merged.length} (dropped ${droppedCount} known-junk) parts before=${beforeParts} after=${afterParts} (${(100 * (beforeParts - afterParts) / beforeParts).toFixed(1)}% reduction) maxAfter=${maxAfter}`);

  const out = { type: "FeatureCollection", features: merged };
  const outPath = "/home/antoinefa/.cache-tmp/frag-triage/t1-cow/qc-zonage-cowansville.MERGED.geojson";
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
