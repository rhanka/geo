/**
 * Hermetic tests for the province-wide cadastre crawl recipe (ADR-0007: no real
 * network, no wall-clock). `fetchImpl` / `sleep` / `now` are injected; every
 * assertion runs against a deterministic in-memory fake of the cadastre allégé
 * MapServer.
 *
 * The crawl drives the generic ArcGIS crawler in bbox-tiling mode over the
 * Québec extent — so these tests pin: the ESRI spatial-envelope params are sent,
 * an unbounded `where=1=1` is never issued alone, NO_LOT is preserved verbatim
 * through the merge+normalize, and the provenance reflects a bbox crawl.
 */

import type { Feature, FeatureCollection, Geometry } from "@sentropic/geo-core";
import { describe, expect, it, vi } from "vitest";

import {
  CADASTRE_LAYER_LOTS,
  CADASTRE_SERVICE_URL,
} from "./manifest.js";
import {
  CADASTRE_CRAWL_VERSION,
  QC_EXTENT,
  crawlQcCadastreLots,
} from "./crawl.js";

/** A square lot polygon carrying a NO_LOT, placed at `[lon, lat]`. */
function lot(noLot: string, lon: number, lat: number): Feature<Geometry | null> {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [lon, lat],
          [lon + 0.001, lat],
          [lon + 0.001, lat + 0.001],
          [lon, lat + 0.001],
          [lon, lat],
        ],
      ],
    },
    properties: { NO_LOT: noLot },
  };
}

function fc(features: Feature<Geometry | null>[]): FeatureCollection<Geometry | null> {
  return { type: "FeatureCollection", features };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), { status: 200, statusText: "OK", ...init });
}

const noop = () => Promise.resolve();
const FIXED_NOW = () => new Date("2026-06-15T00:00:00.000Z");

/** Is this URL the `?f=json` metadata probe (not a `/query` request)? */
function isMetaProbe(url: string): boolean {
  return url.includes("f=json") && !url.includes("/query");
}

describe("crawlQcCadastreLots — bbox tiling over the QC extent", () => {
  it("tiles the QC extent, pages by subdivision, and merges all lots", async () => {
    // maxRecordCount=2. The root QC tile comes back full (2) → subdivide into 4
    // quadrants; one quadrant holds two lots, the rest are empty. So the merged
    // set is the leaf-quadrant features (the truncated root tile is discarded).
    const southLots = fc([lot("4 516 943", -73.5, 45.5), lot("4 516 944", -73.6, 45.6)]);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (isMetaProbe(url)) return jsonResponse({ maxRecordCount: 2 });
      const params = new URL(url).searchParams;
      const [west, south, east] = (params.get("geometry") ?? "").split(",").map(Number);
      const width = (east ?? 0) - (west ?? 0);
      // The full-province root tile (≈ 22.7° wide) returns full → subdivide.
      // Children are ≈ 11.35° wide, so a > 15 threshold matches only the root.
      if (width > 15) return jsonResponse(southLots);
      // The SW quadrant is exactly the root's [west, south] corner; it holds the
      // two southern lots, the other three quadrants are empty.
      if (west === QC_EXTENT[0] && south === QC_EXTENT[1]) {
        return jsonResponse(southLots);
      }
      return jsonResponse(fc([]));
    }) as unknown as typeof fetch;

    const result = await crawlQcCadastreLots({ fetchImpl, sleep: noop, now: FIXED_NOW, maxBboxDepth: 1 });

    // root + 4 quadrants = 5 query requests.
    expect(result.provenance.strategy).toBe("bbox");
    expect(result.provenance.pages).toBe(5);
    expect(result.provenance.maxRecordCount).toBe(2);
    expect(result.recipeVersion).toBe(CADASTRE_CRAWL_VERSION);

    // Two lots merged + normalized; NO_LOT preserved verbatim (spaces) as key.
    const noLots = result.collection.features.map((f) => f.properties.noLot).sort();
    expect(noLots).toEqual(["4 516 943", "4 516 944"]);
    const first = result.collection.features.find((f) => f.properties.noLot === "4 516 943");
    expect(first?.properties.name).toBe("4 516 943");
    expect(first?.properties.code).toBe("4 516 943");
    expect(first?.properties.geoId).toBe("ca/qc/lot/4-516-943");
    expect(first?.properties.level).toBe("locality");
    expect(first?.properties.country).toBe("CA");
  });

  it("sends ESRI spatial-envelope params on every tile (geometryType/spatialRel/inSR)", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (isMetaProbe(url)) return jsonResponse({ maxRecordCount: 2000 });
      const params = new URL(url).searchParams;
      expect(params.get("geometryType")).toBe("esriGeometryEnvelope");
      expect(params.get("spatialRel")).toBe("esriSpatialRelIntersects");
      expect(params.get("inSR")).toBe("4326");
      expect(params.get("outSR")).toBe("4326");
      expect(params.get("f")).toBe("geojson");
      // The spatial envelope is present and parses as [w,s,e,n] numbers.
      const env = (params.get("geometry") ?? "").split(",").map(Number);
      expect(env).toHaveLength(4);
      expect(env.every((n) => Number.isFinite(n))).toBe(true);
      return jsonResponse(fc([lot("1234567", -73.5, 45.5)]));
    }) as unknown as typeof fetch;

    const result = await crawlQcCadastreLots({ fetchImpl, sleep: noop });
    expect(result.collection.features).toHaveLength(1);
  });

  it("never issues an unbounded where=1=1 query (every query tile carries a geometry filter)", async () => {
    const queryUrls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (isMetaProbe(url)) return jsonResponse({ maxRecordCount: 2000 });
      queryUrls.push(url);
      return jsonResponse(fc([lot("7654321", -71, 46.8)]));
    }) as unknown as typeof fetch;

    await crawlQcCadastreLots({ fetchImpl, sleep: noop });

    expect(queryUrls.length).toBeGreaterThan(0);
    for (const url of queryUrls) {
      const params = new URL(url).searchParams;
      // where may default to "1=1", but it is ALWAYS bounded by a spatial filter.
      expect(params.get("geometry")).toBeTruthy();
      expect(params.get("geometryType")).toBe("esriGeometryEnvelope");
      // It is never the bare unbounded shape the server 404s (no spatial filter).
      const unbounded = params.get("where") === "1=1" && !params.get("geometry");
      expect(unbounded).toBe(false);
    }
  });

  it("targets the real cadastre layer 0 query endpoint and defaults to the QC extent", async () => {
    let rootGeometry = "";
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (isMetaProbe(url)) return jsonResponse({}); // no metadata → defaults.
      if (!rootGeometry) rootGeometry = new URL(url).searchParams.get("geometry") ?? "";
      return jsonResponse(fc([]));
    }) as unknown as typeof fetch;

    const result = await crawlQcCadastreLots({ fetchImpl, sleep: noop });

    expect(result.provenance.url).toBe(
      `${CADASTRE_SERVICE_URL}/${CADASTRE_LAYER_LOTS}/query`,
    );
    // The first (root) tile is exactly the documented QC extent.
    expect(rootGeometry.split(",").map(Number)).toEqual([...QC_EXTENT]);
    expect(result.collection.features).toHaveLength(0);
  });

  it("restricts the response to the NO_LOT field (outFields)", async () => {
    let outFields: string | null = null;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (isMetaProbe(url)) return jsonResponse({ maxRecordCount: 2000 });
      outFields = new URL(url).searchParams.get("outFields");
      return jsonResponse(fc([lot("9 999 999", -68, 50)]));
    }) as unknown as typeof fetch;

    await crawlQcCadastreLots({ fetchImpl, sleep: noop });
    expect(outFields).toBe("NO_LOT");
  });

  it("honours a caller-supplied sub-region extent instead of the whole province", async () => {
    let rootGeometry = "";
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (isMetaProbe(url)) return jsonResponse({ maxRecordCount: 2000 });
      if (!rootGeometry) rootGeometry = new URL(url).searchParams.get("geometry") ?? "";
      return jsonResponse(fc([]));
    }) as unknown as typeof fetch;

    const subRegion = [-74.2, 45.0, -73.0, 46.0] as const;
    await crawlQcCadastreLots({ fetchImpl, sleep: noop, extent: subRegion });
    expect(rootGeometry.split(",").map(Number)).toEqual([...subRegion]);
  });
});

describe("QC_EXTENT", () => {
  it("is a sane WGS84 envelope spanning the province", () => {
    const [west, south, east, north] = QC_EXTENT;
    expect(east).toBeGreaterThan(west);
    expect(north).toBeGreaterThan(south);
    // Longitudes are western-hemisphere; latitudes span temperate→subarctic QC.
    expect(west).toBeLessThan(0);
    expect(east).toBeLessThan(0);
    expect(south).toBeGreaterThan(40);
    expect(north).toBeLessThan(65);
  });
});
