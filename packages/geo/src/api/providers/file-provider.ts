/**
 * File-backed {@link FeatureProvider}.
 *
 * Reads normalized datasets from a directory. The on-disk format mirrors what
 * `@sentropic/geo-acquire`'s `writeNormalized` emits: for each dataset a pair
 * of sibling files
 *
 *   - `<name>.geojson`      — an {@link AdminFeatureCollection} (WGS84 GeoJSON)
 *   - `<name>.meta.json`    — the {@link CollectionMeta} for that collection
 *
 * The collection id is the meta's `datasetId` when present, otherwise the
 * `<name>` stem of the file. Datasets are loaded lazily on first access and
 * cached. A missing or empty directory yields zero collections (not an error),
 * so the server boots cleanly before any data has been acquired.
 *
 * The geojson/meta parsing and the items/item query logic are shared with the
 * store-backed provider via `./collection-loader.js`; this module owns only the
 * directory listing and file reads.
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  buildLoadedCollection,
  parseMeta,
  queryItem,
  queryItems,
  type LoadedCollection,
} from "./collection-loader.js";
import type {
  CollectionInfo,
  FeatureProvider,
  ItemsQuery,
  ItemsResult,
  ServedFeature,
} from "../provider.js";

/** Default location of normalized datasets, relative to the repo root. */
export const DEFAULT_DATA_DIR = "data/normalized";

export class FileProvider implements FeatureProvider {
  readonly #dir: string;
  /** Resolves once the directory has been scanned and all datasets loaded. */
  #loaded: Promise<Map<string, LoadedCollection>> | undefined;

  constructor(dir: string = DEFAULT_DATA_DIR) {
    this.#dir = dir;
  }

  /** Force a re-scan of the directory on next access (e.g. after data refresh). */
  invalidate(): void {
    this.#loaded = undefined;
  }

  #ensureLoaded(): Promise<Map<string, LoadedCollection>> {
    if (!this.#loaded) this.#loaded = this.#load();
    return this.#loaded;
  }

  async #load(): Promise<Map<string, LoadedCollection>> {
    const map = new Map<string, LoadedCollection>();
    let entries: string[];
    try {
      // Recurse: `writeNormalized` namespaces datasets under <sourceSlug>/, e.g.
      // `ca-qc-sda/qc-municipalites.geojson` (see ADR-0005). Paths are relative to #dir.
      entries = await readdir(this.#dir, { recursive: true });
    } catch {
      // Missing/unreadable directory → zero collections.
      return map;
    }
    const geojsonFiles = entries
      .filter((name) => name.endsWith(".geojson"))
      .sort();
    for (const relPath of geojsonFiles) {
      const loaded = await this.#loadOne(relPath);
      if (loaded) map.set(loaded.info.id, loaded);
    }
    return map;
  }

  async #loadOne(relPath: string): Promise<LoadedCollection | undefined> {
    const stem = basename(relPath, ".geojson");
    const geojsonPath = join(this.#dir, relPath);
    const metaPath = `${geojsonPath.slice(0, -".geojson".length)}.meta.json`;

    const geojsonText = await readMaybe(geojsonPath);
    const metaText = await readMaybe(metaPath);
    return buildLoadedCollection(stem, geojsonText, parseMeta(metaText));
  }

  async listCollections(): Promise<CollectionInfo[]> {
    const map = await this.#ensureLoaded();
    return [...map.values()].map((c) => c.info);
  }

  async getCollection(id: string): Promise<CollectionInfo | undefined> {
    const map = await this.#ensureLoaded();
    return map.get(id)?.info;
  }

  async getItems(id: string, query: ItemsQuery): Promise<ItemsResult | undefined> {
    const map = await this.#ensureLoaded();
    return queryItems(map, id, query);
  }

  async getItem(id: string, featureId: string): Promise<ServedFeature | undefined> {
    const map = await this.#ensureLoaded();
    return queryItem(map, id, featureId);
  }
}

/** Read a file as UTF-8 text, returning `undefined` if it is missing/unreadable. */
async function readMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}
