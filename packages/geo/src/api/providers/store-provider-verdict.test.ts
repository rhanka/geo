/**
 * Validation-verdict cache of {@link StoreProvider} (2026-11-14, items 502 on
 * `qc-zonage-montreal-cuvettes-retention-ruissellement-2021`, ~200 MB source):
 * with a store exposing an object identity (`stat`), a source is validated once
 * per ETag instead of before every items response, and an unfiltered page stops
 * reading the source once `offset + limit` Features are served — while the OGC
 * `numberMatched` and `next` link stay exact.
 */

import { describe, expect, it } from "vitest";

import type { ObjectStat, Store } from "../../storage/index.js";

import { createApp } from "../app.js";
import { validateFeatureCollectionStream } from "./collection-loader.js";
import { StoreProvider } from "./store-provider.js";

const ORIGIN = "http://localhost";

function collectionOf(count: number): string {
  return JSON.stringify({
    type: "FeatureCollection",
    features: Array.from({ length: count }, (_, i) => ({
      type: "Feature",
      id: `f${i}`,
      geometry: { type: "Point", coordinates: [-73.5 + i * 0.01, 45.5] },
      properties: { i },
    })),
  });
}

/** In-memory store with `stat` (ETag = version counter) and stream accounting. */
class VersionedStore implements Store {
  readonly #data = new Map<string, { bytes: Uint8Array; etag: string }>();
  #version = 0;
  /** Every `getStream` call, in order. */
  readonly opens: string[] = [];
  /** Per opened stream: chunks yielded and whether it was closed early. */
  readonly reads: { chunks: number; total: number; closedEarly: boolean }[] = [];
  /** When set, the next stream opened waits for it before its first chunk. */
  gate: Promise<void> | undefined;

  seed(key: string, text: string): void {
    this.#version++;
    this.#data.set(key, { bytes: new TextEncoder().encode(text), etag: `"v${this.#version}"` });
  }

  async stat(key: string): Promise<ObjectStat | undefined> {
    const hit = this.#data.get(key);
    return hit ? { etag: hit.etag, size: hit.bytes.byteLength } : undefined;
  }

  async put(): Promise<void> {}

  async get(key: string): Promise<Uint8Array | undefined> {
    return this.#data.get(key)?.bytes;
  }

  async getStream(key: string): Promise<AsyncIterable<Uint8Array> | undefined> {
    this.opens.push(key);
    const hit = this.#data.get(key);
    if (!hit) return undefined;
    const size = 16;
    const read = { chunks: 0, total: Math.ceil(hit.bytes.byteLength / size), closedEarly: false };
    this.reads.push(read);
    const gate = this.gate;
    this.gate = undefined;
    const bytes = hit.bytes;
    return (async function* () {
      if (gate) await gate;
      let done = false;
      try {
        for (let offset = 0; offset < bytes.byteLength; offset += size) {
          read.chunks++;
          yield bytes.subarray(offset, Math.min(offset + size, bytes.byteLength));
        }
        done = true;
      } finally {
        if (!done) read.closedEarly = true;
      }
    })();
  }

  async has(key: string): Promise<boolean> {
    return this.#data.has(key);
  }

  async list(): Promise<string[]> {
    return [...this.#data.keys()].sort();
  }
}

interface ItemsBody {
  features: { id: string }[];
  numberMatched: number;
  numberReturned: number;
  links: { rel: string; href: string }[];
}

async function items(app: ReturnType<typeof createApp>, query: string): Promise<ItemsBody> {
  const res = await app.request(`${ORIGIN}/collections/big/items${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ItemsBody;
}

describe("validateFeatureCollectionStream", () => {
  async function* once(text: string): AsyncGenerator<Uint8Array> {
    yield new TextEncoder().encode(text);
  }

  it("resolves with the Feature count of a valid collection", async () => {
    expect(await validateFeatureCollectionStream(once(collectionOf(0)))).toEqual({ features: 0 });
    expect(await validateFeatureCollectionStream(once(collectionOf(37)))).toEqual({ features: 37 });
  });
});

describe("StoreProvider validation verdict cache", () => {
  it("validates a source once per ETag and serves later pages without a validation pass", async () => {
    const store = new VersionedStore();
    store.seed("big.geojson", collectionOf(50));
    const app = createApp(new StoreProvider(store));

    const first = await items(app, "?limit=2");
    expect(first.numberMatched).toBe(50);
    expect(store.opens).toEqual(["big.geojson", "big.geojson"]); // validation + served

    const second = await items(app, "?limit=2&offset=2");
    expect(second.features.map((f) => f.id)).toEqual(["f2", "f3"]);
    expect(second.numberMatched).toBe(50);
    expect(store.opens).toHaveLength(3); // served pass only
  });

  it("stops reading the source once an unfiltered page is complete, with an exact count and next link", async () => {
    const store = new VersionedStore();
    store.seed("big.geojson", collectionOf(200));
    const app = createApp(new StoreProvider(store));

    const body = await items(app, "?limit=3");
    expect(body.features.map((f) => f.id)).toEqual(["f0", "f1", "f2"]);
    expect(body.numberMatched).toBe(200);
    expect(body.numberReturned).toBe(3);
    expect(body.links.find((l) => l.rel === "next")?.href).toContain("offset=3");

    const [validation, served] = store.reads;
    expect(validation!.chunks).toBe(validation!.total); // whole object validated once
    expect(served!.closedEarly).toBe(true);
    expect(served!.chunks).toBeLessThan(served!.total / 10);
  });

  it("serves the last page and an offset past the end without draining or a next link", async () => {
    const store = new VersionedStore();
    store.seed("big.geojson", collectionOf(5));
    const app = createApp(new StoreProvider(store));

    const last = await items(app, "?limit=2&offset=4");
    expect(last.features.map((f) => f.id)).toEqual(["f4"]);
    expect(last.numberMatched).toBe(5);
    expect(last.links.map((l) => l.rel)).not.toContain("next");

    const opensBefore = store.opens.length;
    const past = await items(app, "?limit=2&offset=9");
    expect(past.features).toEqual([]);
    expect(past.numberMatched).toBe(5);
    expect(past.links.map((l) => l.rel)).not.toContain("next");
    expect(store.opens).toHaveLength(opensBefore); // nothing to read: served body never opened
  });

  it("revalidates when the source ETag changes", async () => {
    const store = new VersionedStore();
    store.seed("big.geojson", collectionOf(4));
    const app = createApp(new StoreProvider(store));
    expect((await items(app, "?limit=1")).numberMatched).toBe(4);

    store.seed("big.geojson", collectionOf(7));
    const body = await items(app, "?limit=1");
    expect(body.numberMatched).toBe(7);
    expect(store.opens).toHaveLength(4); // (validation + served) x 2
  });

  it("keeps an exact drained count for a bbox query (no known total)", async () => {
    const store = new VersionedStore();
    store.seed("big.geojson", collectionOf(30));
    const app = createApp(new StoreProvider(store));
    await items(app, "?limit=1"); // warm the verdict

    const body = await items(app, "?limit=1&bbox=-73.51,45.4,-73.395,45.6");
    expect(body.numberMatched).toBe(11); // f0..f10
    expect(body.numberReturned).toBe(1);
    const served = store.reads.at(-1)!;
    expect(served.chunks).toBe(served.total);
  });

  it("still rejects an invalid source before a 200, and does not cache it as valid", async () => {
    const store = new VersionedStore();
    store.seed("big.geojson", `${collectionOf(3)} trailing-garbage`);
    const app = createApp(new StoreProvider(store));

    expect((await app.request(`${ORIGIN}/collections/big/items?limit=1`)).status).toBe(404);
    const perRequest = store.opens.length;
    expect(perRequest).toBeGreaterThan(0);
    expect((await app.request(`${ORIGIN}/collections/big/items?limit=1`)).status).toBe(404);
    // Validated again (no verdict cached for invalid bytes), and every read was
    // a complete validation scan: no served body was ever opened.
    expect(store.opens).toHaveLength(2 * perRequest);
    expect(store.reads.every((r) => r.chunks === r.total)).toBe(true);
  });

  it("shares one validation between concurrent requests and keeps it when the client leaves", async () => {
    const store = new VersionedStore();
    store.seed("big.geojson", collectionOf(6));
    const provider = new StoreProvider(store);

    let release!: () => void;
    store.gate = new Promise<void>((resolve) => (release = resolve));
    const leaving = new AbortController();
    const first = provider.streamItems("big", {}, leaving.signal);
    const second = provider.streamItems("big", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.opens).toEqual(["big.geojson"]); // one shared validation

    leaving.abort(); // e.g. an ingress timeout: this request gives up
    expect(await first).toBeUndefined();

    release(); // the shared scan completes anyway
    const stream = await second;
    expect(stream?.numberMatched).toBe(6);

    // The verdict survived the departed client: no new validation pass.
    const third = await provider.streamItems("big", {});
    expect(third?.numberMatched).toBe(6);
    expect(store.opens).toEqual(["big.geojson"]);
  });

  it("stops getItems early too when the total is known", async () => {
    const store = new VersionedStore();
    store.seed("big.geojson", collectionOf(100));
    const provider = new StoreProvider(store);

    const result = await provider.getItems("big", { limit: 2, offset: 1 });
    expect(result?.features.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(result?.numberMatched).toBe(100);
    expect(store.reads.at(-1)!.closedEarly).toBe(true);
  });
});
