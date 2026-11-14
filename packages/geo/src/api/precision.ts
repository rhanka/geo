/**
 * Opt-in coordinate precision for served geometries (`?coordPrecision=<n>`).
 *
 * A representation option, not a data change: the stored GeoJSON (and its
 * proof-v2 sha256) is never rewritten, the default response stays exact, and a
 * client that needs canonical geometry (a lot's fiche) simply omits the
 * parameter. Rounding to 6 decimals moves a vertex by at most ~0.05 m in
 * latitude (~0.04 m in longitude at 46°N); it roughly halves the compressed
 * size of a city's lots.
 *
 * Only coordinates are rounded; no vertex is simplified away, except that a
 * vertex made identical to its predecessor by the rounding is dropped, and only
 * while the line keeps >= 2 positions / the ring keeps >= 4 (closed). Below
 * that floor the rounded positions are kept as-is, so no ring or part ever
 * disappears.
 */

import type { Geometry, Position } from "@sentropic/geo-core";

export const MIN_COORD_PRECISION = 0;
export const MAX_COORD_PRECISION = 15;

/**
 * Parse `?coordPrecision=`: `undefined` when absent (exact output), `null` when
 * present but not an integer in [0, 15] (the caller answers 400).
 */
export function parseCoordPrecision(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  if (!/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= MIN_COORD_PRECISION && n <= MAX_COORD_PRECISION ? n : null;
}

function roundPosition(p: Position, factor: number): Position {
  // Only x/y are rounded; an elevation (3rd ordinate) keeps its value.
  const out = p.slice() as Position;
  out[0] = Math.round(p[0]! * factor) / factor;
  out[1] = Math.round(p[1]! * factor) / factor;
  return out;
}

function samePosition(a: Position, b: Position): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Round, then drop consecutive duplicates while at least `min` positions remain. */
function roundLine(line: Position[], factor: number, min: number): Position[] {
  const rounded = line.map((p) => roundPosition(p, factor));
  const deduped: Position[] = [];
  for (const p of rounded) {
    const prev = deduped[deduped.length - 1];
    if (!prev || !samePosition(prev, p)) deduped.push(p);
  }
  return deduped.length >= min ? deduped : rounded;
}

function roundRing(ring: Position[], factor: number): Position[] {
  // A closed ring stays closed: first and last positions round identically.
  return roundLine(ring, factor, 4);
}

/** Return a new geometry with coordinates rounded to `digits` decimals. */
export function roundGeometry(geometry: Geometry | null, digits: number): Geometry | null {
  if (!geometry) return geometry;
  const factor = 10 ** digits;
  switch (geometry.type) {
    case "Point":
      return { ...geometry, coordinates: roundPosition(geometry.coordinates, factor) };
    case "MultiPoint":
      return { ...geometry, coordinates: geometry.coordinates.map((p) => roundPosition(p, factor)) };
    case "LineString":
      return { ...geometry, coordinates: roundLine(geometry.coordinates, factor, 2) };
    case "MultiLineString":
      return { ...geometry, coordinates: geometry.coordinates.map((l) => roundLine(l, factor, 2)) };
    case "Polygon":
      return { ...geometry, coordinates: geometry.coordinates.map((r) => roundRing(r, factor)) };
    case "MultiPolygon":
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((poly) => poly.map((r) => roundRing(r, factor))),
      };
    case "GeometryCollection":
      return {
        ...geometry,
        geometries: geometry.geometries.map((g) => roundGeometry(g, digits) as Geometry),
      };
    default:
      return geometry;
  }
}

/** Apply {@link roundGeometry} to a feature without mutating it. */
export function withCoordPrecision<F extends { geometry: Geometry | null }>(
  feature: F,
  digits: number | undefined,
): F {
  if (digits === undefined) return feature;
  return { ...feature, geometry: roundGeometry(feature.geometry, digits) };
}
