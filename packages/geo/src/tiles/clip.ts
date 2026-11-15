/**
 * Clip a quantized ring to an axis-aligned rectangle (Sutherland–Hodgman).
 *
 * The rectangle is the tile plus its buffer, so clip artefacts (edges running
 * along the cut) stay outside the visible tile. Intersections are computed
 * from the edge's endpoints in a canonical order and rounded, so the two rings
 * sharing an edge get the same cut point.
 */

import { isUsableRing, type QRing } from "./geometry.js";

function intersect(ax: number, ay: number, bx: number, by: number, axis: 0 | 1, bound: number): [number, number] {
  if (ax > bx || (ax === bx && ay > by)) {
    [ax, bx] = [bx, ax];
    [ay, by] = [by, ay];
  }
  if (axis === 0) {
    const t = (bound - ax) / (bx - ax);
    return [bound, Math.round(ay + t * (by - ay))];
  }
  const t = (bound - ay) / (by - ay);
  return [Math.round(ax + t * (bx - ax)), bound];
}

function clipAxis(pts: number[], axis: 0 | 1, bound: number, keepGreater: boolean): number[] {
  const out: number[] = [];
  const n = pts.length / 2;
  if (n === 0) return out;
  const inside = (i: number): boolean => (keepGreater ? pts[2 * i + axis]! >= bound : pts[2 * i + axis]! <= bound);
  let prev = n - 1;
  let prevIn = inside(prev);
  for (let i = 0; i < n; i++) {
    const curIn = inside(i);
    if (curIn !== prevIn) {
      const [x, y] = intersect(pts[2 * prev]!, pts[2 * prev + 1]!, pts[2 * i]!, pts[2 * i + 1]!, axis, bound);
      out.push(x, y);
    }
    if (curIn) out.push(pts[2 * i]!, pts[2 * i + 1]!);
    prev = i;
    prevIn = curIn;
  }
  return out;
}

function dedupe(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const m = out.length;
    if (m > 0 && out[m - 2] === pts[i] && out[m - 1] === pts[i + 1]) continue;
    out.push(pts[i]!, pts[i + 1]!);
  }
  while (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  return out;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function ringBBox(ring: QRing): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const x = ring[i]!;
    const y = ring[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Clip `ring` to `rect`, translated by (-dx, -dy). Undefined when nothing usable remains. */
export function clipRing(ring: QRing, rect: Rect, dx: number, dy: number): Int32Array | undefined {
  const bb = ringBBox(ring);
  if (bb.maxX < rect.minX || bb.minX > rect.maxX || bb.maxY < rect.minY || bb.minY > rect.maxY) return undefined;
  let pts: number[];
  if (bb.minX >= rect.minX && bb.maxX <= rect.maxX && bb.minY >= rect.minY && bb.maxY <= rect.maxY) {
    pts = Array.from(ring);
  } else {
    pts = Array.from(ring);
    pts = clipAxis(pts, 0, rect.minX, true);
    pts = clipAxis(pts, 0, rect.maxX, false);
    pts = clipAxis(pts, 1, rect.minY, true);
    pts = clipAxis(pts, 1, rect.maxY, false);
    pts = dedupe(pts);
  }
  if (!isUsableRing(pts)) return undefined;
  const out = new Int32Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = pts[i]! - dx;
    out[i + 1] = pts[i + 1]! - dy;
  }
  return out;
}
