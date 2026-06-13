/**
 * Hermetic tests for the OGC API – Features app, driven through Hono's
 * `app.request(...)` against an in-memory {@link FeatureProvider} fixture.
 */

import { describe, expect, it } from "vitest";

import { LICENSES, type AdminFeature } from "@sentropic/geo-core";

import { createApp } from "./app.js";
import { CONFORMANCE_CLASSES } from "./ogc.js";
import {
  geometryBBox,
  geometryIntersectsBBox,
  unionBBox,
  type BBox2D,
} from "./geo-util.js";
import type {
  CollectionInfo,
  FeatureProvider,
  ItemsQuery,
  ItemsResult,
} from "./provider.js";

const ORIGIN = "http://localhost";

/** Build a small square polygon centred at [lon, lat]. */
function square(lon: number, lat: number, half = 0.1): AdminFeature["geometry"] {
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon - half, lat - half],
        [lon + half, lat - half],
        [lon + half, lat + half],
        [lon - half, lat + half],
        [lon - half, lat - half],
      ],
    ],
  };
}

function feature(geoId: string, name: string, code: string, lon: number, lat: number): AdminFeature {
  return {
    type: "Feature",
    id: geoId,
    geometry: square(lon, lat),
    properties: { geoId, name, level: "region", code, country: "CA" },
  };
}

// Three Québec-like regions at distinct locations.
const FEATURES: AdminFeature[] = [
  feature("ca/qc/region/06", "Montréal", "06", -73.6, 45.5),
  feature("ca/qc/region/03", "Capitale-Nationale", "03", -71.2, 46.8),
  feature("ca/qc/region/02", "Saguenay–Lac-Saint-Jean", "02", -71.1, 48.4),
];

const COLLECTION_ID = "ca-qc-regions";

/** In-memory provider over {@link FEATURES}, with one collection. */
function makeProvider(): FeatureProvider {
  const byId = new Map(FEATURES.map((f) => [String(f.id), f]));
  let extent: BBox2D | undefined;
  for (const f of FEATURES) extent = unionBBox(extent, geometryBBox(f.geometry));

  const info: CollectionInfo = {
    id: COLLECTION_ID,
    title: "Régions administratives du Québec",
    description: "Test fixture",
    license: LICENSES["cc-by-4.0"],
    attribution: "© Gouvernement du Québec",
    crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
    count: FEATURES.length,
    ...(extent ? { extent: { bbox: extent } } : {}),
  };

  return {
    async listCollections() {
      return [info];
    },
    async getCollection(id) {
      return id === COLLECTION_ID ? info : undefined;
    },
    async getItems(id, q: ItemsQuery): Promise<ItemsResult | undefined> {
      if (id !== COLLECTION_ID) return undefined;
      const matched = q.bbox
        ? FEATURES.filter((f) => geometryIntersectsBBox(f.geometry, q.bbox!))
        : FEATURES;
      const offset = q.offset ?? 0;
      const limit = q.limit ?? matched.length;
      const page = matched.slice(offset, offset + limit);
      return { features: page, numberMatched: matched.length, numberReturned: page.length };
    },
    async getItem(id, featureId) {
      if (id !== COLLECTION_ID) return undefined;
      return byId.get(featureId);
    },
  };
}

const app = createApp(makeProvider());

describe("landing page", () => {
  it("returns title/description and links including a 'data' rel", async () => {
    const res = await app.request(`${ORIGIN}/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; links: { rel: string; href: string }[] };
    expect(body.title).toBeTruthy();
    const rels = body.links.map((l) => l.rel);
    expect(rels).toContain("self");
    expect(rels).toContain("conformance");
    expect(rels).toContain("data");
    expect(rels).toContain("service-desc");
    // Links are absolute.
    for (const l of body.links) expect(l.href.startsWith("http")).toBe(true);
  });
});

describe("conformance", () => {
  it("lists the core + geojson + oas30 conformance classes", async () => {
    const res = await app.request(`${ORIGIN}/conformance`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conformsTo: string[] };
    for (const cls of CONFORMANCE_CLASSES) expect(body.conformsTo).toContain(cls);
  });
});

describe("api", () => {
  it("returns an OpenAPI 3 document covering the items path", async () => {
    const res = await app.request(`${ORIGIN}/api`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(body.openapi.startsWith("3.")).toBe(true);
    expect(body.paths["/collections/{collectionId}/items"]).toBeDefined();
  });
});

describe("collections", () => {
  it("lists the collection", async () => {
    const res = await app.request(`${ORIGIN}/collections`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      collections: { id: string; links: { rel: string }[] }[];
    };
    expect(body.collections).toHaveLength(1);
    const col = body.collections[0]!;
    expect(col.id).toBe(COLLECTION_ID);
    expect(col.links.map((l) => l.rel)).toContain("items");
  });

  it("returns a single collection by id", async () => {
    const res = await app.request(`${ORIGIN}/collections/${COLLECTION_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; extent?: unknown; crs: string[] };
    expect(body.id).toBe(COLLECTION_ID);
    expect(body.extent).toBeDefined();
    expect(body.crs).toContain("http://www.opengis.net/def/crs/OGC/1.3/CRS84");
  });

  it("404s an unknown collection", async () => {
    const res = await app.request(`${ORIGIN}/collections/nope`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("NotFound");
  });
});

describe("items", () => {
  it("returns a valid GeoJSON FeatureCollection with matching counts", async () => {
    const res = await app.request(`${ORIGIN}/collections/${COLLECTION_ID}/items`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/geo+json");
    const body = (await res.json()) as {
      type: string;
      features: AdminFeature[];
      numberMatched: number;
      numberReturned: number;
      timeStamp: string;
      links: { rel: string }[];
    };
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(FEATURES.length);
    expect(body.numberReturned).toBe(FEATURES.length);
    expect(body.numberMatched).toBe(FEATURES.length);
    expect(typeof body.timeStamp).toBe("string");
    expect(body.links.map((l) => l.rel)).toContain("self");
  });

  it("respects ?limit= and emits a 'next' link", async () => {
    const res = await app.request(`${ORIGIN}/collections/${COLLECTION_ID}/items?limit=2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      features: AdminFeature[];
      numberReturned: number;
      numberMatched: number;
      links: { rel: string; href: string }[];
    };
    expect(body.numberReturned).toBe(2);
    expect(body.numberMatched).toBe(FEATURES.length);
    const next = body.links.find((l) => l.rel === "next");
    expect(next).toBeDefined();
    expect(next!.href).toContain("offset=2");
  });

  it("filters by bbox, reducing the set", async () => {
    // Box around Montréal only (~ -73.6, 45.5).
    const bbox = "-73.8,45.3,-73.4,45.7";
    const res = await app.request(
      `${ORIGIN}/collections/${COLLECTION_ID}/items?bbox=${bbox}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      features: AdminFeature[];
      numberMatched: number;
    };
    expect(body.numberMatched).toBe(1);
    expect(body.features[0]!.properties.code).toBe("06");
  });

  it("400s a malformed bbox", async () => {
    const res = await app.request(`${ORIGIN}/collections/${COLLECTION_ID}/items?bbox=1,2,3`);
    expect(res.status).toBe(400);
  });

  it("404s items for an unknown collection", async () => {
    const res = await app.request(`${ORIGIN}/collections/nope/items`);
    expect(res.status).toBe(404);
  });
});

describe("single feature", () => {
  it("returns the right Feature as application/geo+json", async () => {
    const fid = "ca/qc/region/03";
    const res = await app.request(
      `${ORIGIN}/collections/${COLLECTION_ID}/items/${encodeURIComponent(fid)}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/geo+json");
    const body = (await res.json()) as AdminFeature & { links: { rel: string }[] };
    expect(body.type).toBe("Feature");
    expect(body.id).toBe(fid);
    expect(body.properties.name).toBe("Capitale-Nationale");
    expect(body.links.map((l) => l.rel)).toContain("self");
  });

  it("404s an unknown feature", async () => {
    const res = await app.request(
      `${ORIGIN}/collections/${COLLECTION_ID}/items/does-not-exist`,
    );
    expect(res.status).toBe(404);
  });
});
