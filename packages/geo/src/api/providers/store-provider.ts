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
  parseMeta,
  parseFeatureCollectionStream,
  validateFeatureCollectionStream,
} from "./collection-loader.js";
import type {
  CollectionInfo,
  FeatureProvider,
  ItemsQuery,
  ItemsResult,
  ItemsStream,
  ServedFeature,
} from "../provider.js";
import { geometryIntersectsBBox } from "../geo-util.js";
import type { ByteStream, Store } from "../../storage/index.js";

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
      const existing = map.get(entry.info.id);
      map.set(entry.info.id, existing ? selectServedEntry(existing, entry) : entry);
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
    };
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

  /**
   * Prefer the runtime store's bounded stream. The `get()` fallback exists only
   * for legacy in-memory test doubles; S3Store and FsStore always implement
   * `getStream`, so the served production path cannot materialize an object.
   */
  async #getStream(key: string): Promise<ByteStream | undefined> {
    try {
      if (this.#store.getStream) return await this.#store.getStream(key);
      const bytes = await this.#store.get(key);
      return bytes === undefined ? undefined : oneChunk(bytes);
    } catch {
      return undefined;
    }
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
    const stream = await this.streamItems(id, query);
    if (!stream) return undefined;
    const features: ServedFeature[] = [];
    let numberMatched = 0;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? Number.POSITIVE_INFINITY;
    for await (const feature of stream.features) {
      numberMatched++;
      if (numberMatched <= offset || features.length >= limit) continue;
      features.push(feature);
    }
    return { features, numberMatched, numberReturned: features.length };
  }

  async streamItems(
    id: string,
    query: Pick<ItemsQuery, "bbox">,
  ): Promise<ItemsStream | undefined> {
    const map = await this.#ensureIndexed();
    const entry = map.get(id);
    if (!entry) return undefined;
    try {
      // Validate the complete object before Hono commits a 200. A second
      // stream is deliberate: it preserves JSON.parse's all-or-nothing
      // contract without retaining the feature collection in memory.
      const validationSource = await this.#getStream(entry.geojsonKey);
      if (!validationSource) return undefined;
      await validateFeatureCollectionStream(validationSource);

      const source = await this.#getStream(entry.geojsonKey);
      if (!source) return undefined;
      return { features: matchingFeatures(parseFeatureCollectionStream(source), query.bbox) };
    } catch {
      return undefined;
    }
  }

  async getItem(id: string, featureId: string): Promise<ServedFeature | undefined> {
    const stream = await this.streamItems(id, {});
    if (!stream) return undefined;
    let index = 0;
    let matched: ServedFeature | undefined;
    for await (const feature of stream.features) {
      if (featureKey(feature, index) === featureId) matched = feature;
      index++;
    }
    return matched;
  }
}

async function* oneChunk(bytes: Uint8Array): ByteStream {
  yield bytes;
}

/** Apply the optional bbox without retaining the matching feature sequence. */
async function* matchingFeatures(
  source: AsyncIterable<ServedFeature>,
  bbox: ItemsQuery["bbox"],
): AsyncGenerator<ServedFeature> {
  for await (const feature of source) {
    if (!bbox || geometryIntersectsBBox(feature.geometry, bbox)) yield feature;
  }
}

/** A feature's stable id: GeoJSON `id`, then `properties.geoId`, then position. */
function featureKey(feature: ServedFeature, index: number): string {
  if (feature.id !== undefined && feature.id !== null) return String(feature.id);
  const geoId = feature.properties?.["geoId"];
  return typeof geoId === "string" ? geoId : String(index);
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
    ...(meta?.rights ? { rights: meta.rights } : {}),
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

type CollectionLayout = "flat" | "nested";

/** The nested layout is `<slug>/<slug>.geojson`; prefixes are not layouts. */
function collectionLayout(geojsonKey: string): CollectionLayout {
  const lastSlash = geojsonKey.lastIndexOf("/");
  if (lastSlash === -1) return "flat";
  const parentStart = geojsonKey.lastIndexOf("/", lastSlash - 1) + 1;
  const parent = geojsonKey.slice(parentStart, lastSlash);
  return parent === stemOf(geojsonKey) ? "nested" : "flat";
}

/**
 * Served-contract rule: when a collection exists in both layouts, use nested.
 * Equal layouts keep the prior sorted, last-key-wins behavior.
 */
function selectServedEntry(
  existing: StoreCollectionEntry,
  candidate: StoreCollectionEntry,
): StoreCollectionEntry {
  if (stemOf(existing.geojsonKey) !== stemOf(candidate.geojsonKey)) return candidate;
  const existingLayout = collectionLayout(existing.geojsonKey);
  const candidateLayout = collectionLayout(candidate.geojsonKey);
  if (existingLayout !== candidateLayout) {
    return candidateLayout === "nested" ? candidate : existing;
  }
  return candidate;
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
