/**
 * Hermetic tests for the generic ArcGIS REST crawler (ADR-0007: no real network,
 * no wall-clock). `fetchImpl`, `sleep` and `now` are injected; every test asserts
 * on a fully deterministic, in-memory fake server.
 */

import type { Feature, FeatureCollection, Geometry } from "@sentropic/geo-core";
import { describe, expect, it, vi } from "vitest";

import {
  ARCGIS_DEFAULT_PAGE_SIZE,
  bboxToExtent,
  crawlArcgisLayer,
} from "./arcgis-crawl.js";

const SERVICE = "https://host/arcgis/rest/services/Zonage/FeatureServer";

/** A point feature carrying an `id` so pages are distinguishable. */
function feature(id: number): Feature<Geometry | null> {
  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [-73.5 + id / 1000, 45.5] },
    properties: { OBJECTID: id, ZONE: `H-${id}` },
  };
}

function fc(features: Feature<Geometry | null>[]): FeatureCollection<Geometry | null> {
  return { type: "FeatureCollection", features };
}

/** Build a JSON Response (the crawler reads `.text()` then JSON.parses). */
function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: "OK",
    ...init,
  });
}

/** A no-op injected sleep that still records how long the crawler asked to wait. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    sleep: (ms: number) => {
      calls.push(ms);
      return Promise.resolve();
    },
  };
}

/** Parse `resultOffset` from a query URL (NaN when absent). */
function offsetOf(url: string): number {
  return Number(new URL(url).searchParams.get("resultOffset"));
}

describe("crawlArcgisLayer — offset pagination", () => {
  it("pages through resultOffset/resultRecordCount until a short page", async () => {
    // Server: maxRecordCount=2, three pages of 2/2/1 features (= 5 total).
    const pages: Record<number, Feature<Geometry | null>[]> = {
      0: [feature(1), feature(2)],
      2: [feature(3), feature(4)],
      4: [feature(5)],
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({ maxRecordCount: 2 });
      }
      return jsonResponse(fc(pages[offsetOf(url)] ?? []));
    }) as unknown as typeof fetch;

    const { sleep, calls } = recordingSleep();
    const result = await crawlArcgisLayer(SERVICE, 0, {
      fetchImpl,
      sleep,
      now: () => new Date("2026-06-14T00:00:00.000Z"),
    });

    expect(result.collection.features).toHaveLength(5);
    expect(result.collection.features.map((f) => f.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.provenance).toMatchObject({
      strategy: "offset",
      pageSize: 2,
      maxRecordCount: 2,
      pages: 3,
      fetchedAt: "2026-06-14T00:00:00.000Z",
    });
    // url drops pagination params and the trailing /query keeps the canonical shape.
    expect(result.provenance.url).toBe(`${SERVICE}/0/query`);
    // Throttle slept between the two page boundaries (not after the last page).
    expect(calls.filter((ms) => ms > 0)).toHaveLength(2);
  });

  it("treats an exact-multiple layer's trailing empty page as the stop signal", async () => {
    // 2 full pages of 2, then an empty page → 3 requests, 4 features.
    const pages: Record<number, Feature<Geometry | null>[]> = {
      0: [feature(1), feature(2)],
      2: [feature(3), feature(4)],
      4: [],
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({ maxRecordCount: 2 });
      }
      return jsonResponse(fc(pages[offsetOf(url)] ?? []));
    }) as unknown as typeof fetch;

    const result = await crawlArcgisLayer(SERVICE, 0, {
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    expect(result.collection.features).toHaveLength(4);
    expect(result.provenance.pages).toBe(3);
  });
});

describe("crawlArcgisLayer — maxRecordCount detection", () => {
  it("uses the server-advertised maxRecordCount as the page size", async () => {
    const seenRecordCounts: Array<string | null> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({ maxRecordCount: 1000 });
      }
      seenRecordCounts.push(new URL(url).searchParams.get("resultRecordCount"));
      return jsonResponse(fc([feature(1)])); // short page → one request.
    }) as unknown as typeof fetch;

    const result = await crawlArcgisLayer(SERVICE, 0, {
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    expect(result.provenance.pageSize).toBe(1000);
    expect(seenRecordCounts).toEqual(["1000"]);
  });

  it("clamps a caller pageSize down to the detected maxRecordCount", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({ maxRecordCount: 50 });
      }
      return jsonResponse(fc([feature(1)]));
    }) as unknown as typeof fetch;

    const result = await crawlArcgisLayer(SERVICE, 0, {
      fetchImpl,
      sleep: () => Promise.resolve(),
      pageSize: 5000, // server caps at 50.
    });
    expect(result.provenance.pageSize).toBe(50);
  });

  it("falls back to ARCGIS_DEFAULT_PAGE_SIZE when no metadata is advertised", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({}); // no maxRecordCount.
      }
      return jsonResponse(fc([feature(1)]));
    }) as unknown as typeof fetch;

    const result = await crawlArcgisLayer(SERVICE, 0, {
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    expect(result.provenance.pageSize).toBe(ARCGIS_DEFAULT_PAGE_SIZE);
    expect(result.provenance.maxRecordCount).toBeUndefined();
  });

  it("skips the metadata probe when asked (no ?f=json request issued)", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain("/query");
      return jsonResponse(fc([feature(1)]));
    }) as unknown as typeof fetch;

    const result = await crawlArcgisLayer(SERVICE, 0, {
      fetchImpl,
      sleep: () => Promise.resolve(),
      skipMetadataProbe: true,
      pageSize: 250,
    });
    expect(result.provenance.pageSize).toBe(250);
    // Only the single query page — the probe was skipped.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("crawlArcgisLayer — backoff & retry", () => {
  it("retries on HTTP 429 with exponential backoff, then succeeds", async () => {
    let queryAttempts = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({ maxRecordCount: 1000 });
      }
      queryAttempts += 1;
      if (queryAttempts < 3) {
        return new Response("rate limited", { status: 429, statusText: "Too Many Requests" });
      }
      return jsonResponse(fc([feature(1)]));
    }) as unknown as typeof fetch;

    const { sleep, calls } = recordingSleep();
    const result = await crawlArcgisLayer(SERVICE, 0, {
      fetchImpl,
      sleep,
      backoffBaseMs: 100,
      throttleMs: 0,
    });
    expect(result.collection.features).toHaveLength(1);
    expect(queryAttempts).toBe(3); // two 429s then a 200.
    // Two backoff sleeps were taken before the successful third attempt.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((ms) => ms >= 1)).toBe(true);
  });

  it("honours a Retry-After header (delta-seconds) over computed backoff", async () => {
    let queryAttempts = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({ maxRecordCount: 1000 });
      }
      queryAttempts += 1;
      if (queryAttempts < 2) {
        return new Response("", {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "Retry-After": "7" },
        });
      }
      return jsonResponse(fc([feature(1)]));
    }) as unknown as typeof fetch;

    const { sleep, calls } = recordingSleep();
    await crawlArcgisLayer(SERVICE, 0, { fetchImpl, sleep, throttleMs: 0 });
    // 7 seconds → 7000 ms, exactly, not a jittered backoff.
    expect(calls).toContain(7000);
  });

  it("throws after exhausting the retry budget on persistent 500s", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({ maxRecordCount: 1000 });
      }
      return new Response("boom", { status: 500, statusText: "Server Error" });
    }) as unknown as typeof fetch;

    await expect(
      crawlArcgisLayer(SERVICE, 0, {
        fetchImpl,
        sleep: () => Promise.resolve(),
        maxRetries: 2,
        throttleMs: 0,
      }),
    ).rejects.toThrow(/exhausted 2 retries/);
  });

  it("throws immediately on a non-retryable 4xx (no retries)", async () => {
    let queryAttempts = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({ maxRecordCount: 1000 });
      }
      queryAttempts += 1;
      return new Response("bad", { status: 400, statusText: "Bad Request" });
    }) as unknown as typeof fetch;

    await expect(
      crawlArcgisLayer(SERVICE, 0, {
        fetchImpl,
        sleep: () => Promise.resolve(),
        throttleMs: 0,
      }),
    ).rejects.toThrow(/non-retryable HTTP 400/);
    expect(queryAttempts).toBe(1); // never retried.
  });
});

describe("crawlArcgisLayer — request shape (outSR / format / fields)", () => {
  it("emits WGS84 GeoJSON defaults and merges caller query params", async () => {
    let queryUrl = "";
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({ maxRecordCount: 1000 });
      }
      queryUrl = url;
      return jsonResponse(fc([feature(1)]));
    }) as unknown as typeof fetch;

    await crawlArcgisLayer(SERVICE, 7, {
      fetchImpl,
      sleep: () => Promise.resolve(),
      query: { where: "ZONE_TYPE='H'", outFields: "OBJECTID,ZONE" },
    });

    const parsed = new URL(queryUrl);
    expect(parsed.pathname).toBe("/arcgis/rest/services/Zonage/FeatureServer/7/query");
    expect(parsed.searchParams.get("outSR")).toBe("4326");
    expect(parsed.searchParams.get("f")).toBe("geojson");
    expect(parsed.searchParams.get("returnGeometry")).toBe("true");
    // Caller params override the where=1=1 / outFields=* defaults.
    expect(parsed.searchParams.get("where")).toBe("ZONE_TYPE='H'");
    expect(parsed.searchParams.get("outFields")).toBe("OBJECTID,ZONE");
  });

  it("forwards extra headers on every request", async () => {
    const seenHeaders: Array<Record<string, string> | undefined> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      seenHeaders.push(init?.headers as Record<string, string> | undefined);
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({ maxRecordCount: 1000 });
      }
      return jsonResponse(fc([feature(1)]));
    }) as unknown as typeof fetch;

    await crawlArcgisLayer(SERVICE, 0, {
      fetchImpl,
      sleep: () => Promise.resolve(),
      headers: { "User-Agent": "sentropic-geo/0.1" },
    });
    expect(seenHeaders.length).toBeGreaterThanOrEqual(2); // probe + page.
    for (const headers of seenHeaders) {
      expect(headers).toEqual({ "User-Agent": "sentropic-geo/0.1" });
    }
  });
});

describe("crawlArcgisLayer — empty & malformed", () => {
  it("returns an empty collection for a layer with no features", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({ maxRecordCount: 1000 });
      }
      return jsonResponse(fc([]));
    }) as unknown as typeof fetch;

    const result = await crawlArcgisLayer(SERVICE, 0, {
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    expect(result.collection).toEqual({ type: "FeatureCollection", features: [] });
    expect(result.provenance.pages).toBe(1);
  });

  it("throws when a page is not a GeoJSON FeatureCollection (e.g. an ArcGIS error JSON)", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({ maxRecordCount: 1000 });
      }
      // ArcGIS reports errors as 200 + an `error` envelope, not a FeatureCollection.
      return jsonResponse({ error: { code: 400, message: "Invalid query parameters" } });
    }) as unknown as typeof fetch;

    await expect(
      crawlArcgisLayer(SERVICE, 0, { fetchImpl, sleep: () => Promise.resolve() }),
    ).rejects.toThrow(/expected a GeoJSON FeatureCollection/);
  });

  it("proceeds with defaults when the metadata probe itself fails", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        // Probe failures are swallowed — crawl must still run on defaults.
        return new Response("nope", { status: 404, statusText: "Not Found" });
      }
      return jsonResponse(fc([feature(1)]));
    }) as unknown as typeof fetch;

    const result = await crawlArcgisLayer(SERVICE, 0, {
      fetchImpl,
      sleep: () => Promise.resolve(),
    });
    expect(result.collection.features).toHaveLength(1);
    expect(result.provenance.pageSize).toBe(ARCGIS_DEFAULT_PAGE_SIZE);
  });
});

describe("crawlArcgisLayer — bbox tiling strategy", () => {
  it("subdivides a full tile and gathers features from the leaf quadrants", async () => {
    // The root extent comes back full (=pageSize 2) → subdivide into 4 children;
    // one child has features, the others are empty. 1 root + 4 child = 5 requests.
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("f=json") && !url.includes("/query")) {
        return jsonResponse({
          maxRecordCount: 2,
          extent: { xmin: -74, ymin: 45, xmax: -73, ymax: 46 },
        });
      }
      const params = new URL(url).searchParams;
      expect(params.get("geometryType")).toBe("esriGeometryEnvelope");
      expect(params.get("inSR")).toBe("4326");
      const [west, south, east] = (params.get("geometry") ?? "").split(",").map(Number);
      const width = (east ?? 0) - (west ?? 0);
      // The full-width root tile (width 1°) comes back full → subdivide. A child
      // (width 0.5°) covering the SW quadrant returns one feature; others empty.
      if (width > 0.75) return jsonResponse(fc([feature(1), feature(2)]));
      if (west === -73.5 && south === 45) return jsonResponse(fc([feature(3)]));
      return jsonResponse(fc([]));
    }) as unknown as typeof fetch;

    const result = await crawlArcgisLayer(SERVICE, 0, {
      fetchImpl,
      sleep: () => Promise.resolve(),
      strategy: "bbox",
      maxBboxDepth: 2,
    });

    expect(result.provenance.strategy).toBe("bbox");
    expect(result.provenance.pages).toBe(5); // root + 4 quadrants.
    expect(result.collection.features.map((f) => f.id).sort()).toEqual([3]);
  });
});

describe("bboxToExtent", () => {
  it("narrows a 2D bbox and a 3D bbox to [w,s,e,n]", () => {
    expect(bboxToExtent([-74, 45, -73, 46])).toEqual([-74, 45, -73, 46]);
    expect(bboxToExtent([-74, 45, 0, -73, 46, 100])).toEqual([-74, 45, -73, 46]);
  });
});
