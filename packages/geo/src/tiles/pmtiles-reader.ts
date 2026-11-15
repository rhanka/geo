/**
 * PMTiles v3 reader over byte ranges (serving side, SPEC_VECTOR_TILES.md §
 * Serving). Reads the header and the root directory with ONE range of the
 * first 16 KiB, a leaf directory when the root points to one, then the tile's
 * own bytes: never the whole archive.
 *
 * Directories are kept parsed in typed arrays (24 B per entry) so a cache of
 * them is cheap and its size is known.
 */

import { gunzipSync } from "node:zlib";

import { zxyToTileId } from "./pmtiles.js";

/** Reads `length` bytes at `offset`; a short read means the end of the archive. */
export type RangeRead = (offset: number, length: number) => Promise<Uint8Array>;

export interface PmHeader {
  rootOffset: number;
  rootLength: number;
  metadataOffset: number;
  metadataLength: number;
  leafOffset: number;
  leafLength: number;
  dataOffset: number;
  dataLength: number;
  numAddressedTiles: number;
  internalCompression: number;
  tileCompression: number;
  tileType: number;
  minZoom: number;
  maxZoom: number;
  bounds: [number, number, number, number];
}

/** A parsed directory: entry i = (tileIds[i], runLengths[i], offsets[i], lengths[i]). */
export interface PmDirectory {
  tileIds: Float64Array;
  runLengths: Uint32Array;
  offsets: Float64Array;
  lengths: Uint32Array;
}

export const HEADER_AND_ROOT_BYTES = 16_384;
const HEADER_BYTES = 127;

function u64(view: DataView, at: number): number {
  const v = view.getBigUint64(at, true);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("PMTiles: offset over 2^53");
  return Number(v);
}

export function parseHeader(bytes: Uint8Array): PmHeader {
  if (bytes.length < HEADER_BYTES) throw new Error("PMTiles: truncated header");
  if (Buffer.from(bytes.subarray(0, 7)).toString("ascii") !== "PMTiles" || bytes[7] !== 3) {
    throw new Error("PMTiles: not a v3 archive");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const e7 = (at: number): number => view.getInt32(at, true) / 1e7;
  return {
    rootOffset: u64(view, 8),
    rootLength: u64(view, 16),
    metadataOffset: u64(view, 24),
    metadataLength: u64(view, 32),
    leafOffset: u64(view, 40),
    leafLength: u64(view, 48),
    dataOffset: u64(view, 56),
    dataLength: u64(view, 64),
    numAddressedTiles: u64(view, 72),
    internalCompression: bytes[97]!,
    tileCompression: bytes[98]!,
    tileType: bytes[99]!,
    minZoom: bytes[100]!,
    maxZoom: bytes[101]!,
    bounds: [e7(102), e7(106), e7(110), e7(114)],
  };
}

function decompress(bytes: Uint8Array, compression: number): Uint8Array {
  if (compression === 1 || compression === 0) return bytes;
  if (compression === 2) return gunzipSync(bytes);
  throw new Error(`PMTiles: unsupported internal compression ${compression}`);
}

export function deserializeDirectory(raw: Uint8Array): PmDirectory {
  let pos = 0;
  const varint = (): number => {
    let result = 0;
    let shift = 1;
    for (;;) {
      if (pos >= raw.length) throw new Error("PMTiles: truncated directory");
      const b = raw[pos++]!;
      result += (b & 0x7f) * shift;
      if (b < 0x80) return result;
      shift *= 128;
    }
  };
  const n = varint();
  const dir: PmDirectory = {
    tileIds: new Float64Array(n),
    runLengths: new Uint32Array(n),
    offsets: new Float64Array(n),
    lengths: new Uint32Array(n),
  };
  let last = 0;
  for (let i = 0; i < n; i++) {
    last += varint();
    dir.tileIds[i] = last;
  }
  for (let i = 0; i < n; i++) dir.runLengths[i] = varint();
  for (let i = 0; i < n; i++) dir.lengths[i] = varint();
  for (let i = 0; i < n; i++) {
    const v = varint();
    dir.offsets[i] = v === 0 && i > 0 ? dir.offsets[i - 1]! + dir.lengths[i - 1]! : v - 1;
  }
  return dir;
}

/** Bytes a parsed directory holds (cache accounting). */
export function directoryBytes(dir: PmDirectory): number {
  return dir.tileIds.length * 24 + 64;
}

/** Index of the entry covering `tileId` (a tile run or a leaf pointer), or -1. */
export function findEntry(dir: PmDirectory, tileId: number): number {
  let lo = 0;
  let hi = dir.tileIds.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = tileId - dir.tileIds[mid]!;
    if (c > 0) lo = mid + 1;
    else if (c < 0) hi = mid - 1;
    else return mid;
  }
  if (hi >= 0) {
    if (dir.runLengths[hi] === 0) return hi;
    if (tileId - dir.tileIds[hi]! < dir.runLengths[hi]!) return hi;
  }
  return -1;
}

export interface HeaderAndRoot {
  header: PmHeader;
  root: PmDirectory;
}

/** Header + root directory: one range read of the first 16 KiB (a second only for a non-standard layout). */
export async function readHeaderAndRoot(read: RangeRead): Promise<HeaderAndRoot> {
  const first = await read(0, HEADER_AND_ROOT_BYTES);
  const header = parseHeader(first);
  const end = header.rootOffset + header.rootLength;
  const rootBytes =
    end <= first.length ? first.subarray(header.rootOffset, end) : await read(header.rootOffset, header.rootLength);
  if (rootBytes.length !== header.rootLength) throw new Error("PMTiles: truncated root directory");
  return { header, root: deserializeDirectory(decompress(rootBytes, header.internalCompression)) };
}

/** A bounded cache of parsed leaf directories, by key. */
export interface LeafCache {
  get(key: string): PmDirectory | undefined;
  set(key: string, dir: PmDirectory): void;
}

/**
 * The bytes of tile z/x/y as stored (still compressed with
 * `header.tileCompression`), or `undefined` when the archive has no such tile.
 * Reads at most one leaf directory per level (cached by `leafKey + offset`)
 * and the tile's own range.
 */
export async function readTile(
  read: RangeRead,
  hr: HeaderAndRoot,
  z: number,
  x: number,
  y: number,
  leaves?: { cache: LeafCache; key: string },
): Promise<Uint8Array | undefined> {
  const { header } = hr;
  const tileId = zxyToTileId(z, x, y);
  let dir = hr.root;
  for (let depth = 0; depth < 4; depth++) {
    const i = findEntry(dir, tileId);
    if (i < 0) return undefined;
    const offset = dir.offsets[i]!;
    const length = dir.lengths[i]!;
    if (dir.runLengths[i]! > 0) {
      const bytes = await read(header.dataOffset + offset, length);
      if (bytes.length !== length) throw new Error("PMTiles: truncated tile data");
      return bytes;
    }
    const cacheKey = leaves ? `${leaves.key}@${offset}` : "";
    let leaf = leaves?.cache.get(cacheKey);
    if (!leaf) {
      const raw = await read(header.leafOffset + offset, length);
      if (raw.length !== length) throw new Error("PMTiles: truncated leaf directory");
      leaf = deserializeDirectory(decompress(raw, header.internalCompression));
      leaves?.cache.set(cacheKey, leaf);
    }
    dir = leaf;
  }
  throw new Error("PMTiles: directory depth over 4");
}

/**
 * Least-recently-used map bounded by an approximate byte size. `sizeOf` gives
 * an entry's cost; the oldest entries are evicted once the total exceeds
 * `maxBytes` (an entry larger than the budget is not kept).
 */
export class ByteLru<V> {
  readonly #map = new Map<string, { value: V; bytes: number }>();
  #bytes = 0;
  constructor(
    readonly maxBytes: number,
    private readonly sizeOf: (value: V) => number,
  ) {}

  get(key: string): V | undefined {
    const hit = this.#map.get(key);
    if (!hit) return undefined;
    this.#map.delete(key);
    this.#map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    const bytes = this.sizeOf(value);
    const old = this.#map.get(key);
    if (old) {
      this.#bytes -= old.bytes;
      this.#map.delete(key);
    }
    if (bytes > this.maxBytes) return;
    this.#map.set(key, { value, bytes });
    this.#bytes += bytes;
    for (const [k, v] of this.#map) {
      if (this.#bytes <= this.maxBytes) break;
      this.#map.delete(k);
      this.#bytes -= v.bytes;
    }
  }

  delete(key: string): void {
    const old = this.#map.get(key);
    if (!old) return;
    this.#bytes -= old.bytes;
    this.#map.delete(key);
  }

  get size(): number {
    return this.#map.size;
  }

  get bytes(): number {
    return this.#bytes;
  }
}
