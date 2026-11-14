import { brotliDecompressSync, gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { Position } from "@sentropic/geo-core";

import { createApp } from "../api/app.js";
import { StoreProvider } from "../api/providers/store-provider.js";
import type { ByteStream, ObjectStat, Store } from "../storage/index.js";

import { artifactKey, buildDisplayMirror, currentKey, displayGeometry, DISPLAY_PROFILE } from "./mirror.js";
import { isSimpleRing } from "./ring.js";

/** In-memory store with stat (etag = write counter) and streaming reads. */
class MemStore implements Store {
  readonly objects = new Map<string, { body: Uint8Array; etag: string }>();
  puts = 0;
  failPuts = false;
  #writes = 0;

  async put(key: string, body: Uint8Array | string): Promise<void> {
    if (this.failPuts) throw new Error("AccessDenied");
    this.puts++;
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    this.objects.set(key, { body: bytes, etag: `"e${++this.#writes}"` });
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    return this.objects.get(key)?.body;
  }
  async getStream(key: string): Promise<ByteStream | undefined> {
    const o = this.objects.get(key);
    if (!o) return undefined;
    return (async function* () {
      // Two chunks, so features straddle a chunk boundary.
      const mid = Math.floor(o.body.byteLength / 2);
      yield o.body.subarray(0, mid);
      yield o.body.subarray(mid);
    })();
  }
  async stat(key: string): Promise<ObjectStat | undefined> {
    const o = this.objects.get(key);
    return o ? { etag: o.etag, size: o.body.byteLength } : undefined;
  }
  async has(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  async list(prefix = ""): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

const SQUARE: Position[] = [
  [-73.1234567, 45.1234567],
  [-73.1134567, 45.1234567],
  [-73.1134567, 45.1334567],
  [-73.1234567, 45.1334567],
  [-73.1234567, 45.1234567],
];
// Two non-adjacent tips 2e-7 apart: simple when exact, touching once rounded to 6 decimals.
const PINCHED: Position[] = [
  [0, 0],
  [1, 0],
  [0.5, 0.4999999],
  [1, 1],
  [0, 1],
  [0.5, 0.5000001],
  [0, 0],
];

function collection(features: unknown[]): string {
  return JSON.stringify({ type: "FeatureCollection", features });
}

const LOTS = collection([
  { type: "Feature", id: "ca/qc/lot/1", geometry: { type: "Polygon", coordinates: [SQUARE] }, properties: { noLot: "1", zoneCode: "H-1" } },
  { type: "Feature", id: "ca/qc/lot/2", geometry: { type: "Polygon", coordinates: [PINCHED] }, properties: { noLot: "2" } },
  { type: "Feature", id: "ca/qc/lot/3", geometry: null, properties: { noLot: "3" } },
]);

function decode(bytes: Uint8Array, encoding: "br" | "gzip"): Record<string, unknown> {
  const raw = encoding === "br" ? brotliDecompressSync(bytes) : gunzipSync(bytes);
  return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
}

describe("isSimpleRing", () => {
  it("accepts a square and rejects a bowtie and a self-touch", () => {
    expect(isSimpleRing(SQUARE)).toBe(true);
    expect(isSimpleRing([[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]])).toBe(false);
    expect(isSimpleRing(PINCHED)).toBe(true);
    expect(isSimpleRing(PINCHED.map(([x, y]) => [x, Math.round(y * 1e6) / 1e6] as Position))).toBe(false);
  });
  it("handles a large ring", () => {
    const n = 20000;
    const circle: Position[] = Array.from({ length: n }, (_, i) => [
      Math.cos((2 * Math.PI * i) / n),
      Math.sin((2 * Math.PI * i) / n),
    ]);
    circle.push(circle[0]!);
    expect(isSimpleRing(circle)).toBe(true);
  });
});

describe("displayGeometry", () => {
  it("rounds a geometry that stays valid", () => {
    const out = displayGeometry({ type: "Polygon", coordinates: [SQUARE] });
    expect(out.precision).toBe(6);
    expect(out.geometry).toEqual({
      type: "Polygon",
      coordinates: [SQUARE.map(([x, y]) => [Math.round(x! * 1e6) / 1e6, Math.round(y! * 1e6) / 1e6])],
    });
  });
  it("retries at a finer precision when 6 decimals would break a ring", () => {
    const g = { type: "Polygon" as const, coordinates: [PINCHED] };
    const out = displayGeometry(g);
    expect(out.precision).toBe(7); // tips 2e-7 apart stay distinct at 7 decimals
    expect(out.geometry).toEqual(g); // these coordinates already have <= 7 decimals
  });
  it("keeps the exact geometry when every precision breaks a ring", () => {
    // Tips 2e-9 apart: they collapse at 6, 7 and 8 decimals.
    const tight: Position[] = PINCHED.map(([x, y]) => [x!, y === 0.4999999 ? 0.499999999 : y === 0.5000001 ? 0.500000001 : y!]);
    const g = { type: "Polygon" as const, coordinates: [tight] };
    expect(isSimpleRing(tight)).toBe(true);
    expect(displayGeometry(g)).toEqual({ geometry: g, precision: null });
  });
  it("does not blame the rounding for a ring already invalid in the source", () => {
    const bowtie: Position[] = [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]];
    expect(displayGeometry({ type: "Polygon", coordinates: [bowtie] }).precision).toBe(6);
  });
});

describe("buildDisplayMirror", () => {
  it("writes the version then flips current.json, with display and index artifacts", async () => {
    const store = new MemStore();
    await store.put("qc-cadastre-lots/rawdon.geojson", LOTS);
    const order: string[] = [];
    const put = store.put.bind(store);
    store.put = async (key, body) => {
      order.push(key);
      await put(key, body);
    };

    const m = await buildDisplayMirror(store, "qc-lots-rawdon", "qc-cadastre-lots/rawdon.geojson", {
      now: () => new Date("2026-11-14T00:00:00Z"),
    });
    expect(m.profile).toBe(DISPLAY_PROFILE);
    expect(m.features).toBe(3);
    expect(m.precision_counts).toEqual({ "6": 2, "7": 1 }); // null geometry counts as 6
    expect(m.fallback_exact).toBe(0);
    expect(m.source_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.source_etag).toBe('"e1"');
    expect(order[order.length - 1]).toBe(currentKey("qc-lots-rawdon"));

    for (const enc of ["br", "gzip"] as const) {
      const items = decode((await store.get(artifactKey("qc-lots-rawdon", m.version, "items", enc)))!, enc) as {
        features: { id: string; geometry: { coordinates: Position[][] } | null; properties: unknown }[];
        numberMatched: number;
        display: { version: string };
      };
      expect(items.numberMatched).toBe(3);
      expect(items.display.version).toBe(m.version);
      expect(items.features.map((f) => f.id)).toEqual(["ca/qc/lot/1", "ca/qc/lot/2", "ca/qc/lot/3"]);
      expect(items.features[0]!.geometry!.coordinates[0]![0]).toEqual([-73.123457, 45.123457]);
      expect(items.features[1]!.geometry!.coordinates[0]).toEqual(PINCHED); // 7-decimal retry
      expect(items.features[0]!.properties).toEqual({ noLot: "1", zoneCode: "H-1" });

      const index = decode((await store.get(artifactKey("qc-lots-rawdon", m.version, "index", enc)))!, enc) as {
        features: { id: string; geometry: null; bbox: number[] | null; properties: unknown }[];
      };
      expect(index.features[0]).toEqual({
        type: "Feature",
        id: "ca/qc/lot/1",
        geometry: null,
        bbox: [-73.1234567, 45.1234567, -73.1134567, 45.1334567],
        properties: { noLot: "1", zoneCode: "H-1" },
      });
      expect(index.features[2]!.bbox).toBeNull();
    }
  });

  it("derives the version from the source bytes only", async () => {
    const a = new MemStore();
    const b = new MemStore();
    await a.put("s.geojson", LOTS);
    await b.put("other/s.geojson", LOTS);
    const va = (await buildDisplayMirror(a, "c", "s.geojson")).version;
    const vb = (await buildDisplayMirror(b, "c", "other/s.geojson")).version;
    expect(va).toBe(vb);
    await a.put("s.geojson", collection([]));
    expect((await buildDisplayMirror(a, "c", "s.geojson")).version).not.toBe(va);
  });
});

describe("GET /items?profile=display|index", () => {
  function setup() {
    const store = new MemStore();
    void store.put("qc-cadastre-lots/rawdon.geojson", LOTS);
    void store.put(
      "qc-cadastre-lots/rawdon.meta.json",
      JSON.stringify({ datasetId: "qc-lots-rawdon", license: "cc-by-4.0" }),
    );
    const app = createApp(new StoreProvider(store, "", { display: { cacheMs: 0 } }));
    return { store, app };
  }

  it("builds on first request, then serves the stored version with ETag/304", async () => {
    const { store, app } = setup();
    const res = await app.request("/collections/qc-lots-rawdon/items?profile=display&limit=10000", {
      headers: { "Accept-Encoding": "gzip, br" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Encoding")).toBe("br");
    expect(res.headers.get("Content-Type")).toBe("application/geo+json");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    const version = res.headers.get("X-Geo-Display-Version")!;
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    expect(res.headers.get("X-Geo-Display-Stale")).toBeNull();
    const etag = res.headers.get("ETag")!;
    const body = decode(Buffer.from(await res.arrayBuffer()), "br") as { features: unknown[] };
    expect(body.features).toHaveLength(3);

    const putsAfterBuild = store.puts;
    const again = await app.request("/collections/qc-lots-rawdon/items?profile=display", {
      headers: { "Accept-Encoding": "br", "If-None-Match": etag },
    });
    expect(again.status).toBe(304);
    expect(store.puts).toBe(putsAfterBuild); // no rebuild
  });

  it("serves the index profile and inflates for clients without br/gzip", async () => {
    const { app } = setup();
    const res = await app.request("/collections/qc-lots-rawdon/items?profile=index");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Encoding")).toBeNull();
    const body = (await res.json()) as { features: { geometry: unknown; bbox: unknown }[] };
    expect(body.features[0]!.geometry).toBeNull();
    expect(body.features[0]!.bbox).toEqual([-73.1234567, 45.1234567, -73.1134567, 45.1334567]);
  });

  it("flags a stale mirror, rebuilds in the background, then serves the new version", async () => {
    const { store, app } = setup();
    const first = await app.request("/collections/qc-lots-rawdon/items?profile=display", {
      headers: { "Accept-Encoding": "gzip" },
    });
    const v1 = first.headers.get("X-Geo-Display-Version");
    await first.arrayBuffer();

    await store.put("qc-cadastre-lots/rawdon.geojson", collection([]));
    const stale = await app.request("/collections/qc-lots-rawdon/items?profile=display", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(stale.headers.get("X-Geo-Display-Stale")).toBe("1");
    expect(stale.headers.get("X-Geo-Display-Version")).toBe(v1);
    await stale.arrayBuffer();

    let v2: string | null = v1;
    for (let i = 0; i < 50 && v2 === v1; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const r = await app.request("/collections/qc-lots-rawdon/items?profile=display", {
        headers: { "Accept-Encoding": "gzip" },
      });
      v2 = r.headers.get("X-Geo-Display-Version");
      await r.arrayBuffer();
    }
    expect(v2).not.toBe(v1);
  });

  it("rejects unsupported combinations and unknown collections", async () => {
    const { app } = setup();
    for (const q of ["profile=tiles", "profile=display&bbox=0,0,1,1", "profile=display&offset=10", "profile=index&coordPrecision=6"]) {
      expect((await app.request(`/collections/qc-lots-rawdon/items?${q}`)).status, q).toBe(400);
    }
    expect((await app.request("/collections/nope/items?profile=display")).status).toBe(404);
  });

  it("answers 503 when the mirror cannot be built (never the exact geometry)", async () => {
    const { store, app } = setup();
    await new Promise((r) => setTimeout(r, 0));
    store.failPuts = true;
    const res = await app.request("/collections/qc-lots-rawdon/items?profile=display", {
      headers: { "Accept-Encoding": "br" },
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("DisplayUnavailable");
  });

  it("leaves the default /items exact and the mirror keys out of /collections", async () => {
    const { app } = setup();
    await (await app.request("/collections/qc-lots-rawdon/items?profile=display")).arrayBuffer();
    const exact = (await (await app.request("/collections/qc-lots-rawdon/items")).json()) as {
      features: { geometry: { coordinates: Position[][] } }[];
    };
    expect(exact.features[0]!.geometry.coordinates[0]).toEqual(SQUARE);
    const cols = (await (await app.request("/collections")).json()) as { collections: { id: string }[] };
    expect(cols.collections.map((c) => c.id)).toEqual(["qc-lots-rawdon"]);
  });
});
