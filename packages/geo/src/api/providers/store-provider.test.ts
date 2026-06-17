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
    ]);
  });

  it("surfaces an extent for the admin collection (geometry present)", async () => {
    const app = createApp(new StoreProvider(seededStore()));
    const res = await app.request(`${ORIGIN}/collections/ca-qc-regions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; title: string; extent?: unknown };
    expect(body.id).toBe("ca-qc-regions");
    expect(body.title).toBe("Régions administratives du Québec");
    expect(body.extent).toBeDefined();
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
});
