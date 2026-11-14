import { describe, expect, it } from "vitest";

import type { Geometry, Polygon } from "@sentropic/geo-core";

import type { Store } from "../storage/index.js";

import { createApp } from "./app.js";
import { parseCoordPrecision, roundGeometry, withCoordPrecision } from "./precision.js";
import { StoreProvider } from "./providers/store-provider.js";

describe("parseCoordPrecision", () => {
  it("is undefined when absent and accepts integers 0..15", () => {
    expect(parseCoordPrecision(undefined)).toBeUndefined();
    expect(parseCoordPrecision("0")).toBe(0);
    expect(parseCoordPrecision("6")).toBe(6);
    expect(parseCoordPrecision("15")).toBe(15);
  });
  it("rejects anything else", () => {
    for (const raw of ["", "16", "-1", "6.5", "abc", "1e1", " 6", "100"]) {
      expect(parseCoordPrecision(raw), raw).toBeNull();
    }
  });
});

describe("roundGeometry", () => {
  it("rounds x/y and keeps the elevation", () => {
    expect(roundGeometry({ type: "Point", coordinates: [-73.7461449, 46.0582451, 12.3456789] }, 6)).toEqual({
      type: "Point",
      coordinates: [-73.746145, 46.058245, 12.3456789],
    });
  });

  it("drops vertices made identical by the rounding and keeps the ring closed", () => {
    const ring = [
      [0, 0],
      [1.0000001, 0],
      [1.0000002, 0], // collapses onto the previous vertex at 6 decimals
      [1, 1],
      [0, 1],
      [0, 0],
    ] as Polygon["coordinates"][number];
    const out = roundGeometry({ type: "Polygon", coordinates: [ring] }, 6) as Polygon;
    expect(out.coordinates[0]).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]);
  });

  it("never lets a ring fall below 4 positions (keeps the rounded positions instead)", () => {
    const tiny = [
      [0, 0],
      [0.0000001, 0],
      [0.0000001, 0.0000001],
      [0, 0],
    ] as Polygon["coordinates"][number];
    const out = roundGeometry({ type: "Polygon", coordinates: [tiny] }, 6) as Polygon;
    expect(out.coordinates[0]).toHaveLength(4);
  });

  it("covers multi-geometries and collections", () => {
    const g: Geometry = {
      type: "GeometryCollection",
      geometries: [
        { type: "MultiPoint", coordinates: [[0.1234567, 0.7654321]] },
        { type: "MultiLineString", coordinates: [[[0.11, 0.11], [0.19, 0.19]]] },
        {
          type: "MultiPolygon",
          coordinates: [[[[0, 0], [0.26, 0], [0.26, 0.26], [0, 0]]]],
        },
      ],
    };
    expect(roundGeometry(g, 1)).toEqual({
      type: "GeometryCollection",
      geometries: [
        { type: "MultiPoint", coordinates: [[0.1, 0.8]] },
        { type: "MultiLineString", coordinates: [[[0.1, 0.1], [0.2, 0.2]]] },
        { type: "MultiPolygon", coordinates: [[[[0, 0], [0.3, 0], [0.3, 0.3], [0, 0]]]] },
      ],
    });
  });

  it("does not mutate the source feature", () => {
    const feature = {
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [1.23456789, 2.3456789] as [number, number] },
      properties: {},
    };
    const out = withCoordPrecision(feature, 3);
    expect(out.geometry).toEqual({ type: "Point", coordinates: [1.235, 2.346] });
    expect(feature.geometry.coordinates).toEqual([1.23456789, 2.3456789]);
    expect(withCoordPrecision(feature, undefined)).toBe(feature);
  });
});

describe("?coordPrecision on the API", () => {
  const collection = JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "ca/qc/lot/1",
        geometry: { type: "Point", coordinates: [-73.746144912, 46.058245123] },
        properties: { noLot: "1" },
      },
    ],
  });
  const store: Store = {
    put: async () => {},
    get: async () => new TextEncoder().encode(collection),
    has: async () => true,
    list: async () => ["lots.geojson"],
    getStream: async () =>
      (async function* () {
        yield new TextEncoder().encode(collection);
      })(),
  };
  const app = createApp(new StoreProvider(store));

  it("serves exact coordinates by default", async () => {
    const res = await app.request("/collections/lots/items");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { features: { geometry: { coordinates: number[] } }[] };
    expect(body.features[0]!.geometry.coordinates).toEqual([-73.746144912, 46.058245123]);
  });

  it("rounds /items when asked", async () => {
    const res = await app.request("/collections/lots/items?coordPrecision=6");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      features: { geometry: { coordinates: number[] }; properties: unknown }[];
      numberMatched: number;
    };
    expect(body.features[0]!.geometry.coordinates).toEqual([-73.746145, 46.058245]);
    expect(body.features[0]!.properties).toEqual({ noLot: "1" });
    expect(body.numberMatched).toBe(1);
  });

  it("rounds a single feature when asked", async () => {
    const res = await app.request(
      `/collections/lots/items/${encodeURIComponent("ca/qc/lot/1")}?coordPrecision=5`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { geometry: { coordinates: number[] } };
    expect(body.geometry.coordinates).toEqual([-73.74614, 46.05825]);
  });

  it("builds self/next links on the client's scheme behind a TLS ingress", async () => {
    const many = JSON.stringify({
      type: "FeatureCollection",
      features: [0, 1].map((i) => ({
        type: "Feature",
        id: `f${i}`,
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: {},
      })),
    });
    const pagedStore: Store = {
      ...store,
      get: async () => new TextEncoder().encode(many),
      getStream: async () =>
        (async function* () {
          yield new TextEncoder().encode(many);
        })(),
    };
    const paged = createApp(new StoreProvider(pagedStore));
    const res = await paged.request("http://api.example.test/collections/lots/items?limit=1", {
      headers: { "X-Forwarded-Proto": "https" },
    });
    const body = (await res.json()) as { links: { rel: string; href: string }[] };
    const next = body.links.find((l) => l.rel === "next")!.href;
    expect(next).toBe("https://api.example.test/collections/lots/items?limit=1&offset=1");
    expect(body.links.find((l) => l.rel === "self")!.href).toMatch(/^https:\/\/api\.example\.test\//);
    expect(body.links.find((l) => l.rel === "collection")!.href).toBe(
      "https://api.example.test/collections/lots",
    );

    // Without the header (direct pod access) links keep the request scheme; junk values are ignored.
    for (const proto of [undefined, "gopher"]) {
      const direct = await paged.request("http://api.example.test/collections/lots/items?limit=1", {
        headers: proto ? { "X-Forwarded-Proto": proto } : {},
      });
      const links = ((await direct.json()) as { links: { rel: string; href: string }[] }).links;
      expect(links.find((l) => l.rel === "next")!.href).toMatch(/^http:\/\/api\.example\.test\//);
    }
  });

  it("answers 400 on an invalid value", async () => {
    for (const path of [
      "/collections/lots/items?coordPrecision=abc",
      "/collections/lots/items/x?coordPrecision=99",
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(400);
    }
  });
});
