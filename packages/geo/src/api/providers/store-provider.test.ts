/**
 * Hermetic tests for {@link StoreProvider}: drives the OGC app through Hono's
 * `app.request(...)` against an in-memory fake {@link Store} seeded with one
 * geometry-bearing admin collection and one null-geometry referential
 * collection. No network and no live S3 — the fake Store is a `Map`.
 */

import { describe, expect, it } from "vitest";

import type {
  AdminFeatureCollection,
  CollectionMeta,
  ReferentialFeatureCollection,
} from "@sentropic/geo-core";
import type { Store } from "../../storage/index.js";

import { createApp } from "../app.js";
import { StoreProvider } from "./store-provider.js";

const ORIGIN = "http://localhost";

/** A minimal in-memory {@link Store} over a `Map`, for tests. */
class FakeStore implements Store {
  readonly #data = new Map<string, Uint8Array>();
  /** Record of `get()` calls, to assert GeoJSON payloads stay lazy. */
  readonly getCalls: string[] = [];
  /** Record of `getStream()` calls, to assert GeoJSON bodies are not buffered. */
  readonly streamCalls: string[] = [];
  /** Record of `list()` calls, to assert the provider's prefix usage. */
  readonly listCalls: (string | undefined)[] = [];

  seed(key: string, text: string): void {
    this.#data.set(key, new TextEncoder().encode(text));
  }

  put(key: string, body: Uint8Array | string): Promise<void> {
    this.#data.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body);
    return Promise.resolve();
  }

  get(key: string): Promise<Uint8Array | undefined> {
    this.getCalls.push(key);
    return Promise.resolve(this.#data.get(key));
  }

  getStream(key: string): Promise<AsyncIterable<Uint8Array> | undefined> {
    this.streamCalls.push(key);
    const bytes = this.#data.get(key);
    return Promise.resolve(bytes === undefined ? undefined : chunked(bytes, 17));
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.#data.has(key));
  }

  list(prefix?: string): Promise<string[]> {
    this.listCalls.push(prefix);
    const keys = [...this.#data.keys()].sort();
    if (prefix === undefined || prefix.length === 0) return Promise.resolve(keys);
    return Promise.resolve(keys.filter((k) => k.startsWith(prefix)));
  }
}

/** Deliberately split JSON tokens across chunks, like an S3 body can. */
async function* chunked(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.subarray(offset, Math.min(offset + size, bytes.byteLength));
  }
}

// One admin collection (two regions with geometry), namespaced under a source.
const ADMIN_COLLECTION: AdminFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "ca/qc/region/06",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-73.7, 45.4],
            [-73.5, 45.4],
            [-73.5, 45.6],
            [-73.7, 45.6],
            [-73.7, 45.4],
          ],
        ],
      },
      properties: { geoId: "ca/qc/region/06", name: "Montréal", level: "region", country: "CA" },
    },
    {
      type: "Feature",
      id: "ca/qc/region/03",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-71.3, 46.7],
            [-71.1, 46.7],
            [-71.1, 46.9],
            [-71.3, 46.9],
            [-71.3, 46.7],
          ],
        ],
      },
      properties: {
        geoId: "ca/qc/region/03",
        name: "Capitale-Nationale",
        level: "region",
        country: "CA",
      },
    },
  ],
};

const ADMIN_META: CollectionMeta = {
  sourceId: "ca-qc-sda",
  datasetId: "ca-qc-regions",
  title: "Régions administratives du Québec",
  license: { id: "cc-by-4.0", title: "CC BY 4.0", redistributable: true, attributionRequired: true },
  attribution: "© Gouvernement du Québec",
  crs: "EPSG:4326",
  fetchedAt: "2026-06-13T00:00:00.000Z",
  count: 2,
};

// One referential collection: null-geometry crosswalk rows.
const REF_COLLECTION: ReferentialFeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "H2X",
      geometry: null,
      properties: { geoId: "H2X", country: "CA", commune: "ca/qc/region/06" },
    },
    {
      type: "Feature",
      id: "G1R",
      geometry: null,
      properties: { geoId: "G1R", country: "CA", commune: "ca/qc/region/03" },
    },
  ],
};

const REF_META: CollectionMeta = {
  sourceId: "ca-qc-sda",
  datasetId: "ca-qc-postal-crosswalk",
  title: "Correspondance code postal ↔ région",
  license: { id: "cc-by-4.0", title: "CC BY 4.0", redistributable: true, attributionRequired: true },
  attribution: "© Gouvernement du Québec",
  crs: "EPSG:4326",
  fetchedAt: "2026-06-13T00:00:00.000Z",
  count: 2,
};

/** A fake store seeded under a source prefix, like `writeNormalized` emits. */
function seededStore(): FakeStore {
  const store = new FakeStore();
  store.seed("ca-qc-sda/regions.geojson", JSON.stringify(ADMIN_COLLECTION));
  store.seed("ca-qc-sda/regions.meta.json", JSON.stringify(ADMIN_META));
  store.seed("ca-qc-sda/postal.geojson", JSON.stringify(REF_COLLECTION));
  store.seed("ca-qc-sda/postal.meta.json", JSON.stringify(REF_META));
  return store;
}

describe("StoreProvider via the OGC app", () => {
  it("lists both collections by their meta datasetId without loading GeoJSON bodies", async () => {
    const store = seededStore();
    const app = createApp(new StoreProvider(store));
    const res = await app.request(`/collections`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { collections: { id: string }[] };
    const ids = body.collections.map((c) => c.id).sort();
    expect(ids).toEqual(["ca-qc-postal-crosswalk", "ca-qc-regions"]);
    expect(store.getCalls.sort()).toEqual([
      "ca-qc-sda/postal.meta.json",
      "ca-qc-sda/regions.meta.json",
      "coherence.json",
    ]);
  });

  it("serves collection metadata without loading the GeoJSON body", async () => {
    const store = seededStore();
    const app = createApp(new StoreProvider(store));
    const res = await app.request(`/collections/ca-qc-regions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; title: string; extent?: unknown };
    expect(body.id).toBe("ca-qc-regions");
    expect(body.title).toBe("Régions administratives du Québec");
    expect(body.extent).toBeUndefined();
    expect(store.getCalls.sort()).toEqual([
      "ca-qc-sda/postal.meta.json",
      "ca-qc-sda/regions.meta.json",
      "coherence.json",
    ]);
  });

  it("omits the extent for an all-null-geometry referential collection", async () => {
    const app = createApp(new StoreProvider(seededStore()));
    const res = await app.request(`${ORIGIN}/collections/ca-qc-postal-crosswalk`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; extent?: unknown };
    expect(body.id).toBe("ca-qc-postal-crosswalk");
    expect(body.extent).toBeUndefined();
  });

  it("serves items with ?limit and a next link", async () => {
    const app = createApp(new StoreProvider(seededStore()));
    const res = await app.request(`${ORIGIN}/collections/ca-qc-regions/items?limit=1`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/geo+json");
    const body = (await res.json()) as {
      type: string;
      numberMatched: number;
      numberReturned: number;
      links: { rel: string }[];
    };
    expect(body.type).toBe("FeatureCollection");
    expect(body.numberMatched).toBe(2);
    expect(body.numberReturned).toBe(1);
    expect(body.links.map((l) => l.rel)).toContain("next");
  });

  it("filters items by bbox", async () => {
    const app = createApp(new StoreProvider(seededStore()));
    const bbox = "-73.8,45.3,-73.4,45.7";
    const res = await app.request(`${ORIGIN}/collections/ca-qc-regions/items?bbox=${bbox}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      numberMatched: number;
      features: { id: unknown }[];
    };
    expect(body.numberMatched).toBe(1);
    expect(body.features[0]!.id).toBe("ca/qc/region/06");
  });

  it("serves null-geometry referential items", async () => {
    const app = createApp(new StoreProvider(seededStore()));
    const res = await app.request(`${ORIGIN}/collections/ca-qc-postal-crosswalk/items`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      numberReturned: number;
      features: { geometry: unknown }[];
    };
    expect(body.numberReturned).toBe(2);
    expect(body.features[0]!.geometry).toBeNull();
  });

  it("fetches a single item by id", async () => {
    const app = createApp(new StoreProvider(seededStore()));
    const res = await app.request(
      `${ORIGIN}/collections/ca-qc-regions/items/${encodeURIComponent("ca/qc/region/03")}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { properties: { name: string } };
    expect(body.properties.name).toBe("Capitale-Nationale");
  });

  it("404s an unknown collection", async () => {
    const app = createApp(new StoreProvider(seededStore()));
    const res = await app.request(`${ORIGIN}/collections/nope`);
    expect(res.status).toBe(404);
  });

  it("lists the store under the configured prefix and yields zero on an empty store", async () => {
    const empty = new FakeStore();
    const provider = new StoreProvider(empty, "normalized");
    expect(await provider.listCollections()).toEqual([]);
    expect(empty.listCalls).toEqual(["normalized"]);
  });

  it("caches the listing and re-lists after invalidate()", async () => {
    const store = seededStore();
    const provider = new StoreProvider(store);
    await provider.listCollections();
    await provider.listCollections();
    expect(store.listCalls).toHaveLength(1); // cached
    provider.invalidate();
    await provider.listCollections();
    expect(store.listCalls).toHaveLength(2);
  });

  it("serves the nested layout when flat and nested keys share a collection id", async () => {
    const store = new FakeStore();
    store.seed(
      "qc-zonage-x.geojson",
      JSON.stringify({
        type: "FeatureCollection",
        features: [{ type: "Feature", id: "flat", geometry: null, properties: { layout: "flat" } }],
      }),
    );
    store.seed(
      "qc-zonage-x/qc-zonage-x.geojson",
      JSON.stringify({
        type: "FeatureCollection",
        features: [{ type: "Feature", id: "nested", geometry: null, properties: { layout: "nested" } }],
      }),
    );

    const app = createApp(new StoreProvider(store));
    const res = await app.request(`${ORIGIN}/collections/qc-zonage-x/items`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { features: { id: string; properties: { layout: string } }[] };
    expect(body.features).toEqual([
      { type: "Feature", id: "nested", geometry: null, properties: { layout: "nested" } },
    ]);
  });

  it("streams the exact legacy limit=5000 page without Store#get on the GeoJSON body", async () => {
    const store = new FakeStore();
    const features = Array.from({ length: 5001 }, (_, index) => ({
      type: "Feature" as const,
      id: `synthetic/${index}`,
      geometry: null,
      properties: { geoId: `synthetic/${index}`, sequence: index, payload: "x".repeat(64) },
    }));
    const collection = JSON.stringify({ type: "FeatureCollection", features });
    const meta = JSON.stringify({ ...REF_META, datasetId: "synthetic" });
    store.seed("synthetic.geojson", collection);
    store.seed("synthetic.meta.json", meta);

    const app = createApp(new StoreProvider(store));
    const res = await app.request(`${ORIGIN}/collections/synthetic/items?limit=5000`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      type: string;
      features: { id: string }[];
      numberMatched: number;
      numberReturned: number;
      links: { rel: string; href: string }[];
    };

    // This is the old materialized-page result: same feature order and OGC
    // pagination metadata, but the served implementation never builds it.
    const legacyFeatures = (JSON.parse(collection) as { features: { id: string }[] }).features.slice(0, 5000);
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toEqual(legacyFeatures);
    expect(body.numberMatched).toBe(5001);
    expect(body.numberReturned).toBe(5000);
    expect(body.links.find((link) => link.rel === "next")?.href).toContain("offset=5000");
    expect(store.streamCalls).toContain("synthetic.geojson");
    expect(store.getCalls).not.toContain("synthetic.geojson");
  });

  it("rejects a body that is not a GeoJSON FeatureCollection before a 200 response", async () => {
    const store = new FakeStore();
    const meta = JSON.stringify({ ...REF_META, datasetId: "not-a-collection" });
    store.seed(
      "not-a-collection.geojson",
      JSON.stringify({ type: "NotACollection", features: REF_COLLECTION.features }),
    );
    store.seed("not-a-collection.meta.json", meta);

    const app = createApp(new StoreProvider(store));
    const res = await app.request(`${ORIGIN}/collections/not-a-collection/items?limit=1`);
    expect(res.status).toBe(404);
  });

  it("accepts a FeatureCollection whose features member precedes type", async () => {
    const store = new FakeStore();
    const meta = JSON.stringify({ ...REF_META, datasetId: "features-first" });
    store.seed(
      "features-first.geojson",
      JSON.stringify({ features: REF_COLLECTION.features, type: "FeatureCollection" }),
    );
    store.seed("features-first.meta.json", meta);

    const app = createApp(new StoreProvider(store));
    const res = await app.request(`${ORIGIN}/collections/features-first/items?limit=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { numberMatched: number; numberReturned: number };
    expect(body).toMatchObject({ numberMatched: 2, numberReturned: 1 });
  });

  it("rejects malformed bytes after a valid features array before a 200 response", async () => {
    const store = new FakeStore();
    const meta = JSON.stringify({ ...REF_META, datasetId: "invalid-suffix" });
    store.seed(
      "invalid-suffix.geojson",
      `${JSON.stringify(REF_COLLECTION)} trailing-garbage`,
    );
    store.seed("invalid-suffix.meta.json", meta);

    const app = createApp(new StoreProvider(store));
    const res = await app.request(`${ORIGIN}/collections/invalid-suffix/items?limit=1`);
    expect(res.status).toBe(404);
  });

  it("rejects a trailing comma in features before a 200 response", async () => {
    const store = new FakeStore();
    const meta = JSON.stringify({ ...REF_META, datasetId: "trailing-comma" });
    const feature = JSON.stringify(REF_COLLECTION.features[0]);
    store.seed(
      "trailing-comma.geojson",
      `{"type":"FeatureCollection","features":[${feature},]}`,
    );
    store.seed("trailing-comma.meta.json", meta);

    const app = createApp(new StoreProvider(store));
    const res = await app.request(`${ORIGIN}/collections/trailing-comma/items?limit=1`);
    expect(res.status).toBe(404);
  });

  it("recognizes an escaped JSON spelling of the features member", async () => {
    const store = new FakeStore();
    const meta = JSON.stringify({ ...REF_META, datasetId: "escaped-features" });
    store.seed(
      "escaped-features.geojson",
      `{"type":"FeatureCollection","feat\\u0075res":${JSON.stringify(REF_COLLECTION.features)}}`,
    );
    store.seed("escaped-features.meta.json", meta);

    const app = createApp(new StoreProvider(store));
    const res = await app.request(`${ORIGIN}/collections/escaped-features/items?limit=1`);
    expect(res.status).toBe(200);
  });

  it("serves coherence_id per-collection + coherence_id/served_count on the landing when a manifest is present", async () => {
    const store = seededStore();
    store.seed(
      "coherence.json",
      JSON.stringify({
        coherence_id: "w-2026-08-18T00Z",
        served_count: 2,
        set_hash: "abc123",
        generated_at: "2026-08-18T00:00:00.000Z",
        prod_watermark: "prod-42",
      }),
    );
    const app = createApp(new StoreProvider(store));

    const coll = (await (await app.request(`${ORIGIN}/collections/ca-qc-regions`)).json()) as {
      coherence_id?: string;
    };
    expect(coll.coherence_id).toBe("w-2026-08-18T00Z");

    const landing = (await (await app.request(`${ORIGIN}/`)).json()) as {
      coherence_id?: string;
      served_count?: number;
      set_hash?: string;
    };
    expect(landing.coherence_id).toBe("w-2026-08-18T00Z");
    expect(landing.served_count).toBe(2);
    expect(landing.set_hash).toBe("abc123");
  });

  it("omits coherence_id/served_count when no coherence.json manifest is present (rétrocompat prod)", async () => {
    const app = createApp(new StoreProvider(seededStore()));

    const coll = (await (await app.request(`${ORIGIN}/collections/ca-qc-regions`)).json()) as Record<
      string,
      unknown
    >;
    expect(coll).not.toHaveProperty("coherence_id");

    const landing = (await (await app.request(`${ORIGIN}/`)).json()) as Record<string, unknown>;
    expect(landing).not.toHaveProperty("coherence_id");
    expect(landing).not.toHaveProperty("served_count");
  });

  it("fails closed to omitted fields when coherence.json is malformed", async () => {
    const store = seededStore();
    store.seed("coherence.json", "{ this is not json");
    const app = createApp(new StoreProvider(store));
    const landing = (await (await app.request(`${ORIGIN}/`)).json()) as Record<string, unknown>;
    expect(landing).not.toHaveProperty("coherence_id");
    expect(landing).not.toHaveProperty("set_hash");
  });

  it("keeps the legacy last-write-wins behavior for duplicate feature ids", async () => {
    const store = new FakeStore();
    const meta = JSON.stringify({ ...REF_META, datasetId: "duplicate-id" });
    store.seed(
      "duplicate-id.geojson",
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          { type: "Feature", id: "same", geometry: null, properties: { geoId: "same", value: "first" } },
          { type: "Feature", id: "same", geometry: null, properties: { geoId: "same", value: "last" } },
        ],
      }),
    );
    store.seed("duplicate-id.meta.json", meta);

    const app = createApp(new StoreProvider(store));
    const res = await app.request(`${ORIGIN}/collections/duplicate-id/items/same`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { properties: { value: string } };
    expect(body.properties.value).toBe("last");
  });
});
