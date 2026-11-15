/**
 * Simplicity test of a closed linear ring: no two non-adjacent edges touch or
 * cross (collinear contact counts as a touch). Used to keep the display mirror
 * from introducing invalid rings: a rounded ring that is not simple while its
 * exact ring is simple falls back to the exact geometry.
 *
 * Edges are bucketed on a uniform grid (~sqrt(n) cells per axis over the ring's
 * bbox); only edges whose cell rectangles intersect are compared. Exact
 * integer-free arithmetic on doubles: the inputs are the very coordinates that
 * get serialized, so the verdict matches the output.
 *
 * Memory is O(n + grid entries), independent of how the vertices are
 * distributed. The previous version deduplicated the compared pairs with a
 * `Set` of pair keys, which is O(pairs): a ring whose vertices crowd into one
 * cell (`qc-zonage-montreal-pum-2050-intensification-affectation`, 5 729 edges,
 * 5 037 of them in one cell) put 12.7 M keys in it — ~630 MB of heap for a
 * 200 KB feature, OOMKilled at 1 Gi. Each pair is now compared exactly once, in
 * the first cell its two rectangles share (no bookkeeping), so the set of
 * compared pairs — hence the verdict — is unchanged.
 *
 * Work is bounded too: past {@link RING_PAIR_BUDGET} compared pairs (counted
 * BEFORE comparing on the grid path), the test throws {@link RingTooComplexError}
 * instead of spinning; the display build reports it as `too-large`.
 */

import type { Position } from "@sentropic/geo-core";

/**
 * Most edge pairs one ring test may compare (~1-3 s of CPU). Every ring the
 * previous implementation could test stays under it: that one kept the unique
 * pairs in a `Set`, which V8 caps at 2^24 entries.
 */
export const RING_PAIR_BUDGET = 2 ** 27;

/**
 * Most grid entries (edge x cell) materialized at once (4 bytes each). A ring
 * whose edges span more cells is checked by a sweep over the same cell
 * rectangles instead (O(n) memory, same compared pairs).
 */
export const RING_GRID_ENTRY_BUDGET = 2 ** 22;

/** A ring too complex to check within {@link RING_PAIR_BUDGET}. */
export class RingTooComplexError extends Error {
  constructor(
    readonly edges: number,
    readonly pairs: number,
  ) {
    super(`ring too complex to check: ${edges} edges, over ${pairs} edge pairs to compare (budget ${RING_PAIR_BUDGET})`);
    this.name = "RingTooComplexError";
  }
}

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

/** Edge cell rectangles: edge `i` covers columns `x0[i]..x1[i]`, rows `y0[i]..y1[i]`. */
interface Cells {
  n: number;
  cells: number;
  x0: Int32Array;
  x1: Int32Array;
  y0: Int32Array;
  y1: Int32Array;
  /** Sum of the rectangle areas (grid entries). */
  entries: number;
}

function cellRectangles(ring: readonly Position[], n: number): Cells {
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
  const x0 = new Int32Array(n);
  const x1 = new Int32Array(n);
  const y0 = new Int32Array(n);
  const y1 = new Int32Array(n);
  let entries = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    x0[i] = cellOf(Math.min(a[0], b[0]), minX, w);
    x1[i] = cellOf(Math.max(a[0], b[0]), minX, w);
    y0[i] = cellOf(Math.min(a[1], b[1]), minY, h);
    y1[i] = cellOf(Math.max(a[1], b[1]), minY, h);
    entries += (x1[i]! - x0[i]! + 1) * (y1[i]! - y0[i]! + 1);
  }
  return { n, cells, x0, x1, y0, y1, entries };
}

/**
 * Whether the closed ring (first == last position) is simple. Throws
 * {@link RingTooComplexError} past {@link RING_PAIR_BUDGET}.
 * `gridEntryBudget` (default {@link RING_GRID_ENTRY_BUDGET}) only picks the
 * path — grid or sweep — never the verdict.
 */
export function isSimpleRing(
  ring: readonly Position[],
  options: { gridEntryBudget?: number } = {},
): boolean {
  const n = ring.length - 1; // edges
  if (n < 3) return false;
  const rects = cellRectangles(ring, n);
  return rects.entries <= (options.gridEntryBudget ?? RING_GRID_ENTRY_BUDGET)
    ? gridSimple(ring, rects)
    : sweepSimple(ring, rects);
}

/** Two edges are compared iff non-adjacent; adjacent edges share a vertex. */
function adjacent(i: number, j: number, n: number): boolean {
  return j === i + 1 || (i === 0 && j === n - 1);
}

/**
 * Grid path: edges bucketed per cell in flat typed arrays (CSR). A pair is
 * compared only in the first cell — lowest column, then lowest row — of the
 * intersection of its two rectangles, i.e. exactly once.
 */
function gridSimple(ring: readonly Position[], r: Cells): boolean {
  const { n, cells, x0, x1, y0, y1 } = r;
  const start = new Int32Array(cells * cells + 1);
  for (let i = 0; i < n; i++) {
    for (let x = x0[i]!; x <= x1[i]!; x++) {
      for (let y = y0[i]!; y <= y1[i]!; y++) start[x * cells + y + 1]!++;
    }
  }
  // Budget measured before any comparison: pairs iterated = sum of k(k-1)/2.
  let pairs = 0;
  for (let k = 1; k < start.length; k++) {
    const count = start[k]!;
    pairs += (count * (count - 1)) / 2;
    start[k] = start[k - 1]! + count;
  }
  if (pairs > RING_PAIR_BUDGET) throw new RingTooComplexError(n, pairs);

  const fill = start.slice(0, cells * cells);
  const edges = new Int32Array(r.entries);
  // Edges enter each bucket in increasing index order: within a bucket p < q => i < j.
  for (let i = 0; i < n; i++) {
    for (let x = x0[i]!; x <= x1[i]!; x++) {
      for (let y = y0[i]!; y <= y1[i]!; y++) edges[fill[x * cells + y]!++] = i;
    }
  }

  for (let key = 0; key < cells * cells; key++) {
    const from = start[key]!;
    const to = start[key + 1]!;
    if (to - from < 2) continue;
    const cx = Math.floor(key / cells);
    const cy = key - cx * cells;
    for (let p = from; p < to; p++) {
      const i = edges[p]!;
      for (let q = p + 1; q < to; q++) {
        const j = edges[q]!;
        if (adjacent(i, j, n)) continue;
        // First shared cell = (max of the column starts, max of the row starts).
        if (Math.max(x0[i]!, x0[j]!) !== cx || Math.max(y0[i]!, y0[j]!) !== cy) continue;
        if (segmentsTouch(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return false;
      }
    }
  }
  return true;
}

/**
 * Sweep path (rectangles too large to materialize): edges sorted by first
 * column, an active list of those whose column range reaches the current one;
 * a pair is compared iff its rectangles intersect — the same pairs as the grid.
 * Work is counted as it goes against {@link RING_PAIR_BUDGET}.
 */
function sweepSimple(ring: readonly Position[], r: Cells): boolean {
  const { n, x0, x1, y0, y1 } = r;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => x0[a]! - x0[b]! || a - b);
  const active = new Int32Array(n);
  let size = 0;
  let work = 0;
  for (let k = 0; k < n; k++) {
    const e = order[k]!;
    const col = x0[e]!;
    let kept = 0;
    for (let s = 0; s < size; s++) {
      const a = active[s]!;
      if (x1[a]! < col) continue; // left behind for good: columns only grow
      active[kept++] = a;
      if (++work > RING_PAIR_BUDGET) throw new RingTooComplexError(n, work);
      if (y1[a]! < y0[e]! || y1[e]! < y0[a]!) continue;
      const i = Math.min(a, e);
      const j = Math.max(a, e);
      if (adjacent(i, j, n)) continue;
      if (segmentsTouch(ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!)) return false;
    }
    active[kept++] = e;
    size = kept;
  }
  return true;
}
