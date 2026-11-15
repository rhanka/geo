/**
 * Where encoded tiles wait until the archive is assembled (SPEC_VECTOR_TILES.md
 * § Scale): a temporary file for publication (the tiles of a big city never sit
 * in memory), or memory for tests and small in-process builds.
 */

import { closeSync, openSync, readSync, writeSync } from "node:fs";

export interface TileSpool {
  /** Store `bytes`; returns their offset. */
  append(bytes: Uint8Array): number;
  /** Bytes previously appended at `offset`. */
  read(offset: number, length: number): Uint8Array;
}

export class MemorySpool implements TileSpool {
  readonly #chunks = new Map<number, Uint8Array>();
  #size = 0;

  append(bytes: Uint8Array): number {
    const offset = this.#size;
    this.#chunks.set(offset, bytes);
    this.#size += bytes.length;
    return offset;
  }

  read(offset: number, length: number): Uint8Array {
    const chunk = this.#chunks.get(offset);
    if (!chunk || chunk.length !== length) throw new Error(`spool: no chunk of ${length} bytes at ${offset}`);
    return chunk;
  }
}

/** Append-only file spool; `close()` releases the descriptor (the caller deletes the file). */
export class FileSpool implements TileSpool {
  readonly #fd: number;
  #size = 0;

  constructor(path: string) {
    this.#fd = openSync(path, "w+");
  }

  get size(): number {
    return this.#size;
  }

  append(bytes: Uint8Array): number {
    const offset = this.#size;
    let written = 0;
    while (written < bytes.length) written += writeSync(this.#fd, bytes, written, bytes.length - written, offset + written);
    this.#size += bytes.length;
    return offset;
  }

  read(offset: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    let read = 0;
    while (read < length) {
      const n = readSync(this.#fd, out, read, length - read, offset + read);
      if (n === 0) throw new Error(`spool: short read at ${offset + read}`);
      read += n;
    }
    return out;
  }

  close(): void {
    closeSync(this.#fd);
  }
}
