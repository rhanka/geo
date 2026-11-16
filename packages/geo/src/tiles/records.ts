/**
 * Compact index of the tiles built into a spool (SPEC_VECTOR_TILES.md § Scale).
 *
 * A layer may produce millions of tiles (a polygon covering a region is one
 * full-square tile per z15 tile it covers), most of them identical. Tiles are
 * therefore stored as 13 bytes each (z, x, y, content id) in typed arrays, and
 * their distinct contents once: the spool holds each distinct gzip once, and a
 * tile whose MVT bytes were already built reuses that content without being
 * compressed again (gzip is deterministic: same MVT, same gzip bytes).
 */

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { Growable } from "./flat.js";
import { tileHash } from "./pmtiles.js";
import type { TileSpool } from "./spool.js";

/** One encoded tile in a spool. */
export interface TileRecord {
  z: number;
  x: number;
  y: number;
  /** Offset and length of the gzip bytes in the spool. */
  offset: number;
  length: number;
  /** Uncompressed MVT bytes. */
  bytes: number;
  /** sha256 of the gzip bytes (archive deduplication). */
  hash: string;
}

/** Distinct tile contents of a build: spool range, sizes and gzip hash. */
export class TileContents {
  readonly #spool: TileSpool;
  readonly #gzipLevel: number;
  /** sha256 (base64) of the MVT bytes → content id. */
  readonly #byRaw = new Map<string, number>();
  readonly offset = new Growable(Float64Array, 2 ** 26);
  readonly length = new Growable(Uint32Array, 2 ** 26);
  readonly bytes = new Growable(Uint32Array, 2 ** 26);
  readonly hash: string[] = [];

  constructor(spool: TileSpool, gzipLevel: number) {
    this.#spool = spool;
    this.#gzipLevel = gzipLevel;
  }

  get count(): number {
    return this.hash.length;
  }

  /** Content id of these MVT bytes: compressed and spooled the first time only. */
  add(raw: Uint8Array): number {
    const key = createHash("sha256").update(raw).digest("base64");
    let id = this.#byRaw.get(key);
    if (id !== undefined) return id;
    const gz = gzipSync(raw, { level: this.#gzipLevel });
    id = this.hash.length;
    this.#byRaw.set(key, id);
    this.offset.push(this.#spool.append(gz));
    this.length.push(gz.length);
    this.bytes.push(raw.length);
    this.hash.push(tileHash(gz));
    return id;
  }
}

/** The tiles of a build, in build order, over their {@link TileContents}. */
export class TileRecords implements Iterable<TileRecord> {
  readonly contents: TileContents;
  readonly #z = new Growable(Uint8Array, 2 ** 26);
  readonly #x = new Growable(Uint32Array, 2 ** 26);
  readonly #y = new Growable(Uint32Array, 2 ** 26);
  readonly #content = new Growable(Uint32Array, 2 ** 26);

  constructor(contents: TileContents) {
    this.contents = contents;
  }

  get length(): number {
    return this.#z.length;
  }

  push(z: number, x: number, y: number, content: number): void {
    this.#z.push(z);
    this.#x.push(x);
    this.#y.push(y);
    this.#content.push(content);
  }

  /** Point record i at another content (a re-encoded tile). */
  setContent(i: number, content: number): void {
    this.#content.set(i, content);
  }

  z(i: number): number {
    return this.#z.get(i);
  }

  x(i: number): number {
    return this.#x.get(i);
  }

  y(i: number): number {
    return this.#y.get(i);
  }

  content(i: number): number {
    return this.#content.get(i);
  }

  get(i: number): TileRecord {
    const c = this.#content.get(i);
    return {
      z: this.#z.get(i),
      x: this.#x.get(i),
      y: this.#y.get(i),
      offset: this.contents.offset.get(c),
      length: this.contents.length.get(c),
      bytes: this.contents.bytes.get(c),
      hash: this.contents.hash[c]!,
    };
  }

  *[Symbol.iterator](): Iterator<TileRecord> {
    for (let i = 0; i < this.length; i++) yield this.get(i);
  }
}
