/**
 * PMTiles v3 writer (single archive, clustered, deduplicated tile contents).
 * Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 *
 * The `pmtiles` npm package only reads archives; the writer is small enough to
 * own here. Tests read every archive back with the reference reader.
 *
 * Layout: header (127 B) | root directory | JSON metadata | leaf directories |
 * tile data. Directories and metadata are gzip-compressed; tile bytes are
 * stored as given (the caller compresses them and declares the compression).
 */

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

/** (4^z - 1) / 3: number of tiles in zooms 0 … z-1. */
function tilesBelow(z: number): number {
  return (4 ** z - 1) / 3;
}

/** Hilbert tile id of z/x/y (PMTiles v3). */
export function zxyToTileId(z: number, x: number, y: number): number {
  if (!Number.isInteger(z) || z < 0 || z > 26) throw new Error(`zoom out of range: ${z}`);
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) throw new Error(`tile out of range: ${z}/${x}/${y}`);
  let tx = x;
  let ty = y;
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (tx & s) > 0 ? 1 : 0;
    const ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        tx = s - 1 - (tx % s);
        ty = s - 1 - (ty % s);
      }
      [tx, ty] = [ty, tx];
    }
  }
  return tilesBelow(z) + d;
}

export const PmCompression = { Unknown: 0, None: 1, Gzip: 2, Brotli: 3, Zstd: 4 } as const;
export const PmTileType = { Unknown: 0, Mvt: 1 } as const;

export interface PmtilesTileInput {
  z: number;
  x: number;
  y: number;
  /** Tile bytes, already compressed with `tileCompression`. */
  data: Uint8Array;
}

export interface PmtilesWriteOptions {
  tileCompression: number;
  tileType: number;
  minZoom: number;
  maxZoom: number;
  /** [minLon, minLat, maxLon, maxLat]. */
  bounds: [number, number, number, number];
  center?: [number, number, number];
  metadata: Record<string, unknown>;
}

interface Entry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

function writeVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

function serializeDirectory(entries: readonly Entry[]): Uint8Array {
  const out: number[] = [];
  writeVarint(out, entries.length);
  let last = 0;
  for (const e of entries) {
    writeVarint(out, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    if (i > 0 && prev !== undefined && e.offset === prev.offset + prev.length) writeVarint(out, 0);
    else writeVarint(out, e.offset + 1);
  });
  return gzipSync(Uint8Array.from(out));
}

const HEADER_BYTES = 127;
const ROOT_BUDGET = 16_384 - HEADER_BYTES;

function buildDirectories(entries: readonly Entry[]): { root: Uint8Array; leaves: Uint8Array } {
  const root = serializeDirectory(entries);
  if (root.length <= ROOT_BUDGET) return { root, leaves: new Uint8Array(0) };
  for (let leafSize = 4096; ; leafSize = Math.ceil(leafSize * 1.2)) {
    const rootEntries: Entry[] = [];
    const leafParts: Uint8Array[] = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const chunk = entries.slice(i, i + leafSize);
      const bytes = serializeDirectory(chunk);
      rootEntries.push({ tileId: chunk[0]!.tileId, offset, length: bytes.length, runLength: 0 });
      leafParts.push(bytes);
      offset += bytes.length;
    }
    const rootBytes = serializeDirectory(rootEntries);
    if (rootBytes.length <= ROOT_BUDGET) return { root: rootBytes, leaves: Buffer.concat(leafParts) };
  }
}

function writeUint64(view: DataView, at: number, value: number): void {
  view.setBigUint64(at, BigInt(value), true);
}

/** Write a complete PMTiles v3 archive in memory. */
export function writePmtiles(tiles: readonly PmtilesTileInput[], options: PmtilesWriteOptions): Uint8Array {
  const sorted = tiles
    .map((t) => ({ tileId: zxyToTileId(t.z, t.x, t.y), data: t.data }))
    .sort((a, b) => a.tileId - b.tileId);
  const entries: Entry[] = [];
  const contents = new Map<string, { offset: number; length: number }>();
  const parts: Uint8Array[] = [];
  let dataLength = 0;
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    if (i > 0 && sorted[i - 1]!.tileId === t.tileId) throw new Error(`duplicate tile id ${t.tileId}`);
    const hash = createHash("sha256").update(t.data).digest("hex");
    let content = contents.get(hash);
    if (content === undefined) {
      content = { offset: dataLength, length: t.data.length };
      contents.set(hash, content);
      parts.push(t.data);
      dataLength += t.data.length;
    }
    const prev = entries[entries.length - 1];
    if (prev !== undefined && prev.offset === content.offset && prev.tileId + prev.runLength === t.tileId) {
      prev.runLength++;
    } else {
      entries.push({ tileId: t.tileId, offset: content.offset, length: content.length, runLength: 1 });
    }
  }

  const { root, leaves } = buildDirectories(entries);
  const metadata = gzipSync(Buffer.from(JSON.stringify(options.metadata), "utf8"));

  const rootOffset = HEADER_BYTES;
  const metadataOffset = rootOffset + root.length;
  const leafOffset = metadataOffset + metadata.length;
  const dataOffset = leafOffset + leaves.length;

  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);
  header.set(Buffer.from("PMTiles", "ascii"), 0);
  header[7] = 3;
  writeUint64(view, 8, rootOffset);
  writeUint64(view, 16, root.length);
  writeUint64(view, 24, metadataOffset);
  writeUint64(view, 32, metadata.length);
  writeUint64(view, 40, leafOffset);
  writeUint64(view, 48, leaves.length);
  writeUint64(view, 56, dataOffset);
  writeUint64(view, 64, dataLength);
  writeUint64(view, 72, sorted.length);
  writeUint64(view, 80, entries.length);
  writeUint64(view, 88, contents.size);
  header[96] = 1; // clustered
  header[97] = PmCompression.Gzip; // internal compression
  header[98] = options.tileCompression;
  header[99] = options.tileType;
  header[100] = options.minZoom;
  header[101] = options.maxZoom;
  const [minLon, minLat, maxLon, maxLat] = options.bounds;
  const e7 = (v: number): number => Math.round(v * 1e7);
  view.setInt32(102, e7(minLon), true);
  view.setInt32(106, e7(minLat), true);
  view.setInt32(110, e7(maxLon), true);
  view.setInt32(114, e7(maxLat), true);
  const center = options.center ?? [(minLon + maxLon) / 2, (minLat + maxLat) / 2, options.minZoom];
  header[118] = center[2];
  view.setInt32(119, e7(center[0]), true);
  view.setInt32(123, e7(center[1]), true);

  return Buffer.concat([header, root, metadata, leaves, ...parts]);
}
