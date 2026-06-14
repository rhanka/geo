/**
 * Store-backed {@link FeatureProvider}.
 *
 * Serves normalized datasets read from a {@link Store} (object storage via
 * `@sentropic/geo-storage`'s `S3Store`, or a local directory via `FsStore`)
 * rather than directly from the filesystem. Per ADR-0012 normalized data lives
 * on S3-compatible object storage (Scaleway, bucket `sentropic-geo`); this is
 * the API's read path against that bucket.
 *
 * The on-disk/key format is identical to {@link FileProvider}'s: for each
 * dataset a `<name>.geojson` key paired with an optional sibling
 * `<name>.meta.json` key. The collection id is the meta's `datasetId` when
 * present, else the `<name>` stem. Keys are listed under an optional `prefix`
 * (e.g. `normalized`), recursively — store keys are forward-slash paths, so a
 * source-namespaced key like `ca-qc-sda/qc-regions.geojson` is found by listing
 * the prefix. Datasets load lazily on first access and are cached;
 * {@link StoreProvider.invalidate} forces a re-list on next access.
 *
 * No network or live S3 connection is touched at construction — `list`/`get`
 * are only called on first request — so the module is import-safe.
 */

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
import type { Store } from "@sentropic/geo-storage";

const GEOJSON_SUFFIX = ".geojson";
const META_SUFFIX = ".meta.json";

const decoder = new TextDecoder();

export class StoreProvider implements FeatureProvider {
  readonly #store: Store;
  readonly #prefix: string;
  /** Resolves once keys have been listed and all datasets loaded. */
  #loaded: Promise<Map<string, LoadedCollection>> | undefined;

  /**
   * @param store  The key→bytes object store to read from.
   * @param prefix Optional key prefix to scope the listing (e.g. `normalized`).
   */
  constructor(store: Store, prefix = "") {
    this.#store = store;
    this.#prefix = prefix;
  }

  /** Force a re-list of the store on next access (e.g. after a data refresh). */
  invalidate(): void {
    this.#loaded = undefined;
  }

  #ensureLoaded(): Promise<Map<string, LoadedCollection>> {
    if (!this.#loaded) this.#loaded = this.#load();
    return this.#loaded;
  }

  async #load(): Promise<Map<string, LoadedCollection>> {
    const map = new Map<string, LoadedCollection>();
    let keys: string[];
    try {
      keys = await this.#store.list(this.#prefix);
    } catch {
      // Unreachable/empty store → zero collections (mirrors FileProvider).
      return map;
    }
    const geojsonKeys = keys.filter((k) => k.endsWith(GEOJSON_SUFFIX)).sort();
    for (const key of geojsonKeys) {
      const loaded = await this.#loadOne(key);
      if (loaded) map.set(loaded.info.id, loaded);
    }
    return map;
  }

  async #loadOne(geojsonKey: string): Promise<LoadedCollection | undefined> {
    const stem = stemOf(geojsonKey);
    const metaKey = `${geojsonKey.slice(0, -GEOJSON_SUFFIX.length)}${META_SUFFIX}`;

    const geojsonText = await this.#getText(geojsonKey);
    const metaText = await this.#getText(metaKey);
    return buildLoadedCollection(stem, geojsonText, parseMeta(metaText));
  }

  /** Read a key as UTF-8 text, returning `undefined` if absent/unreadable. */
  async #getText(key: string): Promise<string | undefined> {
    let bytes: Uint8Array | undefined;
    try {
      bytes = await this.#store.get(key);
    } catch {
      return undefined;
    }
    return bytes === undefined ? undefined : decoder.decode(bytes);
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

/** The `<name>` stem of a `.geojson` store key (basename without suffix). */
function stemOf(geojsonKey: string): string {
  const slash = geojsonKey.lastIndexOf("/");
  const base = slash === -1 ? geojsonKey : geojsonKey.slice(slash + 1);
  return base.slice(0, -GEOJSON_SUFFIX.length);
}
