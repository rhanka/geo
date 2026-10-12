/**
 * `/health` must reflect the data read path, unlike the static `/conformance`
 * probe that stayed green through the 2026-10-12 outage (every `/items` hung).
 * Also pins that a served `/items` response opens its S3 body lazily, so a
 * response that is never written holds no pooled socket.
 */

import { describe, expect, it } from "vitest";

import type { Store } from "../storage/index.js";

import { createApp } from "./app.js";
import type { FeatureProvider } from "./provider.js";
import { StoreProvider } from "./providers/store-provider.js";

const ORIGIN = "http://localhost";
const encoder = new TextEncoder();

const COLLECTION = JSON.stringify({
  type: "FeatureCollection",
  features: [
    { type: "Feature", id: "a", geometry: { type: "Point", coordinates: [-73.5, 45.5] }, properties: {} },
  ],
});

/** In-memory store; `hang` makes every `getStream` never settle (exhausted pool). */
class MemoryStore implements Store {
  readonly streamCalls: string[] = [];
  hang = false;
  constructor(private readonly data: Record<string, string>) {}
  put(): Promise<void> {
    return Promise.resolve();
  }
  get(key: string): Promise<Uint8Array | undefined> {
    const text = this.data[key];
    return Promise.resolve(text === undefined ? undefined : encoder.encode(text));
  }
  getStream(key: string): Promise<AsyncIterable<Uint8Array> | undefined> {
    this.streamCalls.push(key);
    if (this.hang) return new Promise(() => {});
    const text = this.data[key];
    return Promise.resolve(text === undefined ? undefined : oneChunk(encoder.encode(text)));
  }
  has(key: string): Promise<boolean> {
    return Promise.resolve(key in this.data);
  }
  list(): Promise<string[]> {
    return Promise.resolve(Object.keys(this.data).sort());
  }
}

async function* oneChunk(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

describe("GET /health", () => {
  it("answers 200 after reading the first bytes of a served shape", async () => {
    const app = createApp(new StoreProvider(new MemoryStore({ "zones.geojson": COLLECTION })));
    const res = await app.request(`${ORIGIN}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", probe: "shape-read", collection: "zones" });
  });

  it("answers 503 within its deadline when the shape read hangs", async () => {
    const store = new MemoryStore({ "zones.geojson": COLLECTION });
    const provider = new StoreProvider(store);
    await provider.listCollections(); // index first: only the shape read hangs, as in the incident
    store.hang = true;
    const app = createApp(provider, [], undefined, { healthDeadlineMs: 50 });

    const res = await app.request(`${ORIGIN}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "unavailable", probe: "shape-read" });
  });

  it("shares one shape read across concurrent and repeated calls (public route, no S3 amplification)", async () => {
    const store = new MemoryStore({ "zones.geojson": COLLECTION });
    const app = createApp(new StoreProvider(store), [], undefined, { healthCacheMs: 60_000 });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.request(`${ORIGIN}/health`)),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    await app.request(`${ORIGIN}/health`);
    expect(store.streamCalls).toEqual(["zones.geojson"]);
  });

  it("keeps a single in-flight read while it hangs, and answers with a generic reason", async () => {
    const store = new MemoryStore({ "zones.geojson": COLLECTION });
    const provider = new StoreProvider(store);
    await provider.listCollections();
    store.hang = true;
    const app = createApp(provider, [], undefined, { healthDeadlineMs: 20, healthCacheMs: 0 });

    for (let i = 0; i < 3; i++) {
      const res = await app.request(`${ORIGIN}/health`);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: "unavailable", probe: "shape-read", reason: "shape-read-timeout" });
    }
    expect(store.streamCalls).toEqual(["zones.geojson"]);
  });

  it("cancels the timed-out shape read so its S3 body is released at the deadline", async () => {
    let released = false;
    const stalled: Store = {
      put: async () => {},
      get: async () => undefined,
      has: async () => true,
      list: async () => ["zones.geojson"],
      // Headers arrived, then the body stalls: the first chunk never comes.
      getStream: async (_key, opts) => ({
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<Uint8Array>>((_, reject) => {
              opts?.signal?.addEventListener("abort", () => {
                released = true;
                reject(new Error("aborted"));
              });
            }),
        }),
      }),
    };
    const app = createApp(new StoreProvider(stalled), [], undefined, { healthDeadlineMs: 30 });

    const res = await app.request(`${ORIGIN}/health`);
    expect(res.status).toBe(503);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(released).toBe(true);
  });

  it("never exposes the underlying error text", async () => {
    const provider: FeatureProvider = {
      listCollections: async () => [],
      getCollection: async () => undefined,
      getItems: async () => undefined,
      getItem: async () => undefined,
      checkHealth: async () => {
        throw new Error("connect ECONNREFUSED s3.internal.example:443 bucket=secret-bucket");
      },
    };
    const originalError = console.error;
    console.error = () => {};
    try {
      const res = await createApp(provider).request(`${ORIGIN}/health`);
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).not.toMatch(/ECONNREFUSED|secret-bucket|s3\.internal/);
      expect(JSON.parse(text)).toEqual({ status: "unavailable", probe: "shape-read", reason: "shape-read-failed" });
    } finally {
      console.error = originalError;
    }
  });

  it("answers 503 when no collection is indexed", async () => {
    const app = createApp(new StoreProvider(new MemoryStore({})));
    const res = await app.request(`${ORIGIN}/health`);
    expect(res.status).toBe(503);
  });

  it("answers 200 without a probe for providers that do not implement one", async () => {
    const provider: FeatureProvider = {
      listCollections: async () => [],
      getCollection: async () => undefined,
      getItems: async () => undefined,
      getItem: async () => undefined,
    };
    const res = await createApp(provider).request(`${ORIGIN}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", probe: "none" });
  });
});

describe("StoreProvider.streamItems opens the served body lazily", () => {
  it("opens only the validation stream until the served features are pulled", async () => {
    const store = new MemoryStore({ "zones.geojson": COLLECTION });
    const provider = new StoreProvider(store);

    const stream = await provider.streamItems("zones", {});
    expect(store.streamCalls).toEqual(["zones.geojson"]);

    const ids: unknown[] = [];
    for await (const feature of stream!.features) ids.push(feature.id);
    expect(ids).toEqual(["a"]);
    expect(store.streamCalls).toEqual(["zones.geojson", "zones.geojson"]);
  });
});
