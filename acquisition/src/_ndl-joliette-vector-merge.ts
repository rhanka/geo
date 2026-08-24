/**
 * _ndl-joliette-vector-merge.ts — ONE-OFF (this mission, zone-contiguity
 * `fragmented` triage): replace the contour-auto geometry of
 * qc-zonage-notre-dame-de-lourdes--joliette (43 zones, 567 parts, max 62 —
 * status "fragmented" in work/coverage/zone-contiguity.json) with a fresh T1
 * rebuild off a NEWLY-DISCOVERED single-page GeoPDF: the muni's dedicated
 * "Annexe B - Plan de zonage" (distinct from the codified règlement text,
 * which bundles unrelated annexes — 1993 flood-zone mapping, CPTAQ îlot
 * maps — and no zoning plan of its own):
 *   https://www.notredamedelourdes.ca/fichiersUpload/fichiers/20250225102826-plan-de-zonage-01-2023.pdf
 * Embedded NAD83 CSRS MTM-8 georef (/VP /Measure /GPTS), single page
 * (2384x1684 pt), residual 4.009 m (verified via _diag-vp-georef.ts).
 *
 * T1 build (--labels claude: the plan draws zone codes as leader-line-annotated
 * glyphs, not selectable text) read all 43 codes verbatim off the plan,
 * validated 43/43 exact against the dict of currently-served codes, 99.8%
 * lots assigned (1743/1746), spatial gate 0.57 km, 98.6% area covered.
 *
 * UNLIKE saint-stanislas-de-kostka (partial 24/48-code upgrade needing a
 * union→difference anti-overlap clip against the surviving contour-auto
 * fallback), this is a WHOLESALE replacement: T1's buildZones() nearest-label
 * cadastre aggregation assigns each lot to exactly ONE zone by construction,
 * so the new 43-zone collection is already a non-overlapping partition — no
 * clip step is needed. Every REGULATORY property already served (reglement_*,
 * usage_dominant if any, hauteur/marge/densite/superficie norms if folded) is
 * PRESERVED verbatim (old n_lots/source/confidence kept too, same convention
 * as _sskostka-vector-merge.ts) — only the geometry is replaced, plus
 * geom_fix_* provenance stamps. Non-destructive: backs up the pre-fix
 * contour-auto geometry to a sibling S3 key before overwriting.
 *
 * Usage: npx tsx acquisition/src/_ndl-joliette-vector-merge.ts [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { s3Client, BUCKET, getGeoJsonFeatureCollection, putBytes, copyObject, exists } from "./lib/s3.js";

const SLUG = "notre-dame-de-lourdes--joliette";
const KEY = `normalized/ca-qc-zonage/qc-zonage-${SLUG}.geojson`;
const BACKUP_KEY = `normalized/ca-qc-zonage/_replaced/qc-zonage-${SLUG}__contour-auto-preclip.geojson`; // hors namespace servi, sous _replaced/ (index-exclu) — dé-entropie #4
const T1_LOCAL = "/home/antoinefa/.cache-tmp/frag-triage/t1-ndl/qc-zonage-notre-dame-de-lourdes--joliette.geojson";

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
  if (missing.length > 0) {
    console.log(`ABORT: T1 rebuild is missing ${missing.length} served code(s): ${missing.join(", ")}`);
    console.log("(anti-invention: refusing a partial wholesale replacement — every served code must resolve)");
    process.exit(2);
  }

  const merged: Feature[] = codes.map((code) => {
    const servedFeat = servedByCode.get(code)!;
    const t1Feat = t1ByCode.get(code)!;
    return {
      type: "Feature",
      properties: {
        ...servedFeat.properties,
        geom_fix_source_pdf: "notredamedelourdes.ca 20250225102826-plan-de-zonage-01-2023.pdf (Annexe B - Plan de zonage, règlement 02-2023)",
        geom_fix_georef_residual_m: 4.009,
        geom_fix_method: "cadastre-nearest-label-t1-claude-vision",
        geom_fix_date: "2026-07-19",
      },
      geometry: t1Feat.geometry,
    };
  });

  const beforeParts = codes.reduce((s, c) => s + countParts(servedByCode.get(c)!.geometry), 0);
  const afterParts = merged.reduce((s, f) => s + countParts(f.geometry), 0);
  const maxAfter = Math.max(...merged.map((f) => countParts(f.geometry)));
  console.log(`codes=${codes.length} parts before=${beforeParts} after=${afterParts} (${(100 * (beforeParts - afterParts) / beforeParts).toFixed(1)}% reduction) maxAfter=${maxAfter}`);

  const out = { type: "FeatureCollection", features: merged };
  const outPath = "/home/antoinefa/.cache-tmp/frag-triage/t1-ndl/qc-zonage-notre-dame-de-lourdes--joliette.MERGED.geojson";
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
