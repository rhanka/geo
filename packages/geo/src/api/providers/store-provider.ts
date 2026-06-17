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
 * the prefix.
 *
 * Unlike the file provider, the store provider indexes collection metadata
 * first and loads GeoJSON bodies only when a collection's items are requested.
 * This keeps `/collections` and `/collections/:id` OOM-safe when the bucket
 * contains large lot shards such as `qc-lots-*`.
 *
 * No network or live S3 connection is touched at construction — `list`/`get`
 * are only called on first request — so the module is import-safe.
 */

import { resolveLicense, type CollectionMeta, type License } from "@sentropic/geo-core";

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
import type { Store } from "../../storage/index.js";

const GEOJSON_SUFFIX = ".geojson";
const META_SUFFIX = ".meta.json";
const DEFAULT_CRS = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
const INDEX_CONCURRENCY = 32;

const decoder = new TextDecoder();

interface StoreCollectionEntry {
  /** Store key of the normalized GeoJSON payload. */
  geojsonKey: string;
  /** Parsed metadata, when a valid sibling `.meta.json` exists. */
  meta: CollectionMeta | undefined;
  /** Lightweight collection info built without parsing the GeoJSON body. */
  info: CollectionInfo;
  /** Lazy, cached full materialization. */
  loaded: Promise<LoadedCollection | undefined> | undefined;
}

export class StoreProvider implements FeatureProvider {
  readonly #store: Store;
  readonly #prefix: string;
  /** Resolves once keys have been listed and collection metadata indexed. */
  #indexed: Promise<Map<string, StoreCollectionEntry>> | undefined;

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
    this.#indexed = undefined;
  }

  #ensureIndexed(): Promise<Map<string, StoreCollectionEntry>> {
    if (!this.#indexed) this.#indexed = this.#index();
    return this.#indexed;
  }

  async #index(): Promise<Map<string, StoreCollectionEntry>> {
    const map = new Map<string, StoreCollectionEntry>();
    let keys: string[];
    try {
      keys = await this.#store.list(this.#prefix);
    } catch {
      // Unreachable/empty store → zero collections (mirrors FileProvider).
      return map;
    }

    const geojsonKeys = keys.filter((k) => k.endsWith(GEOJSON_SUFFIX)).sort();
    const keySet = new Set(keys);
    const entries = await mapLimit(geojsonKeys, INDEX_CONCURRENCY, (geojsonKey) =>
      this.#indexOne(geojsonKey, keySet),
    );
    for (const entry of entries) {
      map.set(entry.info.id, entry);
    }
    return map;
  }

  async #indexOne(
    geojsonKey: string,
    keys: ReadonlySet<string>,
  ): Promise<StoreCollectionEntry> {
    const stem = stemOf(geojsonKey);
    const metaKey = `${geojsonKey.slice(0, -GEOJSON_SUFFIX.length)}${META_SUFFIX}`;
    const meta = keys.has(metaKey) ? parseMeta(await this.#getText(metaKey)) : undefined;
    return {
      geojsonKey,
      meta,
      info: buildCollectionInfo(stem, meta),
      loaded: undefined,
    };
  }

  async #load(entry: StoreCollectionEntry): Promise<LoadedCollection | undefined> {
    if (!entry.loaded) {
      entry.loaded = this.#loadEntry(entry);
    }
    return entry.loaded;
  }

  async #loadEntry(entry: StoreCollectionEntry): Promise<LoadedCollection | undefined> {
    const geojsonText = await this.#getText(entry.geojsonKey);
    return buildLoadedCollection(stemOf(entry.geojsonKey), geojsonText, entry.meta);
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
    const map = await this.#ensureIndexed();
    return [...map.values()].map((entry) => entry.info);
  }

  async getCollection(id: string): Promise<CollectionInfo | undefined> {
    const map = await this.#ensureIndexed();
    return map.get(id)?.info;
  }

  async getItems(id: string, query: ItemsQuery): Promise<ItemsResult | undefined> {
    const map = await this.#ensureIndexed();
    const entry = map.get(id);
    if (!entry) return undefined;
    const loaded = await this.#load(entry);
    return loaded ? queryItems(new Map([[loaded.info.id, loaded]]), loaded.info.id, query) : undefined;
  }

  async getItem(id: string, featureId: string): Promise<ServedFeature | undefined> {
    const map = await this.#ensureIndexed();
    const entry = map.get(id);
    if (!entry) return undefined;
    const loaded = await this.#load(entry);
    return loaded ? queryItem(new Map([[loaded.info.id, loaded]]), loaded.info.id, featureId) : undefined;
  }
}

/** Build collection metadata without parsing the potentially-large GeoJSON body. */
function buildCollectionInfo(stem: string, meta: CollectionMeta | undefined): CollectionInfo {
  const id = meta?.datasetId ?? stem;
  const license: License = resolveLicense(meta?.license);
  return {
    id,
    title: meta?.title ?? id,
    license,
    attribution: meta?.attribution ?? license.title,
    crs: meta?.crs ?? DEFAULT_CRS,
    count: meta?.count ?? 0,
  };
}

/** The `<name>` stem of a `.geojson` store key (basename without suffix). */
function stemOf(geojsonKey: string): string {
  const slash = geojsonKey.lastIndexOf("/");
  const base = slash === -1 ? geojsonKey : geojsonKey.slice(slash + 1);
  return base.slice(0, -GEOJSON_SUFFIX.length);
}

async function mapLimit<T, U>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
