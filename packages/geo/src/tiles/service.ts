/**
 * Serving side of the tile archives (SPEC_VECTOR_TILES.md § Serving).
 *
 * Reads the archive published under `_tiles/<id>/<version>/` by byte ranges
 * (`Store.getRange`): header + root directory once per version (cached), leaf
 * directories through a byte-bounded LRU, and one range per tile. The archive
 * is never loaded whole. The serving pod never builds tiles: a collection
 * without a published archive is answered 404 by the route.
 *
 * Freshness, like the display mirror: `current.json` and the source HEAD are
 * cached a few seconds; a source whose ETag changed after the version was
 * built is still served, flagged stale (the publication hook or the prewarm
 * sweep rebuilds it).
 */

import type { Store } from "../storage/index.js";

import { parseTilesManifest, tilesArchiveKey, tilesCurrentKey, type TilesManifest } from "./archive.js";
import {
  ByteLru,
  directoryBytes,
  readHeaderAndRoot,
  readTile,
  type HeaderAndRoot,
  type PmDirectory,
  type RangeRead,
} from "./pmtiles-reader.js";

export interface TileServiceOptions {
  /** Reuse window of `current.json` and of the source HEAD (default 10 s). */
  cacheMs?: number;
  now?: () => number;
  /** Budget of cached headers + root directories (default 8 MiB). */
  headerCacheBytes?: number;
  /** Budget of cached leaf directories (default 16 MiB). */
  leafCacheBytes?: number;
}

export interface OpenTiles {
  manifest: TilesManifest;
  /** The source changed (or is served from another key) since this version was built. */
  stale: boolean;
}

export interface TileBytes {
  /** Tile bytes as stored. */
  data: Uint8Array;
  /** PMTiles compression code of `data` (2 = gzip, 1 = none). */
  compression: number;
}

const decoder = new TextDecoder();

export class TileService {
  readonly #store: Store;
  readonly #cacheMs: number;
  readonly #now: () => number;
  readonly #manifests = new Map<string, { at: number; value: TilesManifest | undefined }>();
  readonly #etags = new Map<string, { at: number; value: string | undefined }>();
  readonly #headers: ByteLru<HeaderAndRoot>;
  readonly #headerLoads = new Map<string, Promise<HeaderAndRoot>>();
  readonly #leaves: ByteLru<PmDirectory>;

  constructor(store: Store, options: TileServiceOptions = {}) {
    this.#store = store;
    this.#cacheMs = options.cacheMs ?? 10_000;
    this.#now = options.now ?? Date.now;
    this.#headers = new ByteLru(options.headerCacheBytes ?? 8 * 2 ** 20, (hr) => directoryBytes(hr.root) + 256);
    this.#leaves = new ByteLru(options.leafCacheBytes ?? 16 * 2 ** 20, directoryBytes);
  }

  async #manifest(collection: string): Promise<TilesManifest | undefined> {
    const hit = this.#manifests.get(collection);
    if (hit && this.#now() - hit.at < this.#cacheMs) return hit.value;
    const bytes = await this.#store.get(tilesCurrentKey(collection));
    const value = parseTilesManifest(bytes === undefined ? undefined : decoder.decode(bytes));
    this.#manifests.set(collection, { at: this.#now(), value });
    return value;
  }

  async #sourceEtag(sourceKey: string): Promise<string | undefined> {
    const hit = this.#etags.get(sourceKey);
    if (hit && this.#now() - hit.at < this.#cacheMs) return hit.value;
    const value = (await this.#store.stat?.(sourceKey))?.etag;
    this.#etags.set(sourceKey, { at: this.#now(), value });
    return value;
  }

  /** The published archive of `collection` (exact source at `sourceKey`), or `undefined` when none is. */
  async open(collection: string, sourceKey: string): Promise<OpenTiles | undefined> {
    const manifest = await this.#manifest(collection);
    if (!manifest) return undefined;
    let stale = manifest.source_key !== sourceKey;
    if (!stale) {
      const etag = await this.#sourceEtag(sourceKey);
      stale = etag !== undefined && etag !== manifest.source_etag;
    }
    return { manifest, stale };
  }

  #reader(key: string, signal?: AbortSignal): RangeRead {
    const store = this.#store;
    if (!store.getRange) throw new Error("tiles: store cannot read byte ranges");
    return async (offset, length) => {
      const bytes = await store.getRange!(key, offset, length, signal ? { signal } : undefined);
      if (bytes === undefined) throw new Error(`tiles: archive missing: ${key}`);
      return bytes;
    };
  }

  /** Header + root directory of one archive version: read once, cached (single-flight). */
  async #headerAndRoot(key: string): Promise<HeaderAndRoot> {
    const hit = this.#headers.get(key);
    if (hit) return hit;
    let load = this.#headerLoads.get(key);
    if (!load) {
      // Shared by concurrent requests: no request signal (one client leaving
      // must not fail the others).
      load = readHeaderAndRoot(this.#reader(key)).then(
        (hr) => {
          this.#headers.set(key, hr);
          return hr;
        },
      ).finally(() => this.#headerLoads.delete(key));
      this.#headerLoads.set(key, load);
    }
    return load;
  }

  /** Tile z/x/y of `collection` at `manifest.version`, or `undefined` when the archive has none. */
  async tile(
    collection: string,
    manifest: TilesManifest,
    z: number,
    x: number,
    y: number,
    signal?: AbortSignal,
  ): Promise<TileBytes | undefined> {
    const key = tilesArchiveKey(collection, manifest.version);
    const hr = await this.#headerAndRoot(key);
    const data = await readTile(this.#reader(key, signal), hr, z, x, y, { cache: this.#leaves, key });
    return data === undefined ? undefined : { data, compression: hr.header.tileCompression };
  }
}
