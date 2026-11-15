/**
 * Projection, quantization and shared-border-aware simplification of a whole
 * polygon layer (SPEC_VECTOR_TILES.md § Geometry).
 *
 * Coordinates go through three spaces:
 *
 * 1. lon/lat (source GeoJSON, EPSG:4326);
 * 2. world: Web Mercator normalized to [0, 1] (x east, y DOWN), computed once;
 * 3. quantized: world × extent × 2^z rounded to integers, i.e. the tile pixel
 *    grid of zoom z. A shared vertex lands on the same integer point on both
 *    sides, so quantization alone never opens a gap between neighbours.
 *
 * Simplification (Douglas–Peucker) then runs on ARCS, not on rings: a vertex
 * where the set of neighbouring rings changes is a junction, every ring is cut
 * at its junctions, and each arc is simplified in one canonical direction. The
 * two rings that share an arc therefore keep exactly the same vertices on it:
 * no gap, no overlap between adjacent lots (the property tippecanoe calls
 * `--detect-shared-borders`). With `sharedBorders: false` each ring is
 * simplified on its own (geojson-vt / naive behaviour), for comparison.
 */

/** Rings are open (no repeated closing vertex), flat `[x0, y0, x1, y1, …]`. */
export type WorldRing = Float64Array;
export type WorldPolygon = WorldRing[];
export type QRing = Int32Array;
export type QPolygon = QRing[];

const MAX_LAT = 85.0511287798066;

/** lon/lat → world Web Mercator in [0, 1], y down. */
export function lonLatToWorld(lon: number, lat: number): [number, number] {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  const x = lon / 360 + 0.5;
  const y = 0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI;
  return [x, y];
}

/** world → lon/lat (inverse of {@link lonLatToWorld}). */
export function worldToLonLat(x: number, y: number): [number, number] {
  const lon = (x - 0.5) * 360;
  const lat = (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;
  return [lon, lat];
}

type Position = readonly number[];

/** A GeoJSON ring (closed or not) → open world ring. */
export function projectRing(ring: readonly Position[]): WorldRing {
  let n = ring.length;
  if (n > 1 && ring[0]![0] === ring[n - 1]![0] && ring[0]![1] === ring[n - 1]![1]) n--;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [x, y] = lonLatToWorld(ring[i]![0]!, ring[i]![1]!);
    out[2 * i] = x;
    out[2 * i + 1] = y;
  }
  return out;
}

/** Twice the signed area (shoelace) of an open flat ring. Positive = clockwise on screen (y down). */
export function ringArea2(ring: ArrayLike<number>): number {
  const n = ring.length / 2;
  let s = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    s += ring[2 * j]! * ring[2 * i + 1]! - ring[2 * i]! * ring[2 * j + 1]!;
  }
  return s;
}

/** Quantize an open world ring at `scale` (= extent × 2^z); drops consecutive and closing duplicates. */
export function quantizeRing(ring: WorldRing, scale: number): QRing {
  const n = ring.length / 2;
  const tmp = new Int32Array(n * 2);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.round(ring[2 * i]! * scale);
    const y = Math.round(ring[2 * i + 1]! * scale);
    if (m > 0 && tmp[2 * (m - 1)] === x && tmp[2 * (m - 1) + 1] === y) continue;
    tmp[2 * m] = x;
    tmp[2 * m + 1] = y;
    m++;
  }
  while (m > 1 && tmp[0] === tmp[2 * (m - 1)] && tmp[1] === tmp[2 * (m - 1) + 1]) m--;
  return tmp.slice(0, m * 2);
}

/** A ring is usable when it has ≥ 3 vertices and a non-zero area. */
export function isUsableRing(ring: ArrayLike<number>): boolean {
  return ring.length >= 6 && ringArea2(ring) !== 0;
}

export interface SimplifyStats {
  verticesIn: number;
  verticesOut: number;
  /** Rings whose simplified form degenerated and were kept unsimplified. */
  fallbackRings: number;
  /** Junction vertices (shared-border mode). */
  junctions: number;
}

/**
 * Vertex keys: a quantized point relative to the layer's minimum, packed into
 * one safe integer (26 bits per axis: a layer may span 67 M units, i.e. about
 * 6 700 km at z16 / extent 4096).
 */
const KEY_SPAN = 2 ** 26;

class VertexKeys {
  constructor(
    readonly minX: number,
    readonly minY: number,
  ) {}
  key(x: number, y: number): number {
    const dx = x - this.minX;
    const dy = y - this.minY;
    if (dx < 0 || dy < 0 || dx >= KEY_SPAN || dy >= KEY_SPAN) throw new Error(`vertex outside the layer key span: ${x},${y}`);
    return dx * KEY_SPAN + dy;
  }
}

/** Junction table: per unique vertex, the first neighbour pair seen and a junction flag. */
class JunctionTable {
  private readonly slots = new Map<number, number>();
  private lo = new Float64Array(1024);
  private hi = new Float64Array(1024);
  private flag = new Uint8Array(1024);
  private size = 0;

  observe(v: number, a: number, b: number): void {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const slot = this.slots.get(v);
    if (slot === undefined) {
      if (this.size === this.lo.length) this.grow();
      this.slots.set(v, this.size);
      this.lo[this.size] = lo;
      this.hi[this.size] = hi;
      this.size++;
      return;
    }
    if (this.lo[slot] !== lo || this.hi[slot] !== hi) this.flag[slot] = 1;
  }

  isJunction(v: number): boolean {
    const slot = this.slots.get(v);
    return slot !== undefined && this.flag[slot] === 1;
  }

  count(): number {
    let n = 0;
    for (let i = 0; i < this.size; i++) n += this.flag[i]!;
    return n;
  }

  private grow(): void {
    const n = this.lo.length * 2;
    const lo = new Float64Array(n);
    lo.set(this.lo);
    const hi = new Float64Array(n);
    hi.set(this.hi);
    const flag = new Uint8Array(n);
    flag.set(this.flag);
    this.lo = lo;
    this.hi = hi;
    this.flag = flag;
  }
}

function sqSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  let x = ax;
  let y = ay;
  let dx = bx - x;
  let dy = by - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = bx;
      y = by;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}

/** Douglas–Peucker keep flags over `xs/ys` (endpoints always kept). Deterministic: first max wins. */
function douglasPeucker(xs: ArrayLike<number>, ys: ArrayLike<number>, sqTol: number): Uint8Array {
  const n = xs.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  if (n <= 2) return keep;
  const stack: number[] = [0, n - 1];
  while (stack.length > 0) {
    const last = stack.pop()!;
    const first = stack.pop()!;
    let maxSq = sqTol;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(xs[i]!, ys[i]!, xs[first]!, ys[first]!, xs[last]!, ys[last]!);
      if (d > maxSq) {
        maxSq = d;
        index = i;
      }
    }
    if (index !== -1) {
      keep[index] = 1;
      if (index - first > 1) stack.push(first, index);
      if (last - index > 1) stack.push(index, last);
    }
  }
  return keep;
}

/**
 * Simplify one ring by arcs between `junctionAt` indices (sorted, ≥ 2 distinct
 * indices). Each arc is simplified in its canonical direction (the smaller of
 * (first, second) vertex keys forward vs backward), so the ring on the other
 * side of a shared arc keeps the very same vertices.
 */
function simplifyByArcs(ring: QRing, keys: Float64Array, junctionAt: number[], sqTol: number): QRing {
  const n = ring.length / 2;
  const keepRing = new Uint8Array(n);
  for (const j of junctionAt) keepRing[j] = 1;
  for (let a = 0; a < junctionAt.length; a++) {
    const start = junctionAt[a]!;
    const end = a + 1 < junctionAt.length ? junctionAt[a + 1]! : junctionAt[0]! + n;
    const m = end - start + 1;
    if (m <= 2) continue;
    const idx = (i: number): number => (start + i) % n;
    const fwd1 = keys[idx(0)]!;
    const fwd2 = keys[idx(1)]!;
    const bwd1 = keys[idx(m - 1)]!;
    const bwd2 = keys[idx(m - 2)]!;
    const reverse = bwd1 < fwd1 || (bwd1 === fwd1 && bwd2 < fwd2);
    const xs = new Float64Array(m);
    const ys = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const k = idx(reverse ? m - 1 - i : i);
      xs[i] = ring[2 * k]!;
      ys[i] = ring[2 * k + 1]!;
    }
    const keep = douglasPeucker(xs, ys, sqTol);
    for (let i = 0; i < m; i++) if (keep[i]) keepRing[idx(reverse ? m - 1 - i : i)] = 1;
  }
  let count = 0;
  for (let i = 0; i < n; i++) count += keepRing[i]!;
  const out = new Int32Array(count * 2);
  let o = 0;
  for (let i = 0; i < n; i++) {
    if (!keepRing[i]) continue;
    out[o++] = ring[2 * i]!;
    out[o++] = ring[2 * i + 1]!;
  }
  return out;
}

/** Plain per-ring Douglas–Peucker on a closed ring (split at the vertex farthest from vertex 0). */
function simplifyRingAlone(ring: QRing, sqTol: number): QRing {
  const n = ring.length / 2;
  let far = 0;
  let farSq = -1;
  for (let i = 1; i < n; i++) {
    const dx = ring[2 * i]! - ring[0]!;
    const dy = ring[2 * i + 1]! - ring[1]!;
    if (dx * dx + dy * dy > farSq) {
      farSq = dx * dx + dy * dy;
      far = i;
    }
  }
  const keys = new Float64Array(n); // unused by the plain path: every arc is forward
  for (let i = 0; i < n; i++) keys[i] = i;
  return simplifyByArcs(ring, keys, far === 0 ? [0] : [0, far], sqTol);
}

/**
 * Simplify every ring of a layer at tolerance `tolerance` (quantized units).
 * `layer[f][p][r]` = ring r of polygon p of feature f; returns the same shape.
 * A ring whose simplified form is unusable (< 3 vertices or zero area) is kept
 * unsimplified and counted in `fallbackRings`.
 */
export function simplifyLayer(
  layer: readonly (readonly QPolygon[])[],
  tolerance: number,
  sharedBorders: boolean,
): { layer: QPolygon[][]; stats: SimplifyStats } {
  const stats: SimplifyStats = { verticesIn: 0, verticesOut: 0, fallbackRings: 0, junctions: 0 };
  for (const f of layer) for (const p of f) for (const r of p) stats.verticesIn += r.length / 2;
  if (tolerance <= 0) {
    stats.verticesOut = stats.verticesIn;
    return { layer: layer.map((f) => f.map((p) => p.slice())), stats };
  }
  const sqTol = tolerance * tolerance;

  if (!sharedBorders) {
    const out = layer.map((f) =>
      f.map((p) =>
        p.map((r) => {
          if (r.length / 2 < 4) return r;
          const s = simplifyRingAlone(r, sqTol);
          if (isUsableRing(s)) return s;
          stats.fallbackRings++;
          return r;
        }),
      ),
    );
    for (const f of out) for (const p of f) for (const r of p) stats.verticesOut += r.length / 2;
    return { layer: out, stats };
  }

  let minX = Infinity;
  let minY = Infinity;
  for (const f of layer) {
    for (const p of f) {
      for (const r of p) {
        for (let i = 0; i < r.length; i += 2) {
          if (r[i]! < minX) minX = r[i]!;
          if (r[i + 1]! < minY) minY = r[i + 1]!;
        }
      }
    }
  }
  const vk = new VertexKeys(Number.isFinite(minX) ? minX : 0, Number.isFinite(minY) ? minY : 0);

  // Pass 1: vertex keys and junction detection over the whole layer.
  const ringKeys: Float64Array[][][] = [];
  const table = new JunctionTable();
  for (const f of layer) {
    const fk: Float64Array[][] = [];
    for (const p of f) {
      const pk: Float64Array[] = [];
      for (const r of p) {
        const n = r.length / 2;
        const keys = new Float64Array(n);
        for (let i = 0; i < n; i++) keys[i] = vk.key(r[2 * i]!, r[2 * i + 1]!);
        for (let i = 0; i < n; i++) table.observe(keys[i]!, keys[(i + n - 1) % n]!, keys[(i + 1) % n]!);
        pk.push(keys);
      }
      fk.push(pk);
    }
    ringKeys.push(fk);
  }
  stats.junctions = table.count();

  // Pass 2: cut every ring at its junctions and simplify arc by arc.
  const out: QPolygon[][] = layer.map((f, fi) =>
    f.map((p, pi) =>
      p.map((r, ri) => {
        const n = r.length / 2;
        if (n < 4) return r;
        const keys = ringKeys[fi]![pi]![ri]!;
        const junctionAt: number[] = [];
        for (let i = 0; i < n; i++) if (table.isJunction(keys[i]!)) junctionAt.push(i);
        if (junctionAt.length < 2) {
          // A ring without two junctions (isolated, or shared whole with one
          // other ring, e.g. a lot filling a hole): cut it at its smallest and
          // largest vertex keys, which the other ring computes identically.
          let lo = 0;
          let hi = 0;
          for (let i = 1; i < n; i++) {
            if (keys[i]! < keys[lo]!) lo = i;
            if (keys[i]! > keys[hi]!) hi = i;
          }
          for (const extra of [lo, hi]) if (!junctionAt.includes(extra)) junctionAt.push(extra);
          junctionAt.sort((a, b) => a - b);
        }
        const s = simplifyByArcs(r, keys, junctionAt, sqTol);
        if (isUsableRing(s)) return s;
        stats.fallbackRings++;
        return r;
      }),
    ),
  );
  for (const f of out) for (const p of f) for (const r of p) stats.verticesOut += r.length / 2;
  return { layer: out, stats };
}

/**
 * Border check: total length (quantized units) of directed edges whose reverse
 * edge does not exist in the layer. On a partition (lots), shared edges come in
 * reverse pairs, so this is the outer boundary plus every gap/overlap. Compare
 * before and after simplification: shared-border simplification keeps it at the
 * outer-boundary level, per-ring simplification inflates it.
 */
export function unmatchedEdgeLength(layer: readonly (readonly QPolygon[])[]): number {
  const edges = new Map<string, number>();
  const keyOf = (ax: number, ay: number, bx: number, by: number): string => `${ax},${ay},${bx},${by}`;
  for (const f of layer) {
    for (const p of f) {
      for (const r of p) {
        const n = r.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const k = keyOf(r[2 * i]!, r[2 * i + 1]!, r[2 * j]!, r[2 * j + 1]!);
          edges.set(k, (edges.get(k) ?? 0) + 1);
        }
      }
    }
  }
  let total = 0;
  for (const f of layer) {
    for (const p of f) {
      for (const r of p) {
        const n = r.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          if (!edges.has(keyOf(r[2 * j]!, r[2 * j + 1]!, r[2 * i]!, r[2 * i + 1]!))) {
            total += Math.hypot(r[2 * j]! - r[2 * i]!, r[2 * j + 1]! - r[2 * i + 1]!);
          }
        }
      }
    }
  }
  return total;
}
