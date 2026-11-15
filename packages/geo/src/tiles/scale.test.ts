import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { PMTiles, type RangeResponse, type Source } from "pmtiles";
import { describe, expect, it } from "vitest";

import { FsStore } from "../storage/fs-store.js";

import { tilesArchiveKey, ensureTilesArchive, readTilesCurrent } from "./archive.js";
import { buildLayerTiles, layerTilesToPmtiles, LayerTilesBuilder, writeSpooledPmtiles, type SourceFeature } from "./build.js";
import { simplifyFlat, type FlatRings } from "./flat.js";
import { projectRing, quantizeRing, simplifyLayer, type QPolygon } from "./geometry.js";
import { LOTS_PROFILE } from "./profiles.js";
import { FileSpool, MemorySpool } from "./spool.js";

const LON0 = -73.72;
const LAT0 = 46.04;
const DLAT = 20 / 111_320;
const DLON = 20 / (111_320 * Math.cos((LAT0 * Math.PI) / 180));

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * n × n lots sharing jittered borders (every border's intermediate vertices are
 * shared by both lots), generated lazily so a large layer is never one array.
 */
function* jitteredLots(n: number, perEdge = 3): Generator<SourceFeature> {
  const rnd = lcg(5);
  const h = new Map<string, [number, number][]>();
  const edge = (a: [number, number], b: [number, number], horizontal: boolean): [number, number][] => {
    const key = `${a.join()}|${b.join()}`;
    const rev = `${b.join()}|${a.join()}`;
    if (h.has(rev)) {
      const pts = [...h.get(rev)!].reverse();
      h.delete(rev); // each border is used twice: free it after the second use
      return pts;
    }
    const pts: [number, number][] = [];
    for (let k = 1; k <= perEdge; k++) {
      const t = k / (perEdge + 1);
      const off = (rnd() - 0.5) * 2;
      pts.push([
        a[0] + (b[0] - a[0]) * t + (horizontal ? 0 : off * (DLON / 20)),
        a[1] + (b[1] - a[1]) * t + (horizontal ? off * (DLAT / 20) : 0),
      ]);
    }
    h.set(key, pts);
    return pts;
  };
  const node = (i: number, j: number): [number, number] => [LON0 + i * DLON, LAT0 + j * DLAT];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const sw = node(i, j);
      const se = node(i + 1, j);
      const ne = node(i + 1, j + 1);
      const nw = node(i, j + 1);
      const ring = [sw, ...edge(sw, se, true), se, ...edge(se, ne, false), ne, ...edge(ne, nw, true), nw, ...edge(nw, sw, false), sw];
      yield {
        type: "Feature",
        properties: { noLot: String(1_000_000 + j * n + i), zone_code: `Z-${(i + j) % 7}` },
        geometry: { type: "Polygon", coordinates: [ring] },
      };
    }
  }
}

function flatten(layer: QPolygon[][]): { rings: FlatRings; keep: Uint8Array } {
  const coords: number[] = [];
  const starts = [0];
  for (const f of layer) for (const p of f) for (const r of p) {
    coords.push(...r);
    starts.push(coords.length / 2);
  }
  return { rings: { coords: Int32Array.from(coords), ringStart: Uint32Array.from(starts) }, keep: new Uint8Array(starts.length - 1).fill(1) };
}

describe("simplifyFlat (compact, partitioned) = simplifyLayer (reference)", () => {
  const lots = [...jitteredLots(20)];
  const q: QPolygon[][] = lots.map((f) => [(f.geometry!.coordinates as number[][][]).map((r) => quantizeRing(projectRing(r), 4096 * 2 ** 16))]);

  for (const partitionVertices of [2 ** 21, 1000, 97]) {
    it(`same rings and junctions with ${partitionVertices} vertices per partition`, () => {
      const ref = simplifyLayer(q, 6, true);
      const { rings, keep } = flatten(q);
      const got = simplifyFlat(rings, keep, 6, true, { partitionVertices });
      expect(got.stats.junctions).toBe(ref.stats.junctions);
      expect(got.stats.verticesOut).toBe(ref.stats.verticesOut);
      expect(got.stats.fallbackRings).toBe(ref.stats.fallbackRings);
      if (partitionVertices < 2 ** 21) expect(got.stats.partitions).toBeGreaterThan(1);
      const refFlat = flatten(ref.layer).rings;
      expect(Array.from(got.rings.coords)).toEqual(Array.from(refFlat.coords));
      expect(Array.from(got.rings.ringStart)).toEqual(Array.from(refFlat.ringStart));
      got.release();
    });
  }

  it("per-ring mode and tolerance 0 match too", () => {
    const { rings, keep } = flatten(q);
    expect(Array.from(simplifyFlat(rings, keep, 6, false).rings.coords)).toEqual(Array.from(flatten(simplifyLayer(q, 6, false).layer).rings.coords));
    expect(simplifyFlat(rings, keep, 0, true).rings).toBe(rings);
  });

  it("rings not kept come out empty and do not create junctions", () => {
    const { rings, keep } = flatten(q);
    keep[0] = 0;
    const got = simplifyFlat(rings, keep, 6, true);
    expect(got.rings.ringStart[1]).toBe(0);
  });
});

class BufferSource implements Source {
  constructor(private readonly buf: Uint8Array) {}
  getKey(): string {
    return "memory";
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const slice = this.buf.slice(offset, offset + length);
    return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) };
  }
}

describe("spooled build", () => {
  it("the archive streamed from a file spool is byte-identical to the in-memory one, whatever the partitions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tiles-spool-"));
    try {
      const inMemory = layerTilesToPmtiles(buildLayerTiles(jitteredLots(15), LOTS_PROFILE, { citySlug: "x" }), { name: "n" });

      const builder = new LayerTilesBuilder(LOTS_PROFILE, { citySlug: "x", partitionVertices: 500 });
      for (const f of jitteredLots(15)) builder.add(f);
      const spool = new FileSpool(join(dir, "s"));
      const built = await builder.buildToSpool(spool);
      expect(built.zooms.some((z) => z.partitions > 1)).toBe(true);
      // No empty tile is stored (a tile whose candidates all clip to nothing is served 204).
      expect(built.records.every((r) => r.bytes > 0)).toBe(true);
      const chunks: Uint8Array[] = [];
      const size = writeSpooledPmtiles(built, spool, (c) => chunks.push(c.slice()), { name: "n" });
      spool.close();
      const streamed = Buffer.concat(chunks);
      expect(size).toBe(streamed.length);
      expect(Buffer.from(streamed).equals(Buffer.from(inMemory))).toBe(true);

      const pm = new PMTiles(new BufferSource(streamed), undefined, async (b, c) => (c === 2 ? gunzipSync(new Uint8Array(b)).buffer : b));
      expect((await pm.getHeader()).maxZoom).toBe(15);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("re-encodes a tile when a feature only survives as a marker, without duplicating it", () => {
    // A sliver: wide but thinner than a z12 unit, straddling a tile edge.
    const built = buildLayerTiles(
      [
        {
          properties: { noLot: "1" },
          geometry: { type: "Polygon", coordinates: [[[LON0, LAT0], [LON0 + 50 * DLON, LAT0], [LON0 + 50 * DLON, LAT0 + DLAT / 400], [LON0, LAT0]]] },
        },
      ],
      LOTS_PROFILE,
      { minZoom: 12, maxZoom: 12 },
    );
    expect(built.zooms[0]!.missing).toBe(0);
    expect(built.zooms[0]!.featuresPresent).toBe(1);
  });

  it("memory-bounded: a 40 000-lot layer is held compactly and its tiles never accumulate in memory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tiles-mem-"));
    try {
      const n = 200;
      const builder = new LayerTilesBuilder(LOTS_PROFILE, { citySlug: "big", partitionVertices: 50_000 });
      for (const f of jitteredLots(n)) builder.add(f);
      // 16 vertices per lot after dedupe → ≈ 8 B per vertex + a few bytes per ring/feature/column.
      const perLot = builder.compactBytes / (n * n);
      expect(perLot).toBeLessThan(400);

      global.gc?.();
      const heap0 = process.memoryUsage().heapUsed;
      let heapPeak = heap0;
      const timer = setInterval(() => {
        heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
      }, 5);
      const spool = new FileSpool(join(dir, "s"));
      let built;
      try {
        built = await builder.buildToSpool(spool);
      } finally {
        clearInterval(timer);
        spool.close();
      }
      expect(built.features).toBe(n * n);
      expect(built.zooms.map((z) => z.missing)).toEqual([0, 0, 0, 0]);
      expect(built.zooms.some((z) => z.partitions > 1)).toBe(true);
      // Records only (no tile bytes) are kept; the bytes are in the spool file.
      expect(spool.size).toBeGreaterThanOrEqual(built.records.reduce((s, r) => s + r.length, 0));
      expect(built.records.every((r) => typeof r.offset === "number" && !("gzip" in r))).toBe(true);
      // JS heap growth stays far below the layer's tile bytes × zooms: one tile at a time.
      expect(heapPeak - heap0).toBeLessThan(200 * 2 ** 20);
      // The builder released its compact source.
      expect(builder.compactBytes).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("publication goes through the file spool and Store.putFile (FsStore)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tiles-fs-"));
    try {
      const store = new FsStore(join(dir, "store"));
      const features = [...jitteredLots(10)];
      await store.put("qc-lots/qc-lots-x.geojson", JSON.stringify({ type: "FeatureCollection", features }));
      const r = await ensureTilesArchive(store, "qc-lots-x", "qc-lots/qc-lots-x.geojson", { tmpDir: dir });
      expect(r.action).toBe("built");
      const archive = await readFile(join(dir, "store", tilesArchiveKey("qc-lots-x", r.version!)));
      const manifest = (await readTilesCurrent(store, "qc-lots-x"))!;
      expect(manifest.archive.bytes).toBe(archive.length);
      expect(manifest.features).toBe(100);
      // Only the store remains: the temporary build directory is gone.
      const { readdir } = await import("node:fs/promises");
      expect((await readdir(dir)).sort()).toEqual(["store"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("memory spool and file spool give the same records", async () => {
    const a = new LayerTilesBuilder(LOTS_PROFILE, {});
    const b = new LayerTilesBuilder(LOTS_PROFILE, {});
    for (const f of jitteredLots(5)) {
      a.add(f);
      b.add(f);
    }
    const mem = await a.buildToSpool(new MemorySpool());
    const dir = await mkdtemp(join(tmpdir(), "tiles-eq-"));
    try {
      const spool = new FileSpool(join(dir, "s"));
      const file = await b.buildToSpool(spool);
      spool.close();
      expect(file.records.map((r) => r.hash)).toEqual(mem.records.map((r) => r.hash));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
