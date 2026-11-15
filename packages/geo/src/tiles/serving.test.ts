import { gunzipSync } from "node:zlib";

import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../api/app.js";
import { StoreProvider } from "../api/providers/store-provider.js";
import { publishDisplayMirror } from "../display/publish.js";
import { prewarmDisplayMirrors } from "../display/prewarm.js";
import { storeExitCode } from "../display/prewarm-cli.js";
import type { ByteStream, GetStreamOptions, ObjectStat, Store } from "../storage/index.js";

import {
  buildTilesArchive,
  ensureTilesArchive,
  parseTilesManifest,
  readTilesCurrent,
  tilesArchiveKey,
  tilesCurrentKey,
  tilesManifestKey,
  TilesTooLargeError,
} from "./archive.js";
import { lonLatToWorld } from "./geometry.js";
import { writePmtiles } from "./pmtiles.js";
import { HEADER_AND_ROOT_BYTES } from "./pmtiles-reader.js";
import { TileService } from "./service.js";

/** ETags unique across stores: a copied object gets a NEW ETag, like a bucket mirror. */
let writes = 0;

/** In-memory store that counts what is read, and how. */
class RangeStore implements Store {
  readonly objects = new Map<string, { body: Uint8Array; etag: string }>();
  /** Bytes returned by getRange, per key. */
  readonly rangeBytes = new Map<string, number>();
  readonly rangeCalls: Array<{ key: string; offset: number; length: number }> = [];
  /** Whole-object reads (get / getStream), per key. */
  readonly wholeReads = new Map<string, number>();

  async put(key: string, body: Uint8Array | string): Promise<void> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body.slice();
    this.objects.set(key, { body: bytes, etag: `"e${++writes}"` });
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    this.wholeReads.set(key, (this.wholeReads.get(key) ?? 0) + 1);
    return this.objects.get(key)?.body;
  }
  async getStream(key: string, _opts?: GetStreamOptions): Promise<ByteStream | undefined> {
    const o = this.objects.get(key);
    if (!o) return undefined;
    this.wholeReads.set(key, (this.wholeReads.get(key) ?? 0) + 1);
    return (async function* () {
      // Several chunks, like a real body.
      for (let i = 0; i < o.body.length; i += 4096) yield o.body.subarray(i, i + 4096);
    })();
  }
  async getRange(key: string, offset: number, length: number): Promise<Uint8Array | undefined> {
    const o = this.objects.get(key);
    if (!o) return undefined;
    const out = o.body.slice(offset, offset + length);
    this.rangeCalls.push({ key, offset, length });
    this.rangeBytes.set(key, (this.rangeBytes.get(key) ?? 0) + out.length);
    return out;
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
  async copyTo(into: RangeStore): Promise<void> {
    for (const [key, o] of this.objects) await into.put(key, o.body);
  }
}

// n × n square lots of ~20 m near Rawdon, sharing their corners.
const LON0 = -73.72;
const LAT0 = 46.04;
const DLAT = 20 / 111_320;
const DLON = 20 / (111_320 * Math.cos((LAT0 * Math.PI) / 180));

function lotsFc(n: number, noLot: (i: number) => unknown = (i) => `5 530 ${String(i).padStart(3, "0")}`): string {
  const features = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = LON0 + i * DLON;
      const y = LAT0 + j * DLAT;
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[[x, y], [x + DLON, y], [x + DLON, y + DLAT], [x, y + DLAT], [x, y]]] },
        properties: { noLot: noLot(k), zone_code: `Z-${j % 3}`, adresse: "secret", priorite: 1 },
      });
    }
  }
  return JSON.stringify({ type: "FeatureCollection", features });
}

const LOTS = "qc-lots-rawdon";
const LOTS_KEY = "qc-lots/qc-lots-rawdon.geojson";

/** z/x/y of the tile holding (lon, lat). */
function tileOf(lon: number, lat: number, z: number): [number, number] {
  const [wx, wy] = lonLatToWorld(lon, lat);
  return [Math.floor(wx * 2 ** z), Math.floor(wy * 2 ** z)];
}

async function seeded(n = 6): Promise<RangeStore> {
  const store = new RangeStore();
  await store.put(LOTS_KEY, lotsFc(n));
  return store;
}

function decode(raw: Uint8Array): VectorTile {
  return new VectorTile(new PbfReader(raw));
}

afterEach(() => vi.restoreAllMocks());

describe("tile archive publication", () => {
  it("builds the archive, then the manifest, then flips current.json; second call is fresh", async () => {
    const store = await seeded();
    const order: string[] = [];
    const put = store.put.bind(store);
    store.put = async (key, body) => {
      order.push(key);
      return put(key, body);
    };
    const first = await ensureTilesArchive(store, LOTS, LOTS_KEY, { now: () => new Date("2026-11-15T00:00:00Z") });
    expect(first).toMatchObject({ action: "built", reason: "no-archive" });
    const version = first.version!;
    expect(order).toEqual([tilesArchiveKey(LOTS, version), tilesManifestKey(LOTS, version), tilesCurrentKey(LOTS)]);
    expect(tilesArchiveKey(LOTS, version)).toBe(`_tiles/${LOTS}/${version}/${LOTS}.pmtiles`);
    const manifest = (await readTilesCurrent(store, LOTS))!;
    expect(manifest).toMatchObject({
      profile: "tiles-v1",
      version,
      collection: LOTS,
      layer: "lots",
      source_key: LOTS_KEY,
      features: 36,
      minzoom: 12,
      maxzoom: 15,
      ids: { rule: "noLot", fromNoLot: 36, missingNoLot: 0, nonNumericNoLot: 0, duplicateNoLot: 0 },
    });
    expect(manifest.zooms.map((z) => z.missing)).toEqual([0, 0, 0, 0]);
    expect(manifest.archive.bytes).toBe(store.objects.get(tilesArchiveKey(LOTS, version))!.body.length);
    expect(await ensureTilesArchive(store, LOTS, LOTS_KEY)).toMatchObject({ action: "fresh", version });
  });

  it("adopts a copied archive of the same source bytes (new ETags) without building", async () => {
    const prod = await seeded();
    const built = await ensureTilesArchive(prod, LOTS, LOTS_KEY);
    const preprod = new RangeStore();
    await prod.copyTo(preprod);
    const before = preprod.objects.get(tilesArchiveKey(LOTS, built.version!))!.etag;
    const r = await ensureTilesArchive(preprod, LOTS, LOTS_KEY);
    expect(r).toMatchObject({ action: "adopted", reason: "source-changed", version: built.version });
    // Archive untouched, only the pointer re-stamped with the preprod ETag.
    expect(preprod.objects.get(tilesArchiveKey(LOTS, built.version!))!.etag).toBe(before);
    expect((await readTilesCurrent(preprod, LOTS))!.source_etag).toBe((await preprod.stat(LOTS_KEY))!.etag);
    expect(await ensureTilesArchive(preprod, LOTS, LOTS_KEY)).toMatchObject({ action: "fresh" });
  });

  it("reports needs-build without building, and rebuilds a new version when the source changes", async () => {
    const store = await seeded();
    expect(await ensureTilesArchive(store, LOTS, LOTS_KEY, { build: false })).toMatchObject({ action: "needs-build", reason: "no-archive" });
    expect(await store.has(tilesCurrentKey(LOTS))).toBe(false);
    const v1 = (await ensureTilesArchive(store, LOTS, LOTS_KEY)).version;
    await store.put(LOTS_KEY, lotsFc(4));
    const r = await ensureTilesArchive(store, LOTS, LOTS_KEY);
    expect(r).toMatchObject({ action: "built", reason: "source-changed" });
    expect(r.version).not.toBe(v1);
    expect((await readTilesCurrent(store, LOTS))!.features).toBe(16);
  });

  it("too large: refused before any write, with reason too-large", async () => {
    const store = await seeded();
    const err = await buildTilesArchive(store, LOTS, LOTS_KEY, { maxFeatures: 10 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TilesTooLargeError);
    expect((err as TilesTooLargeError).reason).toBe("too-large");
    expect([...store.objects.keys()].filter((k) => k.startsWith("_tiles/"))).toEqual([]);
    const err2 = await buildTilesArchive(store, LOTS, LOTS_KEY, { maxFeatureBytes: 100 }).catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(TilesTooLargeError);
  });

  it("an aborted build never flips current.json", async () => {
    const store = await seeded();
    const controller = new AbortController();
    const put = store.put.bind(store);
    store.put = async (key, body) => {
      await put(key, body);
      if (key.endsWith(".pmtiles")) controller.abort(new Error("deadline"));
    };
    await expect(buildTilesArchive(store, LOTS, LOTS_KEY, { signal: controller.signal })).rejects.toThrow("deadline");
    expect(await store.has(tilesCurrentKey(LOTS))).toBe(false);
  });

  it("rejects a collection without a tile profile", async () => {
    const store = await seeded();
    await expect(buildTilesArchive(store, "qc-zonage-norms-rawdon", LOTS_KEY)).rejects.toThrow(/no tile profile/);
  });
});

describe("writer hook and prewarm", () => {
  it("the display writer hook also publishes the tile archive (and can be told not to)", async () => {
    const store = await seeded();
    const log = vi.fn();
    const outcome = await publishDisplayMirror(store, LOTS_KEY, { log });
    expect(outcome).toMatchObject({ status: "built", collection: LOTS, tiles: { status: "built", collection: LOTS } });
    expect(await readTilesCurrent(store, LOTS)).toBeDefined();

    const other = await seeded();
    const off = await publishDisplayMirror(other, LOTS_KEY, { log, tiles: false });
    expect(off.tiles).toBeUndefined();
    expect(await other.has(tilesCurrentKey(LOTS))).toBe(false);
  });

  it("a tile failure is reported loudly and never thrown nor blocks the display mirror", async () => {
    const store = await seeded();
    const put = store.put.bind(store);
    store.put = async (key, body) => {
      if (key.startsWith("_tiles/")) throw new Error("AccessDenied");
      return put(key, body);
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await publishDisplayMirror(store, LOTS_KEY, { log: () => {} });
    expect(outcome.status).toBe("built");
    expect(outcome.tiles).toMatchObject({ status: "failed", error: "AccessDenied" });
    expect(errors.mock.calls.some((c) => String(c[0]).includes("TILES_ARCHIVE_PUBLISH_FAILED"))).toBe(true);
  });

  it("prewarm ensures display and tiles; a too-large tile source does not fail the sweep", async () => {
    const store = await seeded();
    await store.put("ca-qc-zonage/qc-zonage-rawdon.geojson", lotsFc(2, () => null).replaceAll('"zone_code"', '"zone"'));
    const report = await prewarmDisplayMirrors(
      store,
      [
        { collection: LOTS, sourceKey: LOTS_KEY },
        { collection: "qc-zonage-rawdon", sourceKey: "ca-qc-zonage/qc-zonage-rawdon.geojson" },
      ],
      {},
    );
    expect(report.counts.built).toBe(2);
    expect(report.tilesCounts.built).toBe(2);
    const again = await prewarmDisplayMirrors(store, [{ collection: LOTS, sourceKey: LOTS_KEY }], { display: false });
    expect(again.counts.skipped).toBe(1);
    expect(again.tilesCounts.fresh).toBe(1);

    // too-large: recorded, exit 0; any other tile failure: exit 1.
    const tooLarge = { collection: LOTS, sourceKey: LOTS_KEY, action: "fresh" as const, ms: 0, tiles: { action: "failed" as const, reason: "too-large", ms: 0 } };
    const broken = { ...tooLarge, tiles: { action: "failed" as const, error: "boom", ms: 0 } };
    expect(storeExitCode([], [], [tooLarge])).toBe(0);
    expect(storeExitCode([], [], [broken])).toBe(1);
  });

  it("prewarm --no-tiles leaves tiles alone", async () => {
    const store = await seeded();
    const report = await prewarmDisplayMirrors(store, [{ collection: LOTS, sourceKey: LOTS_KEY }], { tiles: false });
    expect(report.tilesCounts.built).toBe(0);
    expect(await store.has(tilesCurrentKey(LOTS))).toBe(false);
  });
});

describe("GET /tiles", () => {
  async function served(n = 6): Promise<{ store: RangeStore; app: ReturnType<typeof createApp>; version: string }> {
    const store = await seeded(n);
    const { version } = await ensureTilesArchive(store, LOTS, LOTS_KEY);
    store.rangeCalls.length = 0;
    store.rangeBytes.clear();
    store.wholeReads.clear();
    return { store, app: createApp(new StoreProvider(store)), version: version! };
  }

  const [x12, y12] = tileOf(LON0 + DLON, LAT0 + DLAT, 12);

  it("200: one tile by byte ranges, gzip as stored, MVT media type, immutable with ?v=", async () => {
    const { store, app, version } = await served();
    const res = await app.request(`/tiles/${LOTS}/12/${x12}/${y12}.mvt?v=${version}`, { headers: { "Accept-Encoding": "br, gzip" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.mapbox-vector-tile");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe(`"${version}-12-${x12}-${y12}"`);
    expect(res.headers.get("x-geo-tiles-version")).toBe(version);
    expect(res.headers.get("x-geo-tiles-stale")).toBeNull();
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    // Gzip exactly once (not re-encoded by the JSON compression middleware).
    const raw = gunzipSync(new Uint8Array(await res.arrayBuffer()));
    const layer = decode(raw).layers.lots!;
    expect(layer.length).toBe(36);
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      expect(f.id).toBeGreaterThanOrEqual(5530000);
      expect(Object.keys(f.properties)).toEqual(["zoneCode"]); // z12 tier
    }

    const archiveKey = tilesArchiveKey(LOTS, version);
    const archiveSize = store.objects.get(archiveKey)!.body.length;
    expect(store.wholeReads.get(archiveKey)).toBeUndefined();
    // Header + root in one range, then the tile's own range.
    expect(store.rangeCalls.map((c) => c.key)).toEqual([archiveKey, archiveKey]);
    expect(store.rangeCalls[0]).toMatchObject({ offset: 0, length: HEADER_AND_ROOT_BYTES });
    const tileBytes = store.rangeCalls[1]!.length;
    expect(store.rangeBytes.get(archiveKey)).toBeLessThanOrEqual(Math.min(archiveSize, HEADER_AND_ROOT_BYTES) + tileBytes);

    // Second tile of the same version: header and root are cached, one range only.
    store.rangeCalls.length = 0;
    const res2 = await app.request(`/tiles/${LOTS}/15/${tileOf(LON0 + DLON, LAT0 + DLAT, 15).join("/")}.mvt`);
    expect(res2.status).toBe(200);
    expect(store.rangeCalls).toHaveLength(1);
    expect(store.rangeCalls[0]!.offset).toBeGreaterThan(0);
  });

  it("z14+ tiles carry the full whitelist, noLot as a string; never immo-computed properties", async () => {
    const { app } = await served();
    const [x, y] = tileOf(LON0 + DLON, LAT0 + DLAT, 14);
    const res = await app.request(`/tiles/${LOTS}/14/${x}/${y}.mvt`, { headers: { "Accept-Encoding": "gzip" } });
    const layer = decode(gunzipSync(new Uint8Array(await res.arrayBuffer()))).layers.lots!;
    const f = layer.feature(0);
    expect(Object.keys(f.properties).sort()).toEqual(["citySlug", "noLot", "zoneCode"]);
    expect(typeof f.properties.noLot).toBe("string");
    expect(Number(String(f.properties.noLot).replace(/\s/g, ""))).toBe(f.id);
  });

  it("a client that does not accept gzip gets the inflated tile", async () => {
    const { app } = await served();
    const res = await app.request(`/tiles/${LOTS}/12/${x12}/${y12}.mvt`, { headers: { "Accept-Encoding": "identity" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(decode(new Uint8Array(await res.arrayBuffer())).layers.lots!.length).toBe(36);
  });

  it("304 on If-None-Match without reading the tile; a stale ?v= gets the short max-age", async () => {
    const { store, app, version } = await served();
    const etag = `"${version}-12-${x12}-${y12}"`;
    await app.request(`/tiles/${LOTS}/12/${x12}/${y12}.mvt`); // warm the header
    store.rangeCalls.length = 0;
    const res = await app.request(`/tiles/${LOTS}/12/${x12}/${y12}.mvt?v=${version}`, { headers: { "If-None-Match": etag } });
    expect(res.status).toBe(304);
    expect(store.rangeCalls).toHaveLength(0);
    const old = await app.request(`/tiles/${LOTS}/12/${x12}/${y12}.mvt?v=0000000000000000`);
    expect(old.status).toBe(200);
    expect(old.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("204 for an empty tile inside the zoom range; 404 outside it, for unknown or untiled collections, without an archive", async () => {
    const { app, store } = await served();
    const empty = await app.request(`/tiles/${LOTS}/12/0/0.mvt`);
    expect(empty.status).toBe(204);
    expect(await empty.arrayBuffer()).toHaveProperty("byteLength", 0);

    expect((await app.request(`/tiles/${LOTS}/11/0/0.mvt`)).status).toBe(404);
    expect((await app.request(`/tiles/${LOTS}/16/0/0.mvt`)).status).toBe(404);
    expect((await app.request(`/tiles/${LOTS}/12/4096/0.mvt`)).status).toBe(404);
    expect((await app.request(`/tiles/${LOTS}/12/1/1.pbf`)).status).toBe(404);
    expect((await app.request(`/tiles/${LOTS}/12/a/1.mvt`)).status).toBe(400);
    expect((await app.request(`/tiles/qc-lots-nowhere/12/0/0.mvt`)).status).toBe(404);

    await store.put("qc-regions/qc-regions.geojson", lotsFc(1));
    await store.put("ca-qc-zonage/qc-zonage-rawdon.geojson", lotsFc(1));
    const fresh = createApp(new StoreProvider(store));
    const untiled = await fresh.request(`/tiles/qc-regions/12/0/0.mvt`);
    expect(untiled.status).toBe(404);
    expect(((await untiled.json()) as { code: string }).code).toBe("NotFound");
    // A tiled collection whose archive is not published: explicit, never built here.
    const none = await fresh.request(`/tiles/qc-zonage-rawdon/12/0/0.mvt`);
    expect(none.status).toBe(404);
    expect(((await none.json()) as { code: string }).code).toBe("TilesUnavailable");
    expect(await store.has(tilesCurrentKey("qc-zonage-rawdon"))).toBe(false);
  });

  it("503 TilesUnavailable when the archive cannot be read", async () => {
    const { app, store, version } = await served();
    store.objects.delete(tilesArchiveKey(LOTS, version));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app.request(`/tiles/${LOTS}/12/${x12}/${y12}.mvt`);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("TilesUnavailable");
  });

  it("flags a stale archive (source changed after the build) and keeps serving it", async () => {
    const { app, store, version } = await served();
    await store.put(LOTS_KEY, lotsFc(3));
    const res = await createApp(new StoreProvider(store)).request(`/tiles/${LOTS}/12/${x12}/${y12}.mvt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-geo-tiles-stale")).toBe("1");
    expect(res.headers.get("x-geo-tiles-version")).toBe(version);
    void app;
  });

  it("TileJSON: no-cache, carries the version, tile URLs pinned with ?v=, 304 on revalidation", async () => {
    const { app, version } = await served();
    const res = await app.request(`http://geo.test/tiles/${LOTS}.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x-geo-tiles-version")).toBe(version);
    const tj = (await res.json()) as Record<string, unknown>;
    expect(tj).toMatchObject({
      tilejson: "3.0.0",
      name: LOTS,
      tiles: [`http://geo.test/tiles/${LOTS}/{z}/{x}/{y}.mvt?v=${version}`],
      minzoom: 12,
      maxzoom: 15,
      tiles_version: version,
      vector_layers: [{ id: "lots", minzoom: 12, maxzoom: 15 }],
    });
    const etag = res.headers.get("etag")!;
    expect((await app.request(`/tiles/${LOTS}.json`, { headers: { "If-None-Match": etag } })).status).toBe(304);
    expect((await app.request(`/tiles/qc-lots-nowhere.json`)).status).toBe(404);
    expect((await app.request(`/tiles/${LOTS}.xml`)).status).toBe(404);
  });
});

describe("TileService over an archive with leaf directories", () => {
  it("reads a leaf once (cached), then only tile ranges; bytes read stay far below the archive", async () => {
    const store = new RangeStore();
    // Irregular ids and sizes: the directory does not compress under 16 KiB.
    let seed = 7;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const tiles: Array<{ z: number; x: number; y: number; data: Uint8Array }> = [];
    let pos = 0;
    for (let i = 0; i < 40_000; i++) {
      pos += 1 + Math.floor(rnd() * 5);
      const data = new Uint8Array(3 + Math.floor(rnd() * 200));
      data[0] = i & 255;
      data[1] = (i >> 8) & 255;
      data[2] = (i >> 16) & 255;
      tiles.push({ z: 14, x: pos % 16_384, y: Math.floor(pos / 16_384), data });
    }
    const archive = writePmtiles(tiles, { tileCompression: 1, tileType: 1, minZoom: 14, maxZoom: 14, bounds: [-74, 45, -73, 46], metadata: {} });
    const key = tilesArchiveKey(LOTS, "v1");
    await store.put(key, archive);
    const manifest = parseTilesManifest(JSON.stringify({ version: "v1", profile: "tiles-v1", source_key: LOTS_KEY, minzoom: 14, maxzoom: 14 }))!;
    const service = new TileService(store);
    const a = tiles[100]!;
    const b = tiles[101]!;
    const t = await service.tile(LOTS, manifest, 14, a.x, a.y);
    expect(Array.from(t!.data)).toEqual(Array.from(a.data));
    // header+root, leaf, tile
    expect(store.rangeCalls).toHaveLength(3);
    store.rangeCalls.length = 0;
    const t2 = await service.tile(LOTS, manifest, 14, b.x, b.y);
    expect(Array.from(t2!.data)).toEqual(Array.from(b.data));
    expect(store.rangeCalls).toHaveLength(1);
    expect(await service.tile(LOTS, manifest, 14, 0, 15_000)).toBeUndefined();
    expect(store.rangeBytes.get(key)!).toBeLessThan(archive.length / 4);
    expect(store.wholeReads.get(key)).toBeUndefined();
  });
});
