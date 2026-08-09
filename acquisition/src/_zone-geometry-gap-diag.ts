/**
 * _zone-geometry-gap-diag.ts — DIAGNOSTIC READ-ONLY (zéro écriture S3, zéro fold).
 *
 * Pour chaque slug : lit la géométrie de zone servie `qc-zonage-<slug>` et les
 * lots `qc-lots-<slug>` depuis S3, puis quantifie le défaut « outside_all » :
 *   - zonage : #features, #codes distincts, liste des codes, bbox, clés de props,
 *     échantillon de provenance (source/url/millesime/…).
 *   - lots : total, assigné, matched, misassigned, outside_all (centroïde hors de
 *     TOUTE zone servie), + DISCRIMINANT :
 *       · outside dont le code assigné N'EST PAS dessiné  → ZONE MANQUANTE (géométrie partielle)
 *       · outside dont le code assigné EST dessiné        → trou/recalage (zone existe mais lot hors polygone)
 *       · outside dont le centroïde est HORS bbox zonage  → territoire non couvert
 *       · outside dont le centroïde est DANS bbox zonage  → trou interne
 *   - codes de lots absents du zonage (top) = preuve directe de zones non dessinées.
 *
 * Sortie : chemin passé en --out (JSON). Ne touche RIEN de servi.
 *
 * Usage :
 *   npx tsx acquisition/src/_zone-geometry-gap-diag.ts --slugs a,b,c --out /path/to/out.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { exists, getGeoJsonFeatureCollection, s3Client } from "./lib/s3.js";
import type { S3Client } from "@aws-sdk/client-s3";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";
const LOTS_PREFIX = "normalized/qc-lots/";

type Ring = number[][];
type Poly = Ring[];
interface Feature {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown } | null;
}

function isRing(r: unknown): r is Ring {
  return Array.isArray(r) && r.length >= 3 &&
    r.every((p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === "number" && typeof p[1] === "number");
}
function polygonsOf(geom: Feature["geometry"]): Poly[] {
  if (!geom || !Array.isArray(geom.coordinates)) return [];
  const out: Poly[] = [];
  if (geom.type === "Polygon") {
    const rings = (geom.coordinates as unknown[]).filter(isRing) as Ring[];
    if (rings.length) out.push(rings);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates as unknown[]) {
      if (!Array.isArray(poly)) continue;
      const rings = poly.filter(isRing) as Ring[];
      if (rings.length) out.push(rings);
    }
  }
  return out;
}
function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % n]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
function ringCentroid(ring: Ring): [number, number] {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % n]!;
    const cross = x1 * y2 - x2 * y1;
    a += cross; cx += (x1 + x2) * cross; cy += (y1 + y2) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) {
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return [sx / ring.length, sy / ring.length];
  }
  return [cx / (6 * a), cy / (6 * a)];
}
function lotCentroid(geom: Feature["geometry"]): [number, number] | null {
  const polys = polygonsOf(geom);
  if (!polys.length) return null;
  let best: Ring | null = null, bestA = -1;
  for (const p of polys) {
    const outer = p[0]!;
    const area = Math.abs(signedArea(outer));
    if (area > bestA) { bestA = area; best = outer; }
  }
  return best ? ringCentroid(best) : null;
}
function inRing(pt: [number, number], ring: Ring): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function inPolygon(pt: [number, number], poly: Poly): boolean {
  if (!inRing(pt, poly[0]!)) return false;
  for (let h = 1; h < poly.length; h++) if (inRing(pt, poly[h]!)) return false;
  return true;
}
function inCode(pt: [number, number], polys: Poly[] | undefined): boolean {
  if (!polys) return false;
  return polys.some((p) => inPolygon(pt, p));
}
function assignedCode(props: Record<string, unknown> | undefined): string | null {
  for (const k of ["code_zone", "zone_code", "ZONE", "zone"]) {
    const v = props?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
type BBox = [number, number, number, number];
function extendBbox(b: BBox, x: number, y: number): void {
  if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
  if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
}
function bboxOfPolys(polys: Poly[], b: BBox): void {
  for (const p of polys) for (const ring of p) for (const [x, y] of ring) extendBbox(b, x, y);
}
function inBbox(pt: [number, number], b: BBox): boolean {
  return pt[0] >= b[0] && pt[0] <= b[2] && pt[1] >= b[1] && pt[1] <= b[3];
}

async function loadFC(s3: S3Client, keys: string[]): Promise<{ features: Feature[]; key: string } | null> {
  for (const k of keys) {
    if (!(await exists(s3, k))) continue;
    const fc = await getGeoJsonFeatureCollection<Feature>(s3, k);
    return { features: fc.features ?? [], key: k };
  }
  return null;
}

async function diag(s3: S3Client, slug: string) {
  const zoneRes = await loadFC(s3, [
    `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`,
    `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`,
  ]);
  const lotRes = await loadFC(s3, [
    `${LOTS_PREFIX}qc-lots-${slug}.geojson`,
    `${LOTS_PREFIX}qc-lots-${slug}/qc-lots-${slug}.geojson`,
  ]);
  const out: Record<string, unknown> = { slug };
  if (!zoneRes) { out.error = "qc-zonage non servi"; return out; }

  const zoneIndex = new Map<string, Poly[]>();
  const zbb: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  const propKeys = new Set<string>();
  const provSamples: Record<string, unknown>[] = [];
  let zoneFeatWithGeom = 0;
  for (const z of zoneRes.features) {
    for (const k of Object.keys(z.properties ?? {})) propKeys.add(k);
    const code = assignedCode(z.properties);
    const polys = polygonsOf(z.geometry);
    if (polys.length) { zoneFeatWithGeom++; bboxOfPolys(polys, zbb); }
    if (!code || !polys.length) continue;
    const arr = zoneIndex.get(code) ?? [];
    arr.push(...polys);
    zoneIndex.set(code, arr);
    if (provSamples.length < 2) {
      const p = z.properties ?? {};
      const sample: Record<string, unknown> = {};
      for (const k of ["source", "source_url", "provenance", "url", "millesime", "annee", "year", "layer", "owner", "vintage", "method", "methode"]) {
        if (p[k] !== undefined) sample[k] = p[k];
      }
      if (Object.keys(sample).length) provSamples.push(sample);
    }
  }
  const zoneCodes = [...zoneIndex.keys()].sort();
  out.zonage = {
    key: zoneRes.key,
    features: zoneRes.features.length,
    features_with_geometry: zoneFeatWithGeom,
    distinct_codes: zoneCodes.length,
    codes: zoneCodes,
    bbox: zbb.every((v) => Number.isFinite(v)) ? zbb : null,
    prop_keys: [...propKeys].sort(),
    provenance_sample: provSamples,
  };

  if (!lotRes) { out.lots = { error: "qc-lots non servi" }; return out; }

  const lbb: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  let total = 0, assigned = 0, matched = 0, misassigned = 0, outside = 0, unassigned = 0;
  let outside_code_not_drawn = 0, outside_code_drawn = 0, outside_in_zbb = 0, outside_out_zbb = 0;
  const lotCodeCount = new Map<string, number>();
  const outsideCodeNotDrawnCount = new Map<string, number>();
  const zbbValid = zbb.every((v) => Number.isFinite(v));
  for (const lot of lotRes.features) {
    total++;
    const code = assignedCode(lot.properties);
    const c = lotCentroid(lot.geometry);
    if (c) extendBbox(lbb, c[0], c[1]);
    if (!code) { unassigned++; continue; }
    lotCodeCount.set(code, (lotCodeCount.get(code) ?? 0) + 1);
    if (!c) { unassigned++; continue; }
    assigned++;
    if (inCode(c, zoneIndex.get(code))) { matched++; continue; }
    let actual = false;
    for (const [zc, polys] of zoneIndex) { if (zc !== code && inCode(c, polys)) { actual = true; break; } }
    if (actual) { misassigned++; continue; }
    outside++;
    if (zoneIndex.has(code)) outside_code_drawn++;
    else { outside_code_not_drawn++; outsideCodeNotDrawnCount.set(code, (outsideCodeNotDrawnCount.get(code) ?? 0) + 1); }
    if (zbbValid && inBbox(c, zbb)) outside_in_zbb++; else outside_out_zbb++;
  }
  // codes présents dans les lots mais JAMAIS dessinés comme zone
  const lotCodesNotDrawn = [...lotCodeCount.entries()]
    .filter(([c]) => !zoneIndex.has(c))
    .sort((a, b) => b[1] - a[1]);
  out.lots = {
    key: lotRes.key,
    total, assigned, matched, misassigned, outside_all: outside, unassigned,
    mismatch_pct: assigned ? Math.round(((misassigned + outside) / assigned) * 10000) / 100 : 0,
    outside_breakdown: {
      code_not_drawn: outside_code_not_drawn,
      code_drawn_but_gap: outside_code_drawn,
      inside_zone_bbox: outside_in_zbb,
      outside_zone_bbox: outside_out_zbb,
    },
    distinct_lot_codes: lotCodeCount.size,
    lot_codes_not_drawn_count: lotCodesNotDrawn.length,
    lot_codes_not_drawn_top: lotCodesNotDrawn.slice(0, 20).map(([c, n]) => ({ code: c, lots: n })),
    lots_bbox: lbb.every((v) => Number.isFinite(v)) ? lbb : null,
  };
  return out;
}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: readonly string[]): Promise<void> {
  const slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const outPath = arg(argv, "out") ?? "/tmp/zone-gap-diag.json";
  if (!slugs.length) { console.error("--slugs requis"); process.exit(1); }
  const s3 = s3Client();
  const results: Record<string, unknown>[] = [];
  for (const slug of slugs) {
    process.stderr.write(`diag ${slug}...\n`);
    try { results.push(await diag(s3, slug)); }
    catch (e) { results.push({ slug, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }); }
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), cities: results }, null, 2) + "\n", "utf8");
  console.log(`wrote ${outPath}`);
  for (const r of results) {
    const z = r.zonage as any, l = r.lots as any;
    if (r.error) { console.log(`${r.slug}: ERROR ${r.error}`); continue; }
    console.log(`${r.slug}: zones=${z?.features}(codes=${z?.distinct_codes}) lots=${l?.total} outside_all=${l?.outside_all} [not_drawn=${l?.outside_breakdown?.code_not_drawn} drawn_gap=${l?.outside_breakdown?.code_drawn_but_gap} out_bbox=${l?.outside_breakdown?.outside_zone_bbox}] lotCodesNotDrawn=${l?.lot_codes_not_drawn_count}/${l?.distinct_lot_codes}`);
  }
}

main(process.argv.slice(2)).catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
