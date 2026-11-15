/**
 * Compact storage for the tile builder (SPEC_VECTOR_TILES.md § Scale): every
 * ring of a layer in ONE growable `Int32Array` of coordinates plus ring offsets,
 * instead of one typed array (and one JS object) per ring, and a shared-border
 * simplification over that layout whose junction table is a typed open
 * addressing hash, processed in partitions so its size is bounded whatever the
 * layer size (Montréal: ~15 M vertices).
 *
 * The simplification is the same algorithm as `simplifyLayer` (geometry.ts),
 * which stays the reference: on the same input it returns the same rings
 * (tested).
 */

import {
  isUsableRing,
  KEY_SPAN,
  simplifyByArcs,
  simplifyRingAlone,
  type SimplifyStats,
} from "./geometry.js";

/** ES2024 resizable `ArrayBuffer` (Node >= 20), not in the ES2023 lib typings. */
interface ResizableArrayBuffer extends ArrayBuffer {
  readonly maxByteLength: number;
  resize(byteLength: number): void;
}
const ResizableArrayBuffer = ArrayBuffer as unknown as new (
  byteLength: number,
  options: { maxByteLength: number },
) => ResizableArrayBuffer;

type TypedArray = Int32Array | Uint32Array | Float64Array | Uint8Array;
interface TypedArrayCtor<T extends TypedArray> {
  new (buffer: ArrayBufferLike): T;
  readonly BYTES_PER_ELEMENT: number;
}

/**
 * A growable typed array over a resizable `ArrayBuffer`: growing extends the
 * reserved range in place (no copy, so no transient double), and
 * {@link release} returns the memory to the OS at once.
 */
export class Growable<T extends TypedArray> {
  readonly #buffer: ResizableArrayBuffer;
  readonly #ctor: TypedArrayCtor<T>;
  /** Length-tracking view over the whole buffer. */
  #all: T;
  length = 0;

  constructor(ctor: TypedArrayCtor<T>, maxElements = 2 ** 26) {
    this.#ctor = ctor;
    this.#buffer = new ResizableArrayBuffer(0, { maxByteLength: maxElements * ctor.BYTES_PER_ELEMENT });
    this.#all = new ctor(this.#buffer);
  }

  #reserve(need: number): void {
    const max = this.#buffer.maxByteLength / this.#ctor.BYTES_PER_ELEMENT;
    if (need > max) throw new Error(`tiles: compact store over ${max} elements`);
    const capacity = Math.min(max, Math.max(need, this.#all.length * 2, 1024));
    this.#buffer.resize(capacity * this.#ctor.BYTES_PER_ELEMENT);
  }

  push(value: number): void {
    if (this.length === this.#all.length) this.#reserve(this.length + 1);
    this.#all[this.length++] = value;
  }

  /** Append `values` (a typed array or array of numbers). */
  append(values: ArrayLike<number>): void {
    const need = this.length + values.length;
    if (need > this.#all.length) this.#reserve(need);
    (this.#all as unknown as { set(a: ArrayLike<number>, o: number): void }).set(values, this.length);
    this.length = need;
  }

  get(i: number): number {
    return this.#all[i]!;
  }

  set(i: number, value: number): void {
    this.#all[i] = value;
  }

  /** The elements written so far (a view, valid until the next growth or {@link release}). */
  view(): T {
    return this.#all.subarray(0, this.length) as T;
  }

  /** Bytes reserved and committed. */
  get bytes(): number {
    return this.#buffer.byteLength;
  }

  release(): void {
    this.#buffer.resize(0);
    this.length = 0;
  }
}

/** Rings of a layer: ring r = vertices `ringStart[r]` … `ringStart[r + 1] - 1` of `coords` (x, y interleaved). */
export interface FlatRings {
  coords: Int32Array;
  ringStart: Uint32Array;
}

function mixA(dx: number, dy: number): number {
  let h = Math.imul(dx, 0x9e3779b1) ^ Math.imul(dy + 0x632be5ab, 0x85ebca77);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

function mixB(dx: number, dy: number): number {
  let h = Math.imul(dx ^ 0x27d4eb2f, 0x165667b1) + Math.imul(dy, 0xd3a2646c);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Junction table: per unique vertex key, the first unordered neighbour pair
 * seen and a junction flag (the pair changed). Open addressing over typed
 * arrays: 25 bytes per slot, no per-vertex JS object.
 */
class JunctionHash {
  readonly #mask: number;
  readonly #keys: Float64Array;
  readonly #lo: Float64Array;
  readonly #hi: Float64Array;
  readonly #flag: Uint8Array;
  size = 0;

  constructor(capacity: number) {
    this.#mask = capacity - 1;
    this.#keys = new Float64Array(capacity).fill(-1);
    this.#lo = new Float64Array(capacity);
    this.#hi = new Float64Array(capacity);
    this.#flag = new Uint8Array(capacity);
  }

  reset(): void {
    this.#keys.fill(-1);
    this.#flag.fill(0);
    this.size = 0;
  }

  #slot(k: number): number {
    const dx = Math.floor(k / KEY_SPAN);
    let s = mixA(dx, k - dx * KEY_SPAN) & this.#mask;
    for (;;) {
      const at = this.#keys[s]!;
      if (at === -1 || at === k) return s;
      s = (s + 1) & this.#mask;
    }
  }

  observe(k: number, a: number, b: number): void {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const s = this.#slot(k);
    if (this.#keys[s] === -1) {
      if (this.size >= this.#mask) throw new Error("tiles: junction table full");
      this.#keys[s] = k;
      this.#lo[s] = lo;
      this.#hi[s] = hi;
      this.size++;
      return;
    }
    if (this.#lo[s] !== lo || this.#hi[s] !== hi) this.#flag[s] = 1;
  }

  isJunction(k: number): boolean {
    const s = this.#slot(k);
    return this.#keys[s] === k && this.#flag[s] === 1;
  }

  junctions(): number {
    let n = 0;
    for (let i = 0; i < this.#flag.length; i++) n += this.#flag[i]!;
    return n;
  }
}

export interface SimplifyFlatOptions {
  /** Vertex occurrences per junction-table partition (default 2^21: a ~100 MB table). */
  partitionVertices?: number;
}

export interface SimplifiedRings {
  rings: FlatRings;
  stats: SimplifyStats & { partitions: number };
  /** Frees the output (no-op when the input was returned as is). */
  release(): void;
}

/**
 * Simplify the rings flagged in `keep` at `tolerance` (quantized units), with
 * the semantics of `simplifyLayer`: junctions over all kept rings (shared
 * borders keep identical vertices on both sides), Douglas–Peucker per arc,
 * unusable results fall back to the input ring. Rings not kept come out empty.
 *
 * Junction detection is split into P partitions by a hash of the vertex: each
 * partition fills a bounded typed table, flags its junction vertices, and is
 * reset. Memory ~ 25 B × 1.5 × (vertices / P) for the table + 1 B per vertex.
 */
export function simplifyFlat(
  src: FlatRings,
  keep: Uint8Array,
  tolerance: number,
  sharedBorders: boolean,
  options: SimplifyFlatOptions = {},
): SimplifiedRings {
  const { coords, ringStart } = src;
  const ringCount = keep.length;
  const stats = { verticesIn: 0, verticesOut: 0, fallbackRings: 0, junctions: 0, partitions: 0 };
  for (let r = 0; r < ringCount; r++) if (keep[r]) stats.verticesIn += ringStart[r + 1]! - ringStart[r]!;
  if (tolerance <= 0) {
    stats.verticesOut = stats.verticesIn;
    return { rings: src, stats, release: () => {} };
  }
  const sqTol = tolerance * tolerance;
  const out = new Growable(Int32Array, 2 ** 28);
  const outStart = new Uint32Array(ringCount + 1);

  const emit = (r: number, ring: Int32Array): void => {
    out.append(ring);
    outStart[r + 1] = out.length / 2;
  };

  if (!sharedBorders) {
    for (let r = 0; r < ringCount; r++) {
      const ring = coords.subarray(2 * ringStart[r]!, 2 * ringStart[r + 1]!);
      if (!keep[r]) emit(r, ring.subarray(0, 0));
      else if (ring.length / 2 < 4) emit(r, ring);
      else {
        const s = simplifyRingAlone(ring, sqTol);
        if (isUsableRing(s)) emit(r, s);
        else {
          stats.fallbackRings++;
          emit(r, ring);
        }
      }
    }
    stats.verticesOut = out.length / 2;
    return { rings: { coords: out.view(), ringStart: outStart }, stats, release: () => out.release() };
  }

  let minX = Infinity;
  let minY = Infinity;
  let kept = 0;
  for (let r = 0; r < ringCount; r++) {
    if (!keep[r]) continue;
    for (let v = ringStart[r]!; v < ringStart[r + 1]!; v++) {
      if (coords[2 * v]! < minX) minX = coords[2 * v]!;
      if (coords[2 * v + 1]! < minY) minY = coords[2 * v + 1]!;
      kept++;
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
  }
  const keyAt = (v: number): number => {
    const dx = coords[2 * v]! - minX;
    const dy = coords[2 * v + 1]! - minY;
    if (dx >= KEY_SPAN || dy >= KEY_SPAN) throw new Error(`vertex outside the layer key span: ${coords[2 * v]},${coords[2 * v + 1]}`);
    return dx * KEY_SPAN + dy;
  };
  const partOf = (v: number, parts: number): number => mixB(coords[2 * v]! - minX, coords[2 * v + 1]! - minY) % parts;

  const perPartition = options.partitionVertices ?? 2 ** 21;
  const parts = Math.max(1, Math.ceil(kept / perPartition));
  stats.partitions = parts;
  const counts = new Uint32Array(parts);
  if (parts > 1) {
    for (let r = 0; r < ringCount; r++) {
      if (!keep[r]) continue;
      for (let v = ringStart[r]!; v < ringStart[r + 1]!; v++) counts[partOf(v, parts)]!++;
    }
  } else {
    counts[0] = kept;
  }
  let largest = 0;
  for (const c of counts) largest = Math.max(largest, c);
  let capacity = 1024;
  while (capacity < largest * 1.5 + 16) capacity *= 2;
  const table = new JunctionHash(capacity);
  const junction = new Uint8Array(ringStart[ringCount]!);

  for (let p = 0; p < parts; p++) {
    if (p > 0) table.reset();
    for (let r = 0; r < ringCount; r++) {
      if (!keep[r]) continue;
      const s = ringStart[r]!;
      const n = ringStart[r + 1]! - s;
      for (let i = 0; i < n; i++) {
        const v = s + i;
        if (parts > 1 && partOf(v, parts) !== p) continue;
        table.observe(keyAt(v), keyAt(s + ((i + n - 1) % n)), keyAt(s + ((i + 1) % n)));
      }
    }
    for (let r = 0; r < ringCount; r++) {
      if (!keep[r]) continue;
      for (let v = ringStart[r]!; v < ringStart[r + 1]!; v++) {
        if (parts > 1 && partOf(v, parts) !== p) continue;
        if (table.isJunction(keyAt(v))) junction[v] = 1;
      }
    }
    stats.junctions += table.junctions();
  }

  let keys = new Float64Array(1024);
  for (let r = 0; r < ringCount; r++) {
    const s = ringStart[r]!;
    const ring = coords.subarray(2 * s, 2 * ringStart[r + 1]!);
    const n = ring.length / 2;
    if (!keep[r]) {
      emit(r, ring.subarray(0, 0));
      continue;
    }
    if (n < 4) {
      emit(r, ring);
      continue;
    }
    if (keys.length < n) keys = new Float64Array(Math.max(n, keys.length * 2));
    const rk = keys.subarray(0, n);
    for (let i = 0; i < n; i++) rk[i] = keyAt(s + i);
    const junctionAt: number[] = [];
    for (let i = 0; i < n; i++) if (junction[s + i]) junctionAt.push(i);
    if (junctionAt.length < 2) {
      let lo = 0;
      let hi = 0;
      for (let i = 1; i < n; i++) {
        if (rk[i]! < rk[lo]!) lo = i;
        if (rk[i]! > rk[hi]!) hi = i;
      }
      for (const extra of [lo, hi]) if (!junctionAt.includes(extra)) junctionAt.push(extra);
      junctionAt.sort((a, b) => a - b);
    }
    const simplified = simplifyByArcs(ring, rk, junctionAt, sqTol);
    if (isUsableRing(simplified)) emit(r, simplified);
    else {
      stats.fallbackRings++;
      emit(r, ring);
    }
  }
  stats.verticesOut = 0;
  for (let r = 0; r < ringCount; r++) if (keep[r]) stats.verticesOut += outStart[r + 1]! - outStart[r]!;
  return { rings: { coords: out.view(), ringStart: outStart }, stats, release: () => out.release() };
}
