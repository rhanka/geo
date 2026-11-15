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
 * Items requests validate the whole source before answering 200. With a store
 * that exposes an object identity (`stat`, S3 ETag), the verdict and the
 * Feature count are cached per identity: a large source is scanned in full
 * once per version (shared by concurrent requests, not cancelled when a client
 * leaves), and an unfiltered page then reads only `offset + limit` Features.
 *
 * Both passes enforce a per-Feature byte cap (`GEO_MAX_FEATURE_BYTES`, default
 * 16 MiB) on the raw bytes, so an oversized Feature never reaches `JSON.parse`
 * in the serving pod: the request fails with {@link FeatureTooLargeError}
 * (HTTP 503 `FeatureTooLarge`) and that verdict is cached per key and ETag.
 *
 * No network or live S3 connection is touched at construction — `list`/`get`
 * are only called on first request — so the module is import-safe.
 */

import { resolveLicense, type CollectionMeta, type License } from "@sentropic/geo-core";

import {
  FeatureTooLargeError,
  parseMeta,
  parseFeatureCollectionStream,
  resolveServingMaxFeatureBytes,
  validateFeatureCollectionStream,
} from "./collection-loader.js";
import type {
  CoherenceInfo,
  CollectionInfo,
  FeatureProvider,
  ItemsQuery,
  ItemsResult,
  ItemsStream,
  ServedFeature,
  TilesLookup,
} from "../provider.js";
import { geometryIntersectsBBox } from "../geo-util.js";
import { profileForCollection } from "../../tiles/profiles.js";
import { TileService, type TileServiceOptions } from "../../tiles/service.js";
import type { DisplayArtifact, DisplayEncoding } from "../../display/mirror.js";
import {
  DisplayService,
  type DisplayResult,
  type DisplayServiceOptions,
} from "../../display/service.js";
import {
  isCanonicalGeojsonKey,
  preferServedKey,
  servedCollectionId,
  stemOf,
  type ByteStream,
  type Store,
} from "../../storage/index.js";

const GEOJSON_SUFFIX = ".geojson";
const META_SUFFIX = ".meta.json";
/** Dataset-level freshness manifest at the data root (§4.1). Store key is
 * relative to the store's prefix, i.e. `<GEO_DATA_URI>/coherence.json`. */
const COHERENCE_KEY = "coherence.json";
const DEFAULT_CRS = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
const INDEX_CONCURRENCY = 32;

const decoder = new TextDecoder();

/**
 * A source verdict at one store identity: valid with its Feature count, or
 * refused because one Feature exceeds the serving cap. Both are deterministic
 * for a given ETag, so both are cached; a read error or invalid bytes are not.
 */
type SourceVerdict =
  | { etag: string; features: number; tooLarge?: undefined }
  | { etag: string; tooLarge: FeatureTooLargeError };

export interface StoreProviderOptions {
  display?: DisplayServiceOptions;
  tiles?: TileServiceOptions;
  /**
   * Largest JSON text of one served Feature, enforced on the raw bytes of the
   * items/getItem validation and served passes BEFORE `JSON.parse`. Past it the
   * request fails with {@link FeatureTooLargeError} (HTTP 503 `FeatureTooLarge`)
   * instead of OOM-killing the pod. Default: `GEO_MAX_FEATURE_BYTES`, else
   * {@link SERVING_MAX_FEATURE_BYTES} (see `resolveServingMaxFeatureBytes`).
   */
  maxFeatureBytes?: number;
}

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
  /** Dataset-level coherence manifest (freshness + completeness), set by {@link #index}. */
  #coherence: CoherenceInfo | undefined;
  /** Display mirror (built lazily, keyed by collection id). */
  #display: DisplayService | undefined;
  /**
   * Validation verdicts by GeoJSON key, valid while the source ETag is
   * unchanged: a validated source is not re-read before each items response.
   */
  readonly #verdicts = new Map<string, SourceVerdict>();
  /** In-flight validations by GeoJSON key (single-flight per key and ETag). */
  readonly #validations = new Map<string, { etag: string; run: Promise<number> }>();

  /**
   * @param store  The key→bytes object store to read from.
   * @param prefix Optional key prefix to scope the listing (e.g. `normalized`).
   */
  readonly #displayOptions: DisplayServiceOptions;
  /** Vector tiles (published archives, ranged reads; never built here). */
  #tiles: TileService | undefined;
  readonly #tilesOptions: TileServiceOptions;
  /** Per-Feature byte cap of the serving path (see {@link StoreProviderOptions}). */
  readonly #maxFeatureBytes: number;

  constructor(store: Store, prefix = "", options: StoreProviderOptions = {}) {
    this.#store = store;
    this.#prefix = prefix;
    this.#displayOptions = options.display ?? {};
    this.#tilesOptions = options.tiles ?? {};
    this.#maxFeatureBytes =
      options.maxFeatureBytes ?? resolveServingMaxFeatureBytes(process.env["GEO_MAX_FEATURE_BYTES"]);
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
    // Reset first so an unreachable store yields undefined coherence, matching
    // its zero-collection result (no stale watermark survives a failed refresh).
    this.#coherence = undefined;
    const map = new Map<string, StoreCollectionEntry>();
    let keys: string[];
    try {
      keys = await this.#store.list(this.#prefix);
    } catch {
      // Unreachable/empty store → zero collections (mirrors FileProvider).
      return map;
    }

    // Read the dataset-level manifest once, before building infos, so every
    // collection carries the same watermark (§4.1). Absent → undefined.
    this.#coherence = parseCoherence(await this.#getText(COHERENCE_KEY));

    // Index-discipline (ADR-0027) : n'indexe QUE les clés canoniques servies —
    // jamais les backups/prebackups/sidecars qu'un `list()` récursif remonte.
    // Filtre sur la CLÉ BRUTE, avant toute dérivation `datasetId` (rejet par chemin).
    const geojsonKeys = keys.filter(isCanonicalGeojsonKey).sort();
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
      info: buildCollectionInfo(stem, meta, this.#coherence?.coherenceId),
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
  async #getStream(key: string, signal?: AbortSignal): Promise<ByteStream | undefined> {
    try {
      return await this.#openStream(key, signal);
    } catch {
      return undefined;
    }
  }

  /** {@link #getStream} without error swallowing; `signal` cancels the S3 read. */
  async #openStream(key: string, signal?: AbortSignal): Promise<ByteStream | undefined> {
    if (this.#store.getStream) return this.#store.getStream(key, signal ? { signal } : undefined);
    const bytes = await this.#store.get(key);
    return bytes === undefined ? undefined : oneChunk(bytes);
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
    let pulled = 0;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? Number.POSITIVE_INFINITY;
    // A known total lets the page stop early, exactly like the HTTP stream.
    const total = stream.numberMatched;
    const stopAt = total === undefined ? Infinity : offset >= total ? 0 : Math.min(total, offset + limit);
    if (pulled < stopAt) {
      for await (const feature of stream.features) {
        pulled++;
        if (pulled > offset && features.length < limit) features.push(feature);
        if (pulled >= stopAt) break;
      }
    }
    return { features, numberMatched: stream.numberMatched ?? pulled, numberReturned: features.length };
  }

  async streamItems(
    id: string,
    query: Pick<ItemsQuery, "bbox">,
    signal?: AbortSignal,
  ): Promise<ItemsStream | undefined> {
    const map = await this.#ensureIndexed();
    const entry = map.get(id);
    if (!entry) return undefined;
    const limits = { maxFeatureBytes: this.#maxFeatureBytes };
    try {
      // Validate the complete object before Hono commits a 200 (JSON.parse's
      // all-or-nothing contract, without retaining the feature collection).
      // When the store exposes a stable identity (S3 ETag), the verdict and the
      // Feature count are cached per identity, so a large source is read in
      // full once per version instead of twice per request.
      const etag = await this.#sourceEtag(entry.geojsonKey);
      let total: number | undefined;
      if (etag === undefined) {
        // No identity to cache against: validate on every request. `signal`
        // (the HTTP request's) releases the S3 read as soon as the client leaves.
        const validationSource = await this.#getStream(entry.geojsonKey, signal);
        if (!validationSource) return undefined;
        await validateFeatureCollectionStream(validationSource, limits);
      } else {
        total = await untilAborted(this.#validatedCount(entry.geojsonKey, etag), signal);
      }

      // The served pass opens its S3 body only on the first pull: a response
      // that is never written (client gone during validation) then holds no
      // pooled socket at all. It keeps the cap too (the object may have been
      // replaced between the two passes).
      return {
        features: matchingFeatures(
          parseFeatureCollectionStream(this.#lazyStream(entry.geojsonKey, signal), limits),
          query.bbox,
        ),
        // Only an unfiltered query matches the whole validated collection.
        ...(total !== undefined && !query.bbox ? { numberMatched: total } : {}),
      };
    } catch (error) {
      // An oversized Feature is a known, deterministic refusal: surface it so
      // the API answers 503 `FeatureTooLarge` rather than 404 "unknown collection".
      if (error instanceof FeatureTooLargeError) throw error;
      return undefined;
    }
  }

  /** The source's store identity, or `undefined` when the store cannot tell. */
  async #sourceEtag(key: string): Promise<string | undefined> {
    if (!this.#store.stat) return undefined;
    try {
      const etag = (await this.#store.stat(key))?.etag;
      return etag ? etag : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Feature count of a valid source at identity `etag`, validating it once.
   * The validation is shared by concurrent requests and deliberately NOT tied
   * to any request's signal: a client (or an ingress timeout) leaving during
   * the scan of a large cold source must not throw the scan away, otherwise a
   * source slower than the ingress timeout could never be served. It runs at
   * most once per key and ETag at a time; the S3 body guards bound its socket.
   * A failure (invalid bytes, read error) is not cached: the next request retries.
   * A Feature over the serving cap IS cached (it cannot change at this ETag):
   * the scan stops at that Feature, and later requests are refused at once
   * without re-reading the object.
   */
  #validatedCount(key: string, etag: string): Promise<number> {
    const known = this.#verdicts.get(key);
    if (known?.etag === etag) {
      return known.tooLarge ? Promise.reject(known.tooLarge) : Promise.resolve(known.features);
    }
    const running = this.#validations.get(key);
    if (running?.etag === etag) return running.run;

    const run = (async () => {
      const source = await this.#openStream(key);
      if (!source) throw new Error(`object missing: ${key}`);
      let features: number;
      try {
        ({ features } = await validateFeatureCollectionStream(source, {
          maxFeatureBytes: this.#maxFeatureBytes,
        }));
      } catch (error) {
        if (error instanceof FeatureTooLargeError) this.#verdicts.set(key, { etag, tooLarge: error });
        throw error;
      }
      // ETag read before the scan: if the object was replaced meanwhile, the
      // next request sees a new ETag and validates again.
      this.#verdicts.set(key, { etag, features });
      return features;
    })();
    // Observed by every awaiting request; never an unhandled rejection when all left.
    run.catch(() => {});
    const slot = { etag, run };
    this.#validations.set(key, slot);
    void run.finally(() => {
      if (this.#validations.get(key) === slot) this.#validations.delete(key);
    }).catch(() => {});
    return run;
  }

  async *#lazyStream(key: string, signal?: AbortSignal): ByteStream {
    if (signal?.aborted) return;
    const source = await this.#getStream(key, signal);
    if (!source) throw new Error(`object vanished after validation: ${key}`);
    yield* source;
  }

  /**
   * Liveness of the read path: open the first indexed collection's GeoJSON and
   * read its first chunk, then release it. Resolves with the probed collection
   * id; rejects when nothing is indexed or the object cannot be read. `signal`
   * cancels the S3 read (request or open body) so a timed-out probe releases
   * its socket at once.
   */
  async checkHealth(signal?: AbortSignal): Promise<{ collection: string }> {
    const map = await this.#ensureIndexed();
    const first = map.values().next();
    if (first.done) throw new Error("no collection indexed");
    const entry = first.value;
    const stream = await this.#openStream(entry.geojsonKey, signal);
    if (!stream) throw new Error(`shape unreadable: ${entry.info.id}`);
    const iterator = stream[Symbol.asyncIterator]();
    try {
      const chunk = await iterator.next();
      if (chunk.done || chunk.value.byteLength === 0) throw new Error(`shape empty: ${entry.info.id}`);
    } finally {
      await iterator.return?.();
    }
    return { collection: entry.info.id };
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

  async openDisplay(
    id: string,
    artifact: DisplayArtifact,
    encoding: DisplayEncoding,
    signal?: AbortSignal,
  ): Promise<DisplayResult | undefined> {
    const map = await this.#ensureIndexed();
    const entry = map.get(id);
    if (!entry) return undefined;
    this.#display ??= new DisplayService(this.#store, this.#displayOptions);
    return this.#display.open(id, entry.geojsonKey, artifact, encoding, signal);
  }

  async openTiles(id: string): Promise<TilesLookup> {
    const map = await this.#ensureIndexed();
    const entry = map.get(id);
    if (!entry) return { kind: "unknown-collection" };
    if (!profileForCollection(id)) return { kind: "not-tiled" };
    const service = (this.#tiles ??= new TileService(this.#store, this.#tilesOptions));
    const opened = await service.open(id, entry.geojsonKey);
    if (!opened) return { kind: "no-archive" };
    return {
      kind: "ok",
      manifest: opened.manifest,
      stale: opened.stale,
      tile: (z, x, y, signal) => service.tile(id, opened.manifest, z, x, y, signal),
    };
  }

  /** Dataset-level coherence manifest, or `undefined` when no manifest exists. */
  async getCoherence(): Promise<CoherenceInfo | undefined> {
    await this.#ensureIndexed();
    return this.#coherence;
  }
}

async function* oneChunk(bytes: Uint8Array): ByteStream {
  yield bytes;
}

/**
 * Await a shared `work` for one request: rejects as soon as `signal` aborts,
 * without cancelling `work` itself (other requests, and the cached verdict,
 * still get its result).
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
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
function buildCollectionInfo(
  stem: string,
  meta: CollectionMeta | undefined,
  coherenceId: string | undefined,
): CollectionInfo {
  // Served id = the ONE shared rule (datasetId ?? stem) — same as the sync stamp.
  const id = servedCollectionId(stem, meta?.datasetId);
  const license: License = resolveLicense(meta?.license);
  return {
    id,
    title: meta?.title ?? id,
    license,
    attribution: meta?.attribution ?? license.title,
    ...(meta?.rights ? { rights: meta.rights } : {}),
    crs: meta?.crs ?? DEFAULT_CRS,
    count: meta?.count ?? 0,
    ...(coherenceId !== undefined ? { coherenceId } : {}),
  };
}

/**
 * Extract the dataset-level manifest from a `coherence.json` body
 * (`{ coherence_id, served_count, generated_at, prod_watermark }`, §4.1/§7 A5).
 * Each field is taken only when well-typed; a malformed/absent body yields
 * `undefined`, and a bad field is dropped — so the served value is omitted and a
 * consumer's freshness/completeness gate fails closed rather than passing blind.
 */
function parseCoherence(text: string | undefined): CoherenceInfo | undefined {
  if (text === undefined) return undefined;
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof obj !== "object" || obj === null) return undefined;
  const raw = obj as { coherence_id?: unknown; served_count?: unknown; set_hash?: unknown };
  const info: CoherenceInfo = {};
  if (typeof raw.coherence_id === "string" && raw.coherence_id.length > 0) {
    info.coherenceId = raw.coherence_id;
  }
  if (typeof raw.served_count === "number" && Number.isInteger(raw.served_count) && raw.served_count >= 0) {
    info.servedCount = raw.served_count;
  }
  if (typeof raw.set_hash === "string" && raw.set_hash.length > 0) {
    info.setHash = raw.set_hash;
  }
  return info.coherenceId === undefined && info.servedCount === undefined && info.setHash === undefined
    ? undefined
    : info;
}

/**
 * Served-contract rule ({@link preferServedKey}, shared with the display-mirror
 * publication): when a collection exists in both layouts, use nested. Equal
 * layouts keep the prior sorted, last-key-wins behavior.
 */
function selectServedEntry(
  existing: StoreCollectionEntry,
  candidate: StoreCollectionEntry,
): StoreCollectionEntry {
  return preferServedKey(existing.geojsonKey, candidate.geojsonKey) === candidate.geojsonKey
    ? candidate
    : existing;
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
