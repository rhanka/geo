/**
 * _sutton-fullterritoire-diag.ts — READ-ONLY diagnostic (anti-invention) for the
 * SUTTON full-territory geometry gap. One pass over S3, ZERO writes.
 *
 * Answers the mission's step-1 questions verbatim:
 *   1. Served SIG zonage layer  (normalized/ca-qc-zonage/qc-zonage-<slug>.geojson):
 *      polygon count, bbox, distinct canonical + raw zone_codes.
 *   2. Cadastre lots layer       (normalized/qc-cadastre-lots/<slug>.geojson):
 *      bbox = the reference emprise the zonage MUST cover, lot count.
 *   3. Norms grille parquet       (registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet):
 *      distinct canonical codes.
 *   4. Coverage: which grille codes have NO geometry (canonical set difference),
 *      grouped by alpha family, with RURAL families (RUR/AF/AD/ECO/CONS/A/AGR/F/…)
 *      called out — these are the codes the urban-only geometry is missing.
 *   5. bbox comparison: does the served zonage emprise cover the cadastre emprise?
 *      Reports the area ratio and per-edge shortfall.
 *
 * Usage: npx tsx acquisition/src/_sutton-fullterritoire-diag.ts <slug>
 */
import type { S3Client } from "@aws-sdk/client-s3";

import { getBytes, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";
import { readParquetRowsFromBuffer } from "./lib/parquet-read.js";
import {
  canonZone,
  normsKey,
  resolveGridKey,
  sigZoneCodesFromGeojson,
  sigZoneCodesFromGeojsonRaw,
} from "./lib/zonage-norms.js";

const CAD_PREFIX = "normalized/qc-cadastre-lots/";

type BBox = { minx: number; miny: number; maxx: number; maxy: number; n: number };

function emptyBBox(): BBox {
  return { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity, n: 0 };
}

function* positions(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    yield [coords[0] as number, coords[1] as number];
    return;
  }
  for (const c of coords) yield* positions(c);
}

function accumulate(bbox: BBox, coords: unknown): void {
  for (const [x, y] of positions(coords)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < bbox.minx) bbox.minx = x;
    if (x > bbox.maxx) bbox.maxx = x;
    if (y < bbox.miny) bbox.miny = y;
    if (y > bbox.maxy) bbox.maxy = y;
    bbox.n++;
  }
}

function fmtBBox(b: BBox): string {
  if (b.n === 0) return "(empty)";
  return `[${b.minx.toFixed(4)},${b.miny.toFixed(4)} .. ${b.maxx.toFixed(4)},${b.maxy.toFixed(4)}]`;
}

/** Rough area of a lon/lat bbox in km² (equirectangular, cos-corrected). */
function bboxAreaKm2(b: BBox): number {
  if (b.n === 0) return 0;
  const latMid = ((b.miny + b.maxy) / 2) * (Math.PI / 180);
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos(latMid);
  return (b.maxx - b.minx) * kmPerDegLon * (b.maxy - b.miny) * kmPerDegLat;
}

/** Alpha family (leading A–Z run) of a canonical code; "" if none (bare numeric). */
function family(canon: string): string {
  const m = /^[A-Z]+/.exec(canon);
  return m ? m[0] : "(numeric)";
}

const RURAL_FAMILIES = new Set([
  "RUR", "AF", "AD", "ECO", "CONS", "A", "AGR", "F", "FOR", "REC", "VIL", "VILL",
  "CO", "CN", "AA", "AFT", "RU", "AGF", "PC", "REC",
]);

async function loadCadastreBBox(s3: S3Client, slug: string): Promise<{ key: string; bbox: BBox; lots: number } | null> {
  const key = `${CAD_PREFIX}${slug}.geojson`;
  type LotFeature = { geometry?: { coordinates?: unknown } | null };
  let fc;
  try {
    fc = await getGeoJsonFeatureCollection<LotFeature>(s3, key);
  } catch {
    return null;
  }
  const bbox = emptyBBox();
  let lots = 0;
  for (const f of fc.features ?? []) {
    if (!f.geometry) continue;
    lots++;
    accumulate(bbox, f.geometry.coordinates);
  }
  return { key, bbox, lots };
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) throw new Error("usage: _sutton-fullterritoire-diag.ts <slug>");
  const s3 = s3Client();

  console.log(`\n================ FULL-TERRITOIRE DIAG · ${slug} ================\n`);

  // 1) Served SIG zonage layer.
  const zoneKey = await resolveGridKey(s3, slug);
  let zoneBBox = emptyBBox();
  let zoneCanon = new Set<string>();
  let zoneRaw = new Set<string>();
  let zoneFeats = 0;
  if (!zoneKey) {
    console.log(`[1] ZONAGE SERVI : ABSENT en S3 (resolveGridKey -> null)`);
  } else {
    const body = (await getBytes(s3, zoneKey)).toString("utf8");
    zoneCanon = sigZoneCodesFromGeojson(body);
    zoneRaw = sigZoneCodesFromGeojsonRaw(body);
    const parsed = JSON.parse(body) as { features?: Array<{ geometry?: { coordinates?: unknown } | null }> };
    for (const f of parsed.features ?? []) {
      if (!f.geometry) continue;
      zoneFeats++;
      accumulate(zoneBBox, f.geometry.coordinates);
    }
    console.log(`[1] ZONAGE SERVI : key=${zoneKey}`);
    console.log(`    polygones=${zoneFeats}  bbox=${fmtBBox(zoneBBox)}  aire≈${bboxAreaKm2(zoneBBox).toFixed(1)} km²`);
    console.log(`    codes canon distincts=${zoneCanon.size}  codes raw distincts=${zoneRaw.size}`);
  }

  // 2) Cadastre lots — the reference emprise.
  const cad = await loadCadastreBBox(s3, slug);
  if (!cad) {
    console.log(`\n[2] CADASTRE : ABSENT (${CAD_PREFIX}${slug}.geojson introuvable)`);
  } else {
    console.log(`\n[2] CADASTRE : key=${cad.key}`);
    console.log(`    lots=${cad.lots}  bbox=${fmtBBox(cad.bbox)}  aire≈${bboxAreaKm2(cad.bbox).toFixed(1)} km²`);
  }

  // 3) Norms grille parquet.
  const gKey = normsKey(slug);
  let grilleCanon = new Set<string>();
  try {
    const buf = await getBytes(s3, gKey);
    const rows = await readParquetRowsFromBuffer(buf, ["zone_code"]);
    for (const r of rows) {
      const c = r["zone_code"];
      if (c !== null && c !== undefined && String(c).trim()) grilleCanon.add(canonZone(String(c)));
    }
    console.log(`\n[3] GRILLE NORMES : key=${gKey}  codes canon distincts=${grilleCanon.size}`);
  } catch (e) {
    console.log(`\n[3] GRILLE NORMES : ABSENTE/illisible (${String(e).slice(0, 80)})`);
  }

  // 4) Coverage: grille codes with NO geometry, grouped by family.
  const missing = [...grilleCanon].filter((c) => !zoneCanon.has(c)).sort();
  const present = [...grilleCanon].filter((c) => zoneCanon.has(c)).sort();
  console.log(`\n[4] COUVERTURE CODES (grille ∩ géométrie servie)`);
  console.log(`    grille=${grilleCanon.size}  avec géométrie=${present.length}  SANS géométrie=${missing.length}`);
  if (grilleCanon.size > 0) {
    console.log(`    z∩grille (part des codes servis présents dans la grille) = ${
      zoneCanon.size ? ((present.length / zoneCanon.size) * 100).toFixed(2) : "0"
    }%  [G1 = |zone∩grille|/|zone|]`);
  }
  const byFam = new Map<string, { present: number; missing: number; miss: string[] }>();
  for (const c of grilleCanon) {
    const fam = family(c);
    const rec = byFam.get(fam) ?? { present: 0, missing: 0, miss: [] };
    if (zoneCanon.has(c)) rec.present++;
    else {
      rec.missing++;
      if (rec.miss.length < 8) rec.miss.push(c);
    }
    byFam.set(fam, rec);
  }
  const fams = [...byFam.entries()].sort((a, b) => b[1].missing - a[1].missing);
  console.log(`    --- familles (present/missing) ---`);
  for (const [fam, rec] of fams) {
    const rural = RURAL_FAMILIES.has(fam) ? " «RURAL»" : "";
    const flag = rec.missing > 0 ? " ⚠" : " ✓";
    console.log(
      `    ${flag} ${fam.padEnd(8)} present=${String(rec.present).padStart(3)} missing=${String(rec.missing).padStart(3)}${rural}` +
        (rec.missing > 0 ? `  ex=[${rec.miss.join(", ")}]` : ""),
    );
  }

  // 5) bbox comparison — does the served zonage cover the cadastre emprise?
  if (cad && zoneFeats > 0 && cad.bbox.n > 0) {
    const zArea = bboxAreaKm2(zoneBBox);
    const cArea = bboxAreaKm2(cad.bbox);
    const ratio = cArea > 0 ? zArea / cArea : 0;
    // How much of the cadastre bbox does the zonage bbox fail to reach on each edge (deg)?
    const westGap = Math.max(0, zoneBBox.minx - cad.bbox.minx);
    const eastGap = Math.max(0, cad.bbox.maxx - zoneBBox.maxx);
    const southGap = Math.max(0, zoneBBox.miny - cad.bbox.miny);
    const northGap = Math.max(0, cad.bbox.maxy - zoneBBox.maxy);
    console.log(`\n[5] EMPRISE zonage-servi vs cadastre`);
    console.log(`    aire zonage / aire cadastre ≈ ${(ratio * 100).toFixed(1)}%`);
    console.log(
      `    débords cadastre NON couverts (deg): W=${westGap.toFixed(4)} E=${eastGap.toFixed(4)} S=${southGap.toFixed(4)} N=${northGap.toFixed(4)}`,
    );
    const covers = westGap < 0.002 && eastGap < 0.002 && southGap < 0.002 && northGap < 0.002;
    console.log(`    VERDICT emprise : ${covers ? "couvre le cadastre" : "NE couvre PAS le cadastre (géométrie partielle)"}`);
  }

  console.log(`\n================ FIN DIAG ================\n`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
