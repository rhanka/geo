/**
 * t1-zones.ts — T1 GeoPDF zoning: deterministic zone-polygon construction by
 * cadastre aggregation (nearest georeferenced label).
 *
 * FAITHFUL TypeScript port of the Python legacy producer of the saint-amable
 * golden — `work/legacy-geo-quebec/saint-mathieu/build_zones.py`
 * ("Deterministic zone-polygon construction by cadastre aggregation,
 * nearest-label"). The geo repo BANS Python; this module is the anti-Python
 * port of the critical T1 recipe.
 *
 * THE RECIPE (ADR-0023 §2, T1 = 100% auto):
 *   A municipal GeoPDF zoning plan embeds (a) the geographic transform
 *   (page → WGS84) and (b) the zone-code LABELS as positioned text. The PDF
 *   does NOT carry clean zone polygons. The cadastre (100% province, in S3)
 *   carries the EXACT lot geometry. So we let the cadastre supply the contours
 *   and the PDF supply the labels:
 *     1. Each georeferenced label → a "code point" (zone_code at lon/lat).
 *     2. Each cadastral lot → its interior representative point (shapely
 *        `point_on_surface`), projected to a local equirectangular meter frame.
 *     3. Nearest-label assignment: every lot takes the zone_code of the closest
 *        code point in meter space (brute-force exact NN), within a cutoff.
 *     4. Dissolve the lots of each code point → one MultiPolygon per zone.
 *   This is the "cadastre line-of-sight nearest-label" aggregation. ZERO
 *   geometry is invented: every output ring is a real cadastral lot boundary
 *   and every zone_code is verbatim from the PDF.
 *
 * Parity choices vs. the Python original (validated against the saint-mathieu
 * golden `zones_stats.json`):
 *   - Local equirectangular projection with a FIXED reference latitude lat0
 *     (`M_PER_DEG_LON = 111320*cos(lat0)`, `M_PER_DEG_LAT = 111320`), exactly
 *     as build_zones.py. NOT turf's geodesic area — areas are shoelace in this
 *     projected meter frame to reproduce shapely `.area` to 1e-4 km².
 *   - Representative point = `representativePoint()` from lib/geo (the GEOS
 *     horizontal-bisector interior point), the proven match for shapely
 *     `point_on_surface()` / `representative_point()`.
 *   - numpy-`linear` percentiles for the distance distribution.
 *   - Cadastral lots are a non-overlapping partition, so a dissolved zone's
 *     area equals the sum of its lots' areas (shared edges have zero area);
 *     stats areas are computed by that sum, identical to shapely's
 *     `unary_union(...).area`.
 */
import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";

import * as polyclip from "polyclip-ts";

// ---------------------------------------------------------------------------
// Constants (parity with build_zones.py)
// ---------------------------------------------------------------------------
export const M_PER_DEG_LAT = 111320.0;
export const DEFAULT_CUTOFF_M = 1500.0;
/** build_zones.py hardcoded LAT0 = 45.58 for the Rive-Sud focus munis. */
export const SAINT_MATHIEU_LAT0 = 45.58;

export interface CodePoint {
  code: string;
  prefix?: string;
  kind?: string;
  lon: number;
  lat: number;
}

export interface PerFeatureStat {
  zone_code: string;
  kind?: string;
  prefix?: string;
  cp_index: number;
  n_lots: number;
  area_km2: number;
  n_parts: number;
}

export interface T1Stats {
  n_lots_total: number;
  n_lots_invalid_fixed: number;
  n_code_points: number;
  n_distinct_codes: number;
  n_multi_spot_codes: number;
  multi_spot_codes: Record<string, number>;
  cutoff_m: number;
  n_lots_unassigned_1000m: number;
  n_lots_unassigned_1500m: number;
  n_lots_assigned: number;
  n_lots_unassigned: number;
  dist_m: { min: number; median: number; mean: number; p90: number; max: number };
  n_zone_features: number;
  n_empty_labels: number;
  total_zoned_area_km2: number;
  total_cadastre_area_km2: number;
  pct_area_covered: number;
  cadastre_bbox: [number, number, number, number];
  zone_union_bbox: [number, number, number, number];
  n_fragmented_zones_gt5_parts: number;
  per_kind: Record<
    string,
    {
      n_features: number;
      total_area_km2: number;
      n_lots: number;
      mean_area_km2: number;
      mean_lots_per_feature: number;
    }
  >;
  per_prefix: Record<string, { n_features: number; total_area_km2: number; n_lots: number }>;
  per_feature: Array<{
    zone_code: string;
    kind?: string;
    n_lots: number;
    area_km2: number;
    n_parts: number;
  }>;
}

export interface T1Result {
  featureCollection: FeatureCollection;
  stats: T1Stats;
}

export interface BuildZonesOptions {
  /** Reference latitude for the local equirectangular projection. */
  lat0: number;
  /** Assignment cutoff in meters (default 1500, as build_zones.py). */
  cutoffM?: number;
  /** Source tag written to each feature (e.g. "geopdf-esri"). */
  source?: string;
  /** Confidence tag written to each feature (e.g. "contour-auto"). */
  confidence?: string;
  /**
   * Dissolve each zone's lots into a topological union (polyclip). Default
   * true. When false (or on union failure), the zone's geometry is the raw
   * MultiPolygon of its lots — always real cadastral geometry, never invented.
   */
  dissolve?: boolean;
}

// ---------------------------------------------------------------------------
// Projection + area (local equirectangular meter frame)
// ---------------------------------------------------------------------------
export function projConstants(lat0: number): { mlon: number; mlat: number } {
  return { mlon: M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180), mlat: M_PER_DEG_LAT };
}

/** Shoelace area (m²) of a single ring projected to the local meter frame. */
function ringAreaM2(ring: Position[], mlon: number, mlat: number): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i]![0]! * mlon;
    const y1 = ring[i]![1]! * mlat;
    const x2 = ring[i + 1]![0]! * mlon;
    const y2 = ring[i + 1]![1]! * mlat;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Polygon/MultiPolygon area (km²) in the local meter frame (outer − holes). */
export function polyAreaKm2(geom: Geometry, mlon: number, mlat: number): number {
  const rings = (poly: Position[][]): number => {
    if (poly.length === 0) return 0;
    let a = ringAreaM2(poly[0]!, mlon, mlat);
    for (let h = 1; h < poly.length; h++) a -= ringAreaM2(poly[h]!, mlon, mlat);
    return a;
  };
  let total = 0;
  if (geom.type === "Polygon") total = rings(geom.coordinates);
  else if (geom.type === "MultiPolygon") for (const p of geom.coordinates) total += rings(p);
  return total / 1e6;
}

/** numpy default ("linear") percentile of an UNSORTED array, q in [0,100]. */
export function percentileLinear(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const a = [...values].sort((x, y) => x - y);
  if (a.length === 1) return a[0]!;
  const rank = ((a.length - 1) * q) / 100;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return a[lo]!;
  return a[lo]! + (rank - lo) * (a[hi]! - a[lo]!);
}

function bboxOf(geom: Geometry): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const scan = (poly: Position[][]): void => {
    for (const ring of poly)
      for (const p of ring) {
        if (p[0]! < minX) minX = p[0]!;
        if (p[0]! > maxX) maxX = p[0]!;
        if (p[1]! < minY) minY = p[1]!;
        if (p[1]! > maxY) maxY = p[1]!;
      }
  };
  if (geom.type === "Polygon") scan(geom.coordinates);
  else if (geom.type === "MultiPolygon") for (const p of geom.coordinates) scan(p);
  return [minX, minY, maxX, maxY];
}

function asMultiPolygonCoords(geom: Geometry): Position[][][] {
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  return [];
}

// ---------------------------------------------------------------------------
// GEOS-faithful interior point (shapely `point_on_surface` / GEOS
// `InteriorPointArea`). Required for bit-exact parity with build_zones.py:
// the nearest-label distance is sensitive to the exact interior point, so we
// reproduce GEOS rather than use the looser envelope-mid scan in lib/geo.
//
// Algorithm (JTS/GEOS InteriorPointArea):
//   1. centreY = (envMinY + envMaxY)/2 over the EXTERIOR ring.
//   2. scanY   = midpoint of the two exterior-ring vertex rows bracketing
//      centreY (loY = greatest vertex y ≤ centreY, hiY = least vertex y >
//      centreY). This guarantees the scan line never passes through a vertex.
//   3. Collect x-crossings of ALL rings (exterior + holes) at scanY; the
//      interior is the even-odd pairing of the sorted crossings; return the
//      midpoint of the WIDEST interior interval.
//   For a MultiPolygon, pick the component whose widest interval is widest.
// ---------------------------------------------------------------------------
function polyInteriorPoint(poly: Position[][]): { pt: Position; width: number } | null {
  const ext = poly[0];
  if (!ext || ext.length < 4) return null;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ext) {
    const y = p[1]!;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
  const centreY = (minY + maxY) / 2;
  let loY = minY;
  let hiY = maxY;
  for (const p of ext) {
    const y = p[1]!;
    if (y <= centreY) {
      if (y > loY) loY = y;
    } else if (y < hiY) {
      hiY = y;
    }
  }
  const scanY = (loY + hiY) / 2;
  const xs: number[] = [];
  for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const y1 = ring[i]![1]!;
      const y2 = ring[i + 1]![1]!;
      if (y1 <= scanY === y2 <= scanY) continue;
      const x1 = ring[i]![0]!;
      const x2 = ring[i + 1]![0]!;
      const t = (scanY - y1) / (y2 - y1);
      xs.push(x1 + t * (x2 - x1));
    }
  }
  if (xs.length < 2) return null;
  xs.sort((a, b) => a - b);
  let bestW = -1;
  let bestMid = NaN;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const w = xs[i + 1]! - xs[i]!;
    if (w > bestW) {
      bestW = w;
      bestMid = (xs[i]! + xs[i + 1]!) / 2;
    }
  }
  if (!(bestW > 0) || !Number.isFinite(bestMid)) return null;
  return { pt: [bestMid, scanY], width: bestW };
}

export function interiorPoint(geom: Geometry | null | undefined): Position | null {
  if (!geom) return null;
  if (geom.type === "Polygon") return polyInteriorPoint(geom.coordinates)?.pt ?? null;
  if (geom.type === "MultiPolygon") {
    let best: Position | null = null;
    let bestW = -1;
    for (const poly of geom.coordinates) {
      const r = polyInteriorPoint(poly);
      if (r && r.width > bestW) {
        bestW = r.width;
        best = r.pt;
      }
    }
    return best;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core: nearest-label cadastre aggregation
// ---------------------------------------------------------------------------
export function buildZones(
  cadastre: FeatureCollection,
  codePoints: CodePoint[],
  opts: BuildZonesOptions,
): T1Result {
  const { mlon, mlat } = projConstants(opts.lat0);
  const cutoff = opts.cutoffM ?? DEFAULT_CUTOFF_M;
  const dissolve = opts.dissolve ?? true;
  const source = opts.source ?? "geopdf";
  const confidence = opts.confidence ?? "contour-auto";

  const lotFeats = cadastre.features.filter(
    (f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"),
  );
  const nLotsTotal = lotFeats.length;

  // ---- lots: representative point (meters) + area ----
  const lotGeoms: Geometry[] = [];
  const lotRepX: number[] = [];
  const lotRepY: number[] = [];
  const lotAreas: number[] = [];
  let nFixed = 0;
  for (const ft of lotFeats) {
    const g = ft.geometry as Geometry;
    const rp = interiorPoint(g);
    if (!rp) {
      // No interior point recoverable — count as invalid; skip (never invent).
      nFixed += 1;
      lotGeoms.push(g);
      lotRepX.push(NaN);
      lotRepY.push(NaN);
      lotAreas.push(polyAreaKm2(g, mlon, mlat));
      continue;
    }
    lotGeoms.push(g);
    lotRepX.push(rp[0]! * mlon);
    lotRepY.push(rp[1]! * mlat);
    lotAreas.push(polyAreaKm2(g, mlon, mlat));
  }

  const totalCadArea = lotAreas.reduce((a, b) => a + b, 0);
  // cadastre bbox (lon/lat)
  const cadBbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of lotGeoms) {
    const b = bboxOf(g);
    if (b[0] < cadBbox[0]) cadBbox[0] = b[0];
    if (b[1] < cadBbox[1]) cadBbox[1] = b[1];
    if (b[2] > cadBbox[2]) cadBbox[2] = b[2];
    if (b[3] > cadBbox[3]) cadBbox[3] = b[3];
  }

  // ---- code points (meters) + multi-spot ----
  const cpX = codePoints.map((p) => p.lon * mlon);
  const cpY = codePoints.map((p) => p.lat * mlat);
  const nCp = codePoints.length;
  const codeToIdx = new Map<string, number[]>();
  for (let i = 0; i < nCp; i++) {
    const arr = codeToIdx.get(codePoints[i]!.code) ?? [];
    arr.push(i);
    codeToIdx.set(codePoints[i]!.code, arr);
  }
  const nDistinctCodes = codeToIdx.size;
  const multiSpot: Record<string, number> = {};
  for (const [c, ix] of codeToIdx) if (ix.length > 1) multiSpot[c] = ix.length;

  // ---- nearest-label assignment (exact brute force) ----
  const nearest = new Int32Array(nLotsTotal);
  const dist = new Float64Array(nLotsTotal);
  for (let li = 0; li < nLotsTotal; li++) {
    const x = lotRepX[li]!;
    const y = lotRepY[li]!;
    if (Number.isNaN(x)) {
      nearest[li] = -1;
      dist[li] = Infinity;
      continue;
    }
    let best = -1;
    let bestD2 = Infinity;
    for (let ci = 0; ci < nCp; ci++) {
      const dx = x - cpX[ci]!;
      const dy = y - cpY[ci]!;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = ci;
      }
    }
    nearest[li] = best;
    dist[li] = Math.sqrt(bestD2);
  }

  let unassigned1000 = 0;
  let unassigned1500 = 0;
  const assignedMask: boolean[] = new Array(nLotsTotal);
  for (let li = 0; li < nLotsTotal; li++) {
    if (dist[li]! > 1000.0) unassigned1000++;
    if (dist[li]! > 1500.0) unassigned1500++;
    assignedMask[li] = dist[li]! <= cutoff;
  }
  const nAssigned = assignedMask.filter(Boolean).length;
  const nUnassigned = nLotsTotal - nAssigned;

  const finiteDist = Array.from(dist).filter((d) => Number.isFinite(d));
  const distStats = {
    min: Math.min(...finiteDist),
    median: percentileLinear(finiteDist, 50),
    mean: finiteDist.reduce((a, b) => a + b, 0) / finiteDist.length,
    p90: percentileLinear(finiteDist, 90),
    max: Math.max(...finiteDist),
  };

  // ---- group lots by code point ----
  const lotsByCp = new Map<number, number[]>();
  for (let li = 0; li < nLotsTotal; li++) {
    if (assignedMask[li]) {
      const ci = nearest[li]!;
      const arr = lotsByCp.get(ci) ?? [];
      arr.push(li);
      lotsByCp.set(ci, arr);
    }
  }

  // ---- build features per code point ----
  const features: Feature[] = [];
  const perFeature: PerFeatureStat[] = [];
  let suspiciousFragmented = 0;
  let nEmptyLabels = 0;
  for (let cpi = 0; cpi < nCp; cpi++) {
    const p = codePoints[cpi]!;
    const idxs = lotsByCp.get(cpi);
    if (!idxs || idxs.length === 0) {
      nEmptyLabels++;
      continue;
    }
    const geoms = idxs.map((i) => lotGeoms[i]!);
    const merged = dissolveLots(geoms, dissolve);
    const nParts = asMultiPolygonCoords(merged).length;
    if (nParts > 5) suspiciousFragmented++;
    // disjoint lots → union area = Σ lot areas (exact to shapely).
    const area = idxs.reduce((a, i) => a + lotAreas[i]!, 0);
    features.push({
      type: "Feature",
      properties: {
        zone_code: p.code,
        ...(p.prefix !== undefined ? { prefix: p.prefix } : {}),
        ...(p.kind !== undefined ? { kind: p.kind } : {}),
        n_lots: idxs.length,
        source,
        confidence,
        assign_method: "cadastre-nearest-label",
      },
      geometry: merged,
    });
    perFeature.push({
      zone_code: p.code,
      ...(p.prefix !== undefined ? { prefix: p.prefix } : {}),
      ...(p.kind !== undefined ? { kind: p.kind } : {}),
      cp_index: cpi,
      n_lots: idxs.length,
      area_km2: area,
      n_parts: nParts,
    });
  }

  const nFeatures = features.length;
  const zonedArea = perFeature.reduce((a, s) => a + s.area_km2, 0);
  const pctCovered = totalCadArea > 0 ? (100.0 * zonedArea) / totalCadArea : 0;

  // zone union bbox (over all feature geometries)
  const zoneBbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) {
    const b = bboxOf(f.geometry as Geometry);
    if (b[0] < zoneBbox[0]) zoneBbox[0] = b[0];
    if (b[1] < zoneBbox[1]) zoneBbox[1] = b[1];
    if (b[2] > zoneBbox[2]) zoneBbox[2] = b[2];
    if (b[3] > zoneBbox[3]) zoneBbox[3] = b[3];
  }

  // per-kind + per-prefix
  const perKind: T1Stats["per_kind"] = {};
  const perPrefix: T1Stats["per_prefix"] = {};
  for (const s of perFeature) {
    const k = s.kind ?? "unknown";
    const pk = (perKind[k] ??= {
      n_features: 0,
      total_area_km2: 0,
      n_lots: 0,
      mean_area_km2: 0,
      mean_lots_per_feature: 0,
    });
    pk.n_features++;
    pk.total_area_km2 += s.area_km2;
    pk.n_lots += s.n_lots;
    const pf = s.prefix ?? "?";
    const pp = (perPrefix[pf] ??= { n_features: 0, total_area_km2: 0, n_lots: 0 });
    pp.n_features++;
    pp.total_area_km2 += s.area_km2;
    pp.n_lots += s.n_lots;
  }
  for (const k of Object.keys(perKind)) {
    const v = perKind[k]!;
    v.mean_area_km2 = round4(v.total_area_km2 / v.n_features);
    v.mean_lots_per_feature = round1(v.n_lots / v.n_features);
    v.total_area_km2 = round4(v.total_area_km2);
  }
  for (const pf of Object.keys(perPrefix))
    perPrefix[pf]!.total_area_km2 = round4(perPrefix[pf]!.total_area_km2);

  const stats: T1Stats = {
    n_lots_total: nLotsTotal,
    n_lots_invalid_fixed: nFixed,
    n_code_points: nCp,
    n_distinct_codes: nDistinctCodes,
    n_multi_spot_codes: Object.keys(multiSpot).length,
    multi_spot_codes: multiSpot,
    cutoff_m: cutoff,
    n_lots_unassigned_1000m: unassigned1000,
    n_lots_unassigned_1500m: unassigned1500,
    n_lots_assigned: nAssigned,
    n_lots_unassigned: nUnassigned,
    dist_m: distStats,
    n_zone_features: nFeatures,
    n_empty_labels: nEmptyLabels,
    total_zoned_area_km2: round4(zonedArea),
    total_cadastre_area_km2: round4(totalCadArea),
    pct_area_covered: round2(pctCovered),
    cadastre_bbox: cadBbox,
    zone_union_bbox: zoneBbox,
    n_fragmented_zones_gt5_parts: suspiciousFragmented,
    per_kind: perKind,
    per_prefix: perPrefix,
    per_feature: perFeature.map((s) => ({
      zone_code: s.zone_code,
      ...(s.kind !== undefined ? { kind: s.kind } : {}),
      n_lots: s.n_lots,
      area_km2: round4(s.area_km2),
      n_parts: s.n_parts,
    })),
  };

  const featureCollection: FeatureCollection = {
    type: "FeatureCollection",
    // @ts-expect-error CRS84 crs member (legacy GeoJSON, accepted by consumers)
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
    features,
  };

  return { featureCollection, stats };
}

// ---------------------------------------------------------------------------
// Dissolve helper — polyclip union, fall back to raw MultiPolygon (never drop
// real geometry → anti-invention).
// ---------------------------------------------------------------------------
function dissolveLots(geoms: Geometry[], dissolve: boolean): Polygon | MultiPolygon {
  const rawParts: Position[][][] = [];
  for (const g of geoms) for (const p of asMultiPolygonCoords(g)) rawParts.push(p);
  const rawMulti: MultiPolygon = { type: "MultiPolygon", coordinates: rawParts };
  if (!dissolve || rawParts.length === 0) return rawMulti;
  try {
    const [first, ...rest] = rawParts as unknown as PolyclipGeom[];
    const unioned = polyclip.union(first!, ...rest) as unknown as Position[][][];
    if (!unioned || unioned.length === 0) return rawMulti;
    return { type: "MultiPolygon", coordinates: unioned };
  } catch {
    return rawMulti;
  }
}

// polyclip-ts Polygon = ring[] = number[][][]; loose alias to bridge GeoJSON.
type PolyclipGeom = Parameters<typeof polyclip.union>[0];

// ---------------------------------------------------------------------------
const round1 = (x: number): number => Math.round(x * 10) / 10;
const round2 = (x: number): number => Math.round(x * 100) / 100;
const round4 = (x: number): number => Math.round(x * 10000) / 10000;
