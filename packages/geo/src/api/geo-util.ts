/**
 * Small geometry helpers shared by providers: bounding-box computation and
 * 2D bbox intersection. Kept dependency-free and WGS84-only (RFC 7946).
 */

import type { BBox, Geometry, Position } from "@sentropic/geo-core";

/** A 2D bounding box `[minx, miny, maxx, maxy]`. */
export type BBox2D = [number, number, number, number];

function eachPosition(geometry: Geometry, visit: (pos: Position) => void): void {
  switch (geometry.type) {
    case "Point":
      visit(geometry.coordinates);
      break;
    case "MultiPoint":
    case "LineString":
      for (const pos of geometry.coordinates) visit(pos);
      break;
    case "MultiLineString":
    case "Polygon":
      for (const ring of geometry.coordinates) for (const pos of ring) visit(pos);
      break;
    case "MultiPolygon":
      for (const poly of geometry.coordinates)
        for (const ring of poly) for (const pos of ring) visit(pos);
      break;
    case "GeometryCollection":
      for (const g of geometry.geometries) eachPosition(g, visit);
      break;
  }
}

/** Compute the 2D bounding box of a geometry, or `undefined` if it has no coordinates. */
export function geometryBBox(geometry: Geometry | null): BBox2D | undefined {
  if (!geometry) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  eachPosition(geometry, ([x, y]) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  });
  if (!Number.isFinite(minX)) return undefined;
  return [minX, minY, maxX, maxY];
}

/** Union of two 2D bounding boxes (either may be undefined). */
export function unionBBox(a: BBox2D | undefined, b: BBox2D | undefined): BBox2D | undefined {
  if (!a) return b;
  if (!b) return a;
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

/** Extract the leading 2D box from a (possibly 3D) GeoJSON BBox. */
export function to2D(bbox: BBox): BBox2D {
  return [bbox[0], bbox[1], bbox[2], bbox[3]];
}

/** True if two 2D bounding boxes overlap (edge contact counts as overlap). */
export function bboxIntersects(a: BBox2D, b: BBox2D): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * True if a feature geometry intersects a query bbox. A feature with no
 * geometry never matches a spatial filter.
 */
export function geometryIntersectsBBox(geometry: Geometry | null, filter: BBox2D): boolean {
  const box = geometryBBox(geometry);
  if (!box) return false;
  return bboxIntersects(box, filter);
}
