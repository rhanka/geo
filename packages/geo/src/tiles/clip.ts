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

/** Tile range `[tx0, tx1] × [ty0, ty1]` (inclusive) whose buffered rects a bbox touches, clamped to the zoom. */
export function tileRange(bb: Rect, extent: number, buffer: number, tilesPerAxis: number): [number, number, number, number] {
  return [
    Math.max(0, Math.floor((bb.minX - buffer) / extent)),
    Math.min(tilesPerAxis - 1, Math.floor((bb.maxX + buffer) / extent)),
    Math.max(0, Math.floor((bb.minY - buffer) / extent)),
    Math.min(tilesPerAxis - 1, Math.floor((bb.maxY + buffer) / extent)),
  ];
}

/**
 * Region codes of a vertex against a clip rect, in the order of the four
 * Sutherland–Hodgman passes of {@link clipRing}: left (x < minX), right
 * (x > maxX), top (in x, y < minY), bottom (in x, y > maxY), inside (0).
 */
const LEFT = 1;
const RIGHT = 2;
const TOP = 3;
const BOTTOM = 4;

/**
 * Drop the vertices of `pts` that cannot change the clip of the ring to any
 * rect of a node: a vertex whose two neighbours (in index order, no wrap: the
 * first and last vertices are always kept, so the output keeps its rotation)
 * carry the same non-zero code as itself. `code` must give each vertex one
 * code valid for every rect of the node (see {@link clipRingToTiles}).
 *
 * Why it is exact: for a run of consecutive vertices of one code K, the passes
 * before K's pass keep the whole run (each vertex is inside their half-plane)
 * and create no intersection on its inner edges; K's pass drops the run and
 * emits only the intersections of the run's two boundary edges, which keep
 * their endpoints. Every pass therefore outputs the same points, minus the
 * dropped ones, and K's pass and the later ones output the same sequence.
 */
function reduceRing(pts: Int32Array, code: (x: number, y: number) => number): Int32Array {
  const n = pts.length / 2;
  if (n <= 2) return pts;
  const out = new Int32Array(pts.length);
  let m = 0;
  let prev = code(pts[0]!, pts[1]!);
  let cur = code(pts[2]!, pts[3]!);
  out[m++] = pts[0]!;
  out[m++] = pts[1]!;
  for (let i = 1; i < n - 1; i++) {
    const next = code(pts[2 * i + 2]!, pts[2 * i + 3]!);
    if (cur === 0 || cur !== prev || cur !== next) {
      out[m++] = pts[2 * i]!;
      out[m++] = pts[2 * i + 1]!;
    }
    prev = cur;
    cur = next;
  }
  out[m++] = pts[2 * n - 2]!;
  out[m++] = pts[2 * n - 1]!;
  return m === pts.length ? pts : out.slice(0, m);
}

/**
 * Clip `ring` to every tile of `[tx0, tx1] × [ty0, ty1]` at once and call
 * `emit(tx, ty, clipped)` for each tile where {@link clipRing} with that
 * tile's buffered rect (translated to the tile origin) is defined, with the
 * very same coordinates, in increasing (tx, ty) order.
 *
 * A per-tile {@link clipRing} reads the whole ring for every tile of its bbox:
 * tiles × vertices, which a region-sized polygon turns into 10^10–10^12 vertex
 * visits. Here the range is split recursively (columns first, then rows within
 * a column), each node keeping only the vertices that can still change the
 * clip of one of its tiles ({@link reduceRing}) and pruning the nodes the
 * reduced ring does not reach: each level reads O(vertices + boundary
 * crossings), and empty tiles of the bbox cost nothing.
 *
 * Node codes, valid for every tile of the node: on a column range, left/right
 * of the range's buffered x span (a vertex left of it is left of every tile in
 * it); within one column, whose tiles share the column's x span exactly,
 * left/right of the column and top/bottom of the row range's buffered y span.
 */
export function clipRingToTiles(
  ring: QRing,
  range: readonly [number, number, number, number],
  extent: number,
  buffer: number,
  emit: (tx: number, ty: number, clipped: Int32Array) => void,
): void {
  clipRingToColumns(ring, range, extent, buffer, (tx, column, ty0, ty1) =>
    clipColumnToTiles(column, tx, ty0, ty1, extent, buffer, (ty, clipped) => emit(tx, ty, clipped)),
  );
}

/**
 * First half of {@link clipRingToTiles}: `emit(tx, column, ty0, ty1)` for each
 * column of the range the ring may reach, in increasing tx, with the ring
 * reduced for that column's tiles and the rows it may reach. A column is
 * O(its vertices + crossings of its two edges), so all columns together stay
 * linear in the ring: they can be kept and clipped column by column later
 * ({@link clipColumnToTiles}).
 */
export function clipRingToColumns(
  ring: QRing,
  range: readonly [number, number, number, number],
  extent: number,
  buffer: number,
  emit: (tx: number, column: Int32Array, ty0: number, ty1: number) => void,
): void {
  const columns = (pts: Int32Array, tx0: number, tx1: number, ty0: number, ty1: number): void => {
    const minX = tx0 * extent - buffer;
    const maxX = (tx1 + 1) * extent + buffer;
    const reduced = reduceRing(pts, (x) => (x < minX ? LEFT : x > maxX ? RIGHT : 0));
    const bb = ringBBox(reduced);
    if (bb.maxX < minX || bb.minX > maxX) return;
    const a = Math.max(tx0, Math.floor((bb.minX - buffer) / extent));
    const b = Math.min(tx1, Math.floor((bb.maxX + buffer) / extent));
    const c = Math.max(ty0, Math.floor((bb.minY - buffer) / extent));
    const d = Math.min(ty1, Math.floor((bb.maxY + buffer) / extent));
    if (a > b || c > d) return;
    if (a === b && a === tx0 && a === tx1) {
      emit(a, reduced, c, d);
      return;
    }
    if (a === b) {
      columns(reduced, a, a, c, d);
      return;
    }
    const mid = (a + b) >> 1;
    columns(reduced, a, mid, c, d);
    columns(reduced, mid + 1, b, c, d);
  };
  const [tx0, tx1, ty0, ty1] = range;
  if (ring.length === 0 || tx0 > tx1 || ty0 > ty1) return;
  columns(ring, tx0, tx1, ty0, ty1);
}

/**
 * Second half of {@link clipRingToTiles}: clip a column from
 * {@link clipRingToColumns} to its tiles `ty0 … ty1`, `emit(ty, clipped)` in
 * increasing ty for each tile where the clip is usable.
 */
export function clipColumnToTiles(
  column: Int32Array,
  tx: number,
  ty0: number,
  ty1: number,
  extent: number,
  buffer: number,
  emit: (ty: number, clipped: Int32Array) => void,
): void {
  const minX = tx * extent - buffer;
  const maxX = (tx + 1) * extent + buffer;
  const rows = (pts: Int32Array, r0: number, r1: number): void => {
    const minY = r0 * extent - buffer;
    const maxY = (r1 + 1) * extent + buffer;
    const reduced = reduceRing(pts, (x, y) => (x < minX ? LEFT : x > maxX ? RIGHT : y < minY ? TOP : y > maxY ? BOTTOM : 0));
    const bb = ringBBox(reduced);
    if (bb.maxX < minX || bb.minX > maxX || bb.maxY < minY || bb.minY > maxY) return;
    const a = Math.max(r0, Math.floor((bb.minY - buffer) / extent));
    const b = Math.min(r1, Math.floor((bb.maxY + buffer) / extent));
    if (a > b) return;
    if (a === b) {
      const ox = tx * extent;
      const oy = a * extent;
      const clipped = clipRing(reduced, { minX, minY: oy - buffer, maxX, maxY: oy + extent + buffer }, ox, oy);
      if (clipped) emit(a, clipped);
      return;
    }
    const mid = (a + b) >> 1;
    rows(reduced, a, mid);
    rows(reduced, mid + 1, b);
  };
  if (column.length === 0 || ty0 > ty1) return;
  rows(column, ty0, ty1);
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
