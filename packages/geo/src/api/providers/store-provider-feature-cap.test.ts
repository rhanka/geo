/**
 * Serving-path per-Feature byte cap of {@link StoreProvider} (2026-11-15, geo-api
 * OOM `JsonParser::BuildJsonArray` on
 * `qc-zonage-montreal-cuvettes-retention-ruissellement-2021`: 4 MultiPolygon
 * Features, the largest ~97 MiB of JSON text). A Feature over the cap is
 * refused on its raw bytes — it never reaches `JSON.parse` — the API answers
 * 503 `FeatureTooLarge`, and the refusal is cached per key + ETag so repeated
 * requests do not re-read the source.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ObjectStat, Store } from "../../storage/index.js";

import { createApp } from "../app.js";
import {
  FeatureTooLargeError,
  SERVING_MAX_FEATURE_BYTES,
  resolveServingMaxFeatureBytes,
  validateFeatureCollectionStream,
} from "./collection-loader.js";
import { StoreProvider } from "./store-provider.js";

const ORIGIN = "http://localhost";
const CAP = 1000;

function point(i: number): object {
  return { type: "Feature", id: `f${i}`, geometry: { type: "Point", coordinates: [-73.5 + i * 0.01, 45.5] }, properties: { i } };
}

/** A MultiPolygon Feature whose JSON text is well over {@link CAP}. */
function bigFeature(id: string): object {
  const ring = Array.from({ length: 200 }, (_, k) => [-73.5 + k * 1e-4, 45.5 + k * 1e-4]);
  ring.push(ring[0]!);
  return { type: "Feature", id, geometry: { type: "MultiPolygon", coordinates: [[ring], [ring]] }, properties: {} };
}

function collection(features: object[]): string {
  return JSON.stringify({ type: "FeatureCollection", features });
}

/** In-memory store; `stat` (ETag) only when `withEtag`, stream accounting per open. */
class MemStore implements Store {
  readonly #data = new Map<string, { bytes: Uint8Array; etag: string }>();
  #version = 0;
  readonly opens: string[] = [];
  readonly reads: { chunks: number; total: number }[] = [];
  stat?: (key: string) => Promise<ObjectStat | undefined>;

  constructor(withEtag = true) {
    if (withEtag) {
      this.stat = async (key) => {
        const hit = this.#data.get(key);
        return hit ? { etag: hit.etag, size: hit.bytes.byteLength } : undefined;
      };
    }
  }

  seed(key: string, text: string): void {
    this.#version++;
    this.#data.set(key, { bytes: new TextEncoder().encode(text), etag: `"v${this.#version}"` });
  }

  async put(): Promise<void> {}
  async get(key: string): Promise<Uint8Array | undefined> {
    return this.#data.get(key)?.bytes;
  }
  async has(key: string): Promise<boolean> {
    return this.#data.has(key);
  }
  async list(): Promise<string[]> {
    return [...this.#data.keys()].sort();
  }

  async getStream(key: string): Promise<AsyncIterable<Uint8Array> | undefined> {
    this.opens.push(key);
    const hit = this.#data.get(key);
    if (!hit) return undefined;
    const size = 64;
    const read = { chunks: 0, total: Math.ceil(hit.bytes.byteLength / size) };
    this.reads.push(read);
    const bytes = hit.bytes;
    return (async function* () {
      for (let offset = 0; offset < bytes.byteLength; offset += size) {
        read.chunks++;
        yield bytes.subarray(offset, Math.min(offset + size, bytes.byteLength));
      }
    })();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateFeatureCollectionStream — maxFeatureBytes", () => {
  async function* chunks(text: string, size: number): AsyncGenerator<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.byteLength; i += size) yield bytes.subarray(i, i + size);
  }

  it("throws FeatureTooLargeError on the oversized Feature at every chunk size", async () => {
    const text = collection([point(0), bigFeature("big"), point(2)]);
    for (const size of [1, 7, 64, 4096, text.length]) {
      const error = await validateFeatureCollectionStream(chunks(text, size), { maxFeatureBytes: CAP }).catch((e: unknown) => e);
      expect(error, `chunk ${size}`).toBeInstanceOf(FeatureTooLargeError);
      expect((error as FeatureTooLargeError).featureIndex).toBe(1);
      expect((error as FeatureTooLargeError).bytes).toBeGreaterThan(CAP);
    }
  });

  it("accepts a collection whose Features are all within the cap", async () => {
    const text = collection([point(0), point(1)]);
    expect(await validateFeatureCollectionStream(chunks(text, 5), { maxFeatureBytes: CAP })).toEqual({ features: 2 });
  });
});

describe("resolveServingMaxFeatureBytes", () => {
  it("reads a positive integer, else falls back to the default", () => {
    expect(SERVING_MAX_FEATURE_BYTES).toBe(16 * 1024 * 1024);
    expect(resolveServingMaxFeatureBytes(undefined)).toBe(SERVING_MAX_FEATURE_BYTES);
    expect(resolveServingMaxFeatureBytes("")).toBe(SERVING_MAX_FEATURE_BYTES);
    expect(resolveServingMaxFeatureBytes("33554432")).toBe(33554432);
    for (const bad of ["0", "-1", "1.5", "abc", "Infinity"]) {
      expect(resolveServingMaxFeatureBytes(bad), bad).toBe(SERVING_MAX_FEATURE_BYTES);
    }
  });

  it("is the StoreProvider default when GEO_MAX_FEATURE_BYTES is set", async () => {
    vi.stubEnv("GEO_MAX_FEATURE_BYTES", String(CAP));
    try {
      const store = new MemStore();
      store.seed("big.geojson", collection([bigFeature("b")]));
      const res = await createApp(new StoreProvider(store)).request(`${ORIGIN}/collections/big/items?limit=1`);
      expect(res.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("StoreProvider serving cap", () => {
  it("answers 503 FeatureTooLarge and never JSON.parses the oversized Feature", async () => {
    const store = new MemStore();
    store.seed("big.geojson", collection([bigFeature("b0"), ...Array.from({ length: 50 }, (_, i) => point(i + 1))]));
    const app = createApp(new StoreProvider(store, "", { maxFeatureBytes: CAP }));
    const parse = vi.spyOn(JSON, "parse");

    const res = await app.request(`${ORIGIN}/collections/big/items?limit=10`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string; featureIndex: number; maxFeatureBytes: number };
    expect(body).toMatchObject({ code: "FeatureTooLarge", featureIndex: 0, maxFeatureBytes: CAP });

    // No parse of a text the size of the Feature (only the small response body).
    const featureCalls = parse.mock.calls.filter(([text]) => typeof text === "string" && text.includes('"MultiPolygon"'));
    expect(featureCalls).toEqual([]);
    // The validation scan stopped at the oversized Feature (#0), far before the end.
    expect(store.reads).toHaveLength(1);
    expect(store.reads[0]!.chunks).toBeLessThan(store.reads[0]!.total);
  });

  it("caches the refusal per ETag: a repeated request does not re-read the source", async () => {
    const store = new MemStore();
    store.seed("big.geojson", collection([point(0), bigFeature("b1")]));
    const app = createApp(new StoreProvider(store, "", { maxFeatureBytes: CAP }));

    expect((await app.request(`${ORIGIN}/collections/big/items?limit=1`)).status).toBe(503);
    expect((await app.request(`${ORIGIN}/collections/big/items?limit=1`)).status).toBe(503);
    expect((await app.request(`${ORIGIN}/collections/big/items/f0`)).status).toBe(503);
    expect(store.opens).toEqual(["big.geojson"]);

    // A republished (smaller) source has a new ETag: validated again and served.
    store.seed("big.geojson", collection([point(0), point(1)]));
    const ok = await app.request(`${ORIGIN}/collections/big/items?limit=1`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { numberMatched: number }).numberMatched).toBe(2);
  });

  it("refuses getItem and getItems with FeatureTooLargeError", async () => {
    const store = new MemStore();
    store.seed("big.geojson", collection([point(0), bigFeature("b1")]));
    const provider = new StoreProvider(store, "", { maxFeatureBytes: CAP });
    await expect(provider.getItems("big", { limit: 1 })).rejects.toBeInstanceOf(FeatureTooLargeError);
    await expect(provider.getItem("big", "f0")).rejects.toBeInstanceOf(FeatureTooLargeError);
    await expect(provider.getCollection("big")).resolves.toBeDefined();
  });

  it("applies the cap without an ETag too (validated on every request)", async () => {
    const store = new MemStore(false);
    store.seed("big.geojson", collection([bigFeature("b0")]));
    const app = createApp(new StoreProvider(store, "", { maxFeatureBytes: CAP }));
    expect((await app.request(`${ORIGIN}/collections/big/items`)).status).toBe(503);
    expect((await app.request(`${ORIGIN}/collections/big/items`)).status).toBe(503);
    expect(store.opens).toHaveLength(2);
  });

  it("keeps serving collections whose Features fit within the cap", async () => {
    const store = new MemStore();
    store.seed("small.geojson", collection([point(0), point(1), point(2)]));
    const app = createApp(new StoreProvider(store, "", { maxFeatureBytes: CAP }));
    const res = await app.request(`${ORIGIN}/collections/small/items?limit=2`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { numberReturned: number }).numberReturned).toBe(2);
  });
});
