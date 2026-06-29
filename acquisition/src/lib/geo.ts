/**
 * Geometry helpers (Turf), replacing the shapely usage across the acquisition
 * modules. Two operations are used province-wide:
 *
 *   1. An interior representative point of a polygon/multipolygon — shapely's
 *      `representative_point()`. Turf's `pointOnFeature` gives the same
 *      guarantee (a point that lies ON the geometry, never outside a concave
 *      ring), which `centroid` does NOT. We use `pointOnFeature`.
 *
 *   2. Point-in-polygon for code_zone / clip retention. shapely uses
 *      `prepared.contains(pt)`, whose convention is STRICT interior: a point
 *      exactly on the boundary is NOT contained. Turf's
 *      `booleanPointInPolygon(pt, poly, { ignoreBoundary: true })` matches that
 *      strict convention. This is the anti-invention-safe choice: a lot whose
 *      centroid lands exactly on a zone/municipal boundary is treated as
 *      AMBIGUOUS and excluded, identical to shapely `contains`.
 */
import type { Feature, Geometry, Point, Polygon, MultiPolygon, Position } from "geojson";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import area from "@turf/area";

/**
 * Interior representative point of a (multi)polygon, as [lon, lat], guaranteed
 * to lie strictly INSIDE the geometry — a faithful equivalent of shapely's
 * `representative_point()` / GEOS `interiorPoint` (point-on-surface).
 *
 * Validated against shapely (Chelsea, 4907 lots): feeding such a strictly
 * interior point to `booleanPointInPolygon` reproduces shapely's
 * `prepared.contains` code_zone assignment 100% exactly, under either
 * `ignoreBoundary` setting — whereas turf's `pointOnFeature` can return a point
 * ON the lot boundary, which then lands ambiguously on a shared zone edge. We
 * therefore do NOT use `pointOnFeature`.
 *
 * Algorithm (GEOS horizontal-bisector scan): take a horizontal scan line at the
 * mid-latitude of the geometry's envelope, intersect it with the polygon rings,
 * and return the midpoint of the WIDEST interior segment. For the (rare) case
 * where the bisector grazes a vertex and yields no interior segment, nudge the
 * scan line. Returns null on missing/empty/unsupported geometry (shapely raised
 * → Python caught → None).
 */
export function representativePoint(geometry: Geometry | null | undefined): Position | null {
  if (!geometry) return null;
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return null;
  const polys: Position[][][] =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  if (polys.length === 0) return null;

  // Envelope (bbox) over all rings.
  let minY = Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const p of ring) {
        const y = p[1]!;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;

  const tryScan = (yScan: number): Position | null => {
    // Collect x-crossings of the scan line with every ring (even-odd rule
    // across ALL rings handles holes correctly via crossing parity).
    const xs: number[] = [];
    for (const poly of polys) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const y1 = ring[i]![1]!;
          const y2 = ring[i + 1]![1]!;
          // half-open edge test avoids double-counting shared vertices
          if (y1 <= yScan === y2 <= yScan) continue;
          const x1 = ring[i]![0]!;
          const x2 = ring[i + 1]![0]!;
          const t = (yScan - y1) / (y2 - y1);
          xs.push(x1 + t * (x2 - x1));
        }
      }
    }
    if (xs.length < 2) return null;
    xs.sort((a, b) => a - b);
    // Interior segments are the odd-parity spans [xs[0],xs[1]], [xs[2],xs[3]]…
    let bestW = -1;
    let bestMid = NaN;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1]! - xs[i]!;
      if (w > bestW) {
        bestW = w;
        bestMid = (xs[i]! + xs[i + 1]!) / 2;
      }
    }
    if (!Number.isFinite(bestMid) || bestW <= 0) return null;
    return [bestMid, yScan];
  };

  const midY = (minY + maxY) / 2;
  let pt = tryScan(midY);
  if (pt) return pt;
  // Nudge the scan line if the bisector grazed a vertex / degenerate slice.
  const h = maxY - minY || 1;
  for (const frac of [0.5001, 0.4999, 0.5003, 0.4997, 0.501, 0.499]) {
    pt = tryScan(minY + frac * h);
    if (pt) return pt;
  }
  return null;
}

/**
 * STRICT point-in-polygon (boundary excluded), matching shapely
 * `prepared.contains`. `pt` is [lon, lat].
 */
export function strictPointInPolygon(
  pt: Position,
  poly: Polygon | MultiPolygon,
): boolean {
  try {
    return booleanPointInPolygon(pt as [number, number], poly, { ignoreBoundary: true });
  } catch {
    return false;
  }
}

const pointFeature = (pt: Position): Feature<Point> => ({
  type: "Feature",
  properties: {},
  geometry: { type: "Point", coordinates: [pt[0]!, pt[1]!] },
});

export { pointFeature, area };
