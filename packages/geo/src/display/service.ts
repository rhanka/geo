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
 *     the exact geometry.
 * Builds are single-flight per collection and serialized globally (one at a
 * time) to bound the pod's CPU and memory.
 */

import type { ByteStream, Store } from "../storage/index.js";

import {
  artifactKey,
  buildDisplayMirror,
  currentKey,
  DISPLAY_PROFILE,
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

  /** Build (single-flight per collection, one build at a time overall). */
  build(collection: string, sourceKey: string): Promise<DisplayManifest> {
    const running = this.#builds.get(collection);
    if (running) return running;
    const run = this.#queue
      .catch(() => {})
      .then(() => buildDisplayMirror(this.#store, collection, sourceKey))
      .then((manifest) => {
        this.#manifests.set(collection, { at: this.#now(), value: manifest });
        this.#etags.set(sourceKey, { at: this.#now(), value: manifest.source_etag });
        return manifest;
      })
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
      manifest = await this.build(collection, sourceKey);
    } else {
      const etag = await this.#sourceEtag(sourceKey);
      if (etag !== undefined && etag !== manifest.source_etag) {
        stale = true;
        // Background refresh; a failure is logged and retried on a later request.
        this.build(collection, sourceKey).catch((error: unknown) => {
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
