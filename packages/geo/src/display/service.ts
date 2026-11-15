/**
 * Serving side of the display mirror (see `mirror.ts`).
 *
 * Freshness: the mirror records the source object's store identity (S3 ETag)
 * at build time. A request compares it with a HEAD of the source (cached a few
 * seconds), so no exact bytes are read to serve a fresh mirror.
 *   - no mirror yet (or another profile): build it now, then serve it;
 *   - mirror older than the source: serve it flagged stale, rebuild in the
 *     background — the next request gets the new version;
 *   - build failure: surfaced to the caller (503), never a silent fallback to
 *     the exact geometry. A source over the builder's budgets fails fast as
 *     `DisplayTooLargeError` (instead of OOM-killing the pod), and the refusal is
 *     replayed without rebuilding while the source ETag is unchanged.
 * Builds are single-flight per collection and serialized globally (one at a
 * time) to bound the pod's CPU and memory.
 */

import type { ByteStream, Store } from "../storage/index.js";

import {
  artifactKey,
  buildDisplayMirror,
  currentKey,
  DISPLAY_PROFILE,
  DisplayTooLargeError,
  parseManifest,
  type DisplayArtifact,
  type DisplayEncoding,
  type DisplayManifest,
} from "./mirror.js";

export interface DisplayResult {
  manifest: DisplayManifest;
  /** True when the source changed after this version was built (rebuild queued). */
  stale: boolean;
  encoding: DisplayEncoding;
  stream: ByteStream;
}

export interface DisplayServiceOptions {
  /** Reuse window of `current.json` and of the source HEAD (default 10 s). */
  cacheMs?: number;
  now?: () => number;
}

const decoder = new TextDecoder();

export class DisplayService {
  readonly #store: Store;
  readonly #cacheMs: number;
  readonly #now: () => number;
  readonly #manifests = new Map<string, { at: number; value: DisplayManifest | undefined }>();
  readonly #etags = new Map<string, { at: number; value: string | undefined }>();
  readonly #builds = new Map<string, Promise<DisplayManifest>>();
  /**
   * Builds refused as too large, per collection: the verdict is deterministic
   * for the source bytes, so it is replayed (503 at once, no rebuild) while the
   * source key and ETag are unchanged.
   */
  readonly #tooLarge = new Map<string, { sourceKey: string; error: DisplayTooLargeError }>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(store: Store, options: DisplayServiceOptions = {}) {
    this.#store = store;
    this.#cacheMs = options.cacheMs ?? 10_000;
    this.#now = options.now ?? Date.now;
  }

  async #manifest(collection: string): Promise<DisplayManifest | undefined> {
    const hit = this.#manifests.get(collection);
    if (hit && this.#now() - hit.at < this.#cacheMs) return hit.value;
    const bytes = await this.#store.get(currentKey(collection));
    const value = parseManifest(bytes === undefined ? undefined : decoder.decode(bytes));
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

  /** The recorded too-large refusal of this exact source, if any. */
  #tooLargeFor(collection: string, sourceKey: string, etag: string | undefined): DisplayTooLargeError | undefined {
    const refused = this.#tooLarge.get(collection);
    if (!refused || etag === undefined || etag === "") return undefined;
    return refused.sourceKey === sourceKey && refused.error.sourceEtag === etag ? refused.error : undefined;
  }

  /** Build (single-flight per collection, one build at a time overall). */
  build(collection: string, sourceKey: string): Promise<DisplayManifest> {
    const running = this.#builds.get(collection);
    if (running) return running;
    const run = this.#queue
      .catch(() => {})
      .then(() => buildDisplayMirror(this.#store, collection, sourceKey))
      .then(
        (manifest) => {
          this.#tooLarge.delete(collection);
          this.#manifests.set(collection, { at: this.#now(), value: manifest });
          this.#etags.set(sourceKey, { at: this.#now(), value: manifest.source_etag });
          return manifest;
        },
        (error: unknown) => {
          if (error instanceof DisplayTooLargeError) this.#tooLarge.set(collection, { sourceKey, error });
          throw error;
        },
      )
      .finally(() => this.#builds.delete(collection));
    this.#queue = run;
    this.#builds.set(collection, run);
    return run;
  }

  /**
   * Resolve the current display artifact of `collection` (exact source at
   * `sourceKey`), building or refreshing the mirror as needed.
   */
  async open(
    collection: string,
    sourceKey: string,
    artifact: DisplayArtifact,
    encoding: DisplayEncoding,
    signal?: AbortSignal,
  ): Promise<DisplayResult> {
    let manifest = await this.#manifest(collection);
    let stale = false;
    if (!manifest || manifest.profile !== DISPLAY_PROFILE || manifest.source_key !== sourceKey) {
      const refused = this.#tooLargeFor(collection, sourceKey, await this.#sourceEtag(sourceKey));
      if (refused) throw refused;
      manifest = await this.build(collection, sourceKey);
    } else {
      const etag = await this.#sourceEtag(sourceKey);
      if (etag !== undefined && etag !== manifest.source_etag) {
        stale = true;
        // Background refresh; a failure is logged and retried on a later request
        // (not when this very source was already refused as too large).
        if (!this.#tooLargeFor(collection, sourceKey, etag)) this.build(collection, sourceKey).catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.error(`[display] rebuild failed for ${collection}:`, error);
        });
      }
    }
    const key = artifactKey(collection, manifest.version, artifact, encoding);
    const stream = this.#store.getStream
      ? await this.#store.getStream(key, signal ? { signal } : undefined)
      : undefined;
    if (!stream) throw new Error(`display mirror object missing: ${key}`);
    return { manifest, stale, encoding, stream };
  }
}
