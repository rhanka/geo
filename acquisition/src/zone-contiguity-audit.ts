/**
 * zone-contiguity-audit.ts — flag served zoning collections whose zone geometries are
 * INCONSISTENT (fragmented / scattered without geographic coherence), while NOT flagging
 * zones that are legitimately multi-part (rural/agricultural land is genuinely scattered
 * across many parcels — that is not a bug).
 *
 * This is the "hunt non-contiguous zones" chantier (owner + immo). It produces a committed
 * per-city report (work/coverage/zone-contiguity.json) that carries a `zone_geometry_status`
 * indicator immo can consume, plus the exact offending zone_codes so the rectification track
 * can act. It reads S3 (the served truth), never the API (which caches — memory
 * geo-api-collection-cache).
 *
 * The discriminating metric (the whole point — avoids the m9 false positive):
 *   - SLIVER: a part whose area is a tiny fraction of the city's median part area = auto-contour
 *     noise, not a real parcel.
 *   - DISPERSED URBAN ZONE: a NON-agricultural zone (urban ponctuel: H/C/I/M/R…) whose parts
 *     span most of the city AND sit at opposite ends. An urban zone should be local; scattered
 *     city-wide = a bad code grouping / dissolve. Agricultural prefixes (A/AF/AD/AV/F/AG…) are
 *     EXEMPT because their scatter is legitimate.
 *
 * Usage (from repo root):
 *   npx tsx acquisition/src/zone-contiguity-audit.ts               # all served cities
 *   npx tsx acquisition/src/zone-contiguity-audit.ts --slugs sutton,saint-stanislas-de-kostka
 *   npx tsx acquisition/src/zone-contiguity-audit.ts --slugs sutton --verbose
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { MATRIX_PATH, loadMatrix } from "./coverage-matrix.js";
import { exists, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";
import type { S3Client } from "@aws-sdk/client-s3";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const REPORT = join(ROOT, "work", "coverage", "zone-contiguity.json");
const PREFIX = "normalized/ca-qc-zonage/";

/**
 * Letter-tokens whose scatter is legitimate — not just rural/agricultural/forest/conservation
 * land (genuinely spread across many parcels), but any zone family that is SCATTERED BY DESIGN
 * rather than by dissolve accident. Matched against ANY letter run in the code, not just a
 * leading prefix, so `35-A`, `EAF-1`, `2A` are all recognised as rural.
 *
 * `P` (publique/institutionnelle) and `PI` (protection intégrale) were added after the
 * 2026-07-18 zone-contiguity-verif triage (work/delegation-mass/zone-contiguity-verif-*.md):
 * ascot-corner's P1 (6 parts, `kind:"institutional"`, `confidence:"contour-manual-gcp"` —
 * a trustworthy source, not contour noise) and saint-andre-de-kamouraska's 2PI (17 parts,
 * `usage_dominant:"environnemental"`, art. 3.2 codification verbatim "Pi — Protection
 * intégrale") both read as REAL, parcel-scale, multi-site facilities on S3 — public/civic
 * buildings (school, church, cemetery, fire hall, town hall…) and full-protection/conservation
 * areas (wetlands, steep slopes, watercourse buffers) are inherently distributed across a
 * municipality by administrative/ecological design, exactly like agricultural land. `CO`/`CONS`
 * were already exempt for the conservation family; `PI` is the same family under a different
 * municipal nomenclature (art. 3.2 legend: "Co Conservation; Pi Protection intégrale").
 *
 * `VC`/`VD`/`VILL`/`AFT`/`AIRE`/`RECB`/`RURA`/`CON`/`PE`/`AGV`/`DESC` were added after the
 * 2026-07-19 zone-contiguity `fragmented`-status triage (10 cities, work/coverage/zone-
 * contiguity.json): the FRAG_PARTS gate ignores agricultural prefixes but its exact-token
 * match missed several municipal nomenclatures for the SAME scattered-by-design families —
 * verbatim legend proof per city (acquisition/config/usage-dominant-map/<slug>.json):
 *   - preissac VC-1..VC-7/VD-1: règl. 239-2014 §3.2 "VC : Villégiature (consolidation) ;
 *     VD : Villégiature (développement)", explicitly grouped under "dominante résidentielle"
 *     — lakeside cottage lots, scattered by design like agricultural land (same exemption
 *     logic as A/AF/CO), NOT a contour-auto artefact.
 *   - stratford AFT1-3/AFT1-6 & VILL-4/6/14: règl. 1035 art.5.1 table "Af Agroforestière" /
 *     "Vill Villégiature" (règl. modif. 1098 verbatim: zone AFT1 = usages "à L'AGRICULTURE ET
 *     À LA FORÊT"); `AF` was already exempt but `AFT` (with its numeral-1 type suffix) is a
 *     distinct exact token, as is `VILL` (vs. the already-exempt `VIL`).
 *   - cowansville AIRE-2/25/26, RECB-3/8, RURA-1: règl. 1841 art.138 legend (p.200) "AIRE ->
 *     CONSERVATION", "RECt, RECb -> RÉCRÉATIVE" (the `REC` family under a 4-letter form),
 *     "RURA -> RURALE / AGRICOLE".
 *   - mont-saint-hilaire CON-1..4, PE-5/14: règl. 1235 art.14 legend "PE : Parc et espace
 *     vert"; `CON` (not the legend's typo'd `CN`) confirmed via art.58 "CON-1 Conservation"
 *     — civic parks/green-space and conservation land, same distributed-by-design family as
 *     `P`/`PI`/`CO`/`CONS` above.
 *   - chelsea AGV-1: règl. 1215-22 ch.1 legend "AGV : Agricole viable" — agricultural family.
 *   - cowansville DESC-1 (10 parts): règl. 1841 legend "DESH, DESC, DESI -> ÎLOT
 *     DESTRUCTURÉS" — CPTAQ "îlots déstructurés" are a PROVINCE-WIDE mechanism for pockets of
 *     non-agricultural use inside a dynamic agricultural zone, inherently non-contiguous BY
 *     DEFINITION (confirmed independently on a CPTAQ "Îlots déstructurés" map rendered while
 *     investigating notre-dame-de-lourdes--joliette: discrete numbered islets 01.1/01.2/01.4
 *     scattered across the farmland, not a single parcel) — same scattered-by-design logic as
 *     agricultural land, even though the local usage_dominant mapping declines to name one of
 *     the five served categories for it.
 * NOT added (insufficient verbatim proof of scattered-by-design, left as genuine défaut-franc
 * or undetermined candidates): chelsea REF (`Réserve foncière` — plausible but not proven
 * inherently multi-site), chelsea MIX1-CV/MIX2-CV/RES-CV, cowansville CBC/RA/RAA/RB/RC/RD,
 * hemmingford HA/HB/HC (habitation density classes, genuinely urban).
 */
const RURAL_TOKENS = new Set([
  "A", "AF", "AFT", "AD", "AV", "AG", "AGV", "AH", "AR", "AA", "AC", "AP", "EAF", "EA", "EX",
  "F", "FA", "FO", "FR", "RF", "ZA", "ZAD",
  "REC", "RECB", "RURA", "AIRE", "CONS", "CON", "CN", "CO", "V", "VR", "VIL", "VILL", "VC", "VD",
  "T", "RU", "RUR",
  "P", "PI", "PE", "DESC",
]);

type ZoneGeometryStatus = "clean" | "suspect" | "fragmented" | "dispersed";

/**
 * An urban (non-rural) zone with this many parts or more is SHATTERED, not merely
 * multi-part. saint-stanislas-de-kostka (contour-auto) served each code as one
 * MultiPolygon of 25–38 fragments — an artefact of auto-deriving contours from a
 * georeferenced raster, not real parcels. A genuine urban zone is one or a few
 * compact polygons; ≥8 disjoint parts for the same urban code is the contour-auto
 * signature. Requiring several such zones (FRAG_MIN_ZONES) before flagging the city
 * avoids tripping on a single oddly-drawn zone.
 */
const FRAG_PARTS = 8;
const FRAG_MIN_ZONES = 3;

interface ZoneMetric {
  zone_code: string;
  parts: number;
  sliver_parts: number;
  dispersion: number; // max centroid separation / city diagonal, 0..~1.4
  agricultural: boolean;
}

interface CityReport {
  slug: string;
  status: ZoneGeometryStatus;
  features: number;
  multipart_zones: number;
  max_parts: number;
  mean_parts: number; // total parts / zones — the city-wide fragmentation level
  sliver_zones: number;
  dispersed_urban_zones: string[]; // the offending non-agricultural zone_codes
  over_fragmented_zones: string[]; // non-rural codes shattered into ≥FRAG_PARTS parts
  confidence?: string; // dominant `confidence` property (contour-auto = approximate)
  contour_auto?: boolean; // geometry auto-derived from raster (rectifiable via official vector)
  source?: string;
  note?: string;
}

function zonageKeys(slug: string): string[] {
  return [`${PREFIX}qc-zonage-${slug}.geojson`, `${PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`];
}

/** True if ANY letter-run in the code is a rural/agricultural/forest/villégiature token. */
function isRuralCode(zoneCode: string): boolean {
  const runs = zoneCode.toUpperCase().match(/[A-Z]+/g) ?? [];
  if (runs.length === 0) return false; // purely numeric code — cannot vouch, treat as urban
  return runs.some((r) => RURAL_TOKENS.has(r));
}

/** Shoelace area (in deg², absolute) of a linear ring [[x,y],…]. */
function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % n]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function ringCentroid(ring: number[][]): [number, number] {
  let sx = 0, sy = 0;
  for (const [x, y] of ring) { sx += x; sy += y; }
  const n = ring.length || 1;
  return [sx / n, sy / n];
}

/** A valid outer ring = array of ≥3 [x,y] numeric points. */
function isRing(r: unknown): r is number[][] {
  return Array.isArray(r) && r.length >= 3 &&
    r.every((p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number");
}

/** Extract every polygon's outer ring from a (Multi)Polygon geometry, skipping malformed ones. */
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

interface Feature { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }

function auditCity(slug: string, features: Feature[]): CityReport {
  // City bbox for the diagonal (dispersion normaliser).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const perZone: { code: string; rings: number[][][] }[] = [];
  const confidences: string[] = [];
  for (const f of features) {
    const code = typeof f.properties?.["zone_code"] === "string" ? (f.properties!["zone_code"] as string) : "";
    const rings = outerRings(f.geometry ?? {});
    if (!code || rings.length === 0) continue;
    const conf = f.properties?.["confidence"];
    if (typeof conf === "string" && conf) confidences.push(conf);
    for (const r of rings) for (const [x, y] of r) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    perZone.push({ code, rings });
  }
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1;

  // City-wide median part area for the sliver threshold.
  const allAreas: number[] = [];
  for (const z of perZone) for (const r of z.rings) allAreas.push(ringArea(r));
  allAreas.sort((a, b) => a - b);
  const medianArea = allAreas.length ? allAreas[Math.floor(allAreas.length / 2)]! : 0;
  const sliverThreshold = medianArea * 0.01; // a part <1% of the median part = noise

  const zoneMetrics: ZoneMetric[] = [];
  for (const z of perZone) {
    const agricultural = isRuralCode(z.code);
    const centroids = z.rings.map(ringCentroid);
    let sliver = 0;
    for (const r of z.rings) if (ringArea(r) < sliverThreshold) sliver++;
    // dispersion = max pairwise centroid distance / city diagonal.
    let maxSep = 0;
    for (let i = 0; i < centroids.length; i++) {
      for (let j = i + 1; j < centroids.length; j++) {
        const d = Math.hypot(centroids[i]![0] - centroids[j]![0], centroids[i]![1] - centroids[j]![1]);
        if (d > maxSep) maxSep = d;
      }
    }
    zoneMetrics.push({ zone_code: z.code, parts: z.rings.length, sliver_parts: sliver, dispersion: maxSep / diag, agricultural });
  }

  // Flags. Dispersed-urban = a NON-agricultural zone whose parts sit >60% of the city apart
  // across at least 3 parts (a single far outlier is not enough; we want scattered spread).
  const dispersedUrban = zoneMetrics
    .filter((z) => !z.agricultural && z.parts >= 3 && z.dispersion > 0.6)
    .map((z) => z.zone_code)
    .sort();
  // Fragmentation = an urban zone shattered into many disjoint parts (contour-auto
  // artefact), ORTHOGONAL to dispersion: saint-stanislas read "clean" on dispersion
  // (its fragments were not spread city-wide) yet was severely fragmented.
  const overFragmented = zoneMetrics
    .filter((z) => !z.agricultural && z.parts >= FRAG_PARTS)
    .map((z) => z.zone_code)
    .sort();
  const sliverZones = zoneMetrics.filter((z) => z.sliver_parts >= 2).length;
  const multipart = zoneMetrics.filter((z) => z.parts > 1).length;
  const maxParts = zoneMetrics.reduce((m, z) => Math.max(m, z.parts), 0);
  const totalParts = zoneMetrics.reduce((s, z) => s + z.parts, 0);
  const meanParts = zoneMetrics.length ? Math.round((totalParts / zoneMetrics.length) * 100) / 100 : 0;

  // Dominant `confidence` — the mode across the city's features.
  const confCount = new Map<string, number>();
  for (const c of confidences) confCount.set(c, (confCount.get(c) ?? 0) + 1);
  let confidence: string | undefined;
  let best = 0;
  for (const [c, n] of confCount) if (n > best) { best = n; confidence = c; }
  const contourAuto = !!confidence && /contour[-_]?auto/i.test(confidence);

  let status: ZoneGeometryStatus = "clean";
  if (dispersedUrban.length > 0) status = "dispersed";
  else if (contourAuto && overFragmented.length >= FRAG_MIN_ZONES) status = "fragmented";
  else if (sliverZones >= 3) status = "suspect";

  return {
    slug,
    status,
    features: perZone.length,
    multipart_zones: multipart,
    max_parts: maxParts,
    mean_parts: meanParts,
    sliver_zones: sliverZones,
    dispersed_urban_zones: dispersedUrban,
    over_fragmented_zones: overFragmented,
    confidence,
    contour_auto: contourAuto,
  };
}

async function loadCity(s3: S3Client, slug: string): Promise<{ features: Feature[]; source: string } | null> {
  for (const key of zonageKeys(slug)) {
    if (!(await exists(s3, key))) continue;
    const fc = await getGeoJsonFeatureCollection<Feature>(s3, key);
    return { features: fc.features ?? [], source: key };
  }
  return null;
}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: readonly string[]): Promise<void> {
  const verbose = argv.includes("--verbose");
  const only = arg(argv, "slugs")?.split(",").map((s) => s.trim()).filter(Boolean);
  const matrix = loadMatrix(MATRIX_PATH);
  if (!matrix) throw new Error(`matrice introuvable: ${MATRIX_PATH}`);

  let slugs = Object.keys(matrix.cities).filter((s) => matrix.cities[s]?.zones?.status === "done").sort();
  if (only && only.length) slugs = only;

  const s3 = s3Client();
  const reports: CityReport[] = [];
  let dispersed = 0, fragmented = 0, suspect = 0, clean = 0, missing = 0;
  for (const slug of slugs) {
    let city: Awaited<ReturnType<typeof loadCity>> = null;
    try {
      city = await loadCity(s3, slug);
    } catch (e) {
      reports.push({ slug, status: "clean", features: 0, multipart_zones: 0, max_parts: 0, mean_parts: 0, sliver_zones: 0, dispersed_urban_zones: [], over_fragmented_zones: [], note: `read-error: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    if (!city) { missing++; continue; }
    const r = auditCity(slug, city.features);
    r.source = city.source;
    reports.push(r);
    if (r.status === "dispersed") { dispersed++; if (verbose) console.log(`DISPERSED  ${slug}: ${r.dispersed_urban_zones.join(", ")}`); }
    else if (r.status === "fragmented") { fragmented++; if (verbose) console.log(`FRAGMENTED ${slug}: max=${r.max_parts} mean=${r.mean_parts} conf=${r.confidence} zones=${r.over_fragmented_zones.join(", ")}`); }
    else if (r.status === "suspect") suspect++;
    else clean++;
  }

  const rank = (s: ZoneGeometryStatus) => (s === "dispersed" ? 0 : s === "fragmented" ? 1 : s === "suspect" ? 2 : 3);
  reports.sort((a, b) => (a.status === b.status ? a.slug.localeCompare(b.slug) : rank(a.status) - rank(b.status)));
  const out = { generatedAt: "AUDIT", universe: slugs.length, dispersed, fragmented, suspect, clean, missing, cities: reports };
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`zone-contiguity: universe=${slugs.length} dispersed=${dispersed} fragmented=${fragmented} suspect=${suspect} clean=${clean} missing=${missing} -> ${REPORT}`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
}

export { auditCity, type CityReport, type ZoneGeometryStatus };
