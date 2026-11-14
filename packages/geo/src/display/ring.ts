/**
 * Simplicity test of a closed linear ring: no two non-adjacent edges touch or
 * cross (collinear contact counts as a touch). Used to keep the display mirror
 * from introducing invalid rings: a rounded ring that is not simple while its
 * exact ring is simple falls back to the exact geometry.
 *
 * Edges are bucketed on a uniform grid (~sqrt(n) cells per axis), so only edges
 * sharing a cell are compared: near-linear on cadastral and zoning rings, with
 * no vertex cap. Exact integer-free arithmetic on doubles: the inputs are the
 * very coordinates that get serialized, so the verdict matches the output.
 */

import type { Position } from "@sentropic/geo-core";

function orient(a: Position, b: Position, c: Position): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function onSegment(a: Position, b: Position, p: Position): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}

function segmentsTouch(a: Position, b: Position, c: Position, d: Position): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b))
  );
}

/** Whether the closed ring (first == last position) is simple. */
export function isSimpleRing(ring: readonly Position[]): boolean {
  const n = ring.length - 1; // edges
  if (n < 3) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const cells = Math.max(1, Math.ceil(Math.sqrt(n)));
  const w = (maxX - minX) / cells || 1;
  const h = (maxY - minY) / cells || 1;
  const cellOf = (v: number, min: number, size: number): number =>
    Math.min(cells - 1, Math.max(0, Math.floor((v - min) / size)));

  const grid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const x0 = cellOf(Math.min(a[0], b[0]), minX, w);
    const x1 = cellOf(Math.max(a[0], b[0]), minX, w);
    const y0 = cellOf(Math.min(a[1], b[1]), minY, h);
    const y1 = cellOf(Math.max(a[1], b[1]), minY, h);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = x * cells + y;
        const bucket = grid.get(key);
        if (bucket) bucket.push(i);
        else grid.set(key, [i]);
      }
    }
  }

  const seen = new Set<number>();
  for (const bucket of grid.values()) {
    for (let p = 0; p < bucket.length; p++) {
      for (let q = p + 1; q < bucket.length; q++) {
        const i = Math.min(bucket[p]!, bucket[q]!);
        const j = Math.max(bucket[p]!, bucket[q]!);
        if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
        const pair = i * n + j;
        if (seen.has(pair)) continue;
        seen.add(pair);
        if (segmentsTouch(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return false;
      }
    }
  }
  return true;
}
