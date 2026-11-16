import { describe, expect, it } from "vitest";

import { buildLayerTiles, type SourceFeature } from "./build.js";
import { clipRing, clipRingToTiles, ringBBox, tileRange } from "./clip.js";
import { LOTS_PROFILE, ZONES_PROFILE } from "./profiles.js";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A wiggly closed ring around (cx, cy): spikes, back-and-forth runs and far excursions. */
function wigglyRing(rnd: () => number, n: number, cx: number, cy: number, radius: number): Int32Array {
  const out = new Int32Array(2 * n);
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const spike = rnd() < 0.02 ? 2.5 : 1;
    const r = radius * spike * (0.55 + 0.45 * Math.sin(7 * a + 3 * Math.sin(5 * a))) + (rnd() - 0.5) * radius * 0.3;
    out[2 * i] = Math.round(cx + r * Math.cos(a));
    out[2 * i + 1] = Math.round(cy + r * Math.sin(a));
  }
  return out;
}

function perTile(ring: Int32Array, extent: number, buffer: number, tilesPerAxis: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const [tx0, tx1, ty0, ty1] = tileRange(ringBBox(ring), extent, buffer, tilesPerAxis);
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      const ox = tx * extent;
      const oy = ty * extent;
      const c = clipRing(ring, { minX: ox - buffer, minY: oy - buffer, maxX: ox + extent + buffer, maxY: oy + extent + buffer }, ox, oy);
      if (c) out.set(`${tx}/${ty}`, Array.from(c));
    }
  }
  return out;
}

function tiled(ring: Int32Array, extent: number, buffer: number, tilesPerAxis: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const order: string[] = [];
  clipRingToTiles(ring, tileRange(ringBBox(ring), extent, buffer, tilesPerAxis), extent, buffer, (tx, ty, c) => {
    const key = `${tx}/${ty}`;
    expect(out.has(key)).toBe(false);
    out.set(key, Array.from(c));
    order.push(key);
  });
  // Increasing (tx, ty) order.
  const sorted = [...order].sort((a, b) => {
    const [ax, ay] = a.split("/").map(Number);
    const [bx, by] = b.split("/").map(Number);
    return ax! - bx! || ay! - by!;
  });
  expect(order).toEqual(sorted);
  return out;
}

describe("clipRingToTiles = clipRing per tile", () => {
  for (const [seed, n, extent, buffer] of [
    [1, 200, 64, 4],
    [2, 2_000, 32, 2],
    [3, 5_000, 128, 16],
    [4, 50, 16, 0],
    [5, 3_000, 8, 1],
  ] as const) {
    it(`seed ${seed}: ${n} vertices, extent ${extent}, buffer ${buffer}`, () => {
      const rnd = lcg(seed);
      const tilesPerAxis = 64;
      const ring = wigglyRing(rnd, n, 32 * extent, 32 * extent, 20 * extent);
      const want = perTile(ring, extent, buffer, tilesPerAxis);
      const got = tiled(ring, extent, buffer, tilesPerAxis);
      expect(want.size).toBeGreaterThan(0);
      expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
      for (const [k, v] of want) expect(got.get(k), k).toEqual(v);
    });
  }

  it("rings along tile edges, touching corners and clamped at the zoom's border", () => {
    const extent = 16;
    const rings = [
      // Axis-aligned square exactly on tile lines.
      Int32Array.from([16, 16, 48, 16, 48, 48, 16, 48]),
      // Zigzag across a vertical tile line, every vertex on or next to it.
      Int32Array.from([31, 0, 32, 4, 31, 8, 33, 12, 32, 16, 30, 20, 40, 20, 40, 0]),
      // Partly outside the zoom (negative coordinates, beyond the last tile).
      Int32Array.from([-20, -20, 200, -5, 210, 210, -30, 190]),
    ];
    for (const ring of rings) {
      for (const buffer of [0, 1, 4]) {
        const want = perTile(ring, extent, buffer, 8);
        const got = tiled(ring, extent, buffer, 8);
        expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
        for (const [k, v] of want) expect(got.get(k), k).toEqual(v);
      }
    }
  });
});

const LON0 = -73.9;
const LAT0 = 45.4;

/** A zone of `n` vertices (radius ~`km`) with `holes` holes, plus small neighbours: a region-sized polygon. */
function giantZone(n: number, km: number, holes: number): SourceFeature[] {
  const rnd = lcg(7);
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((LAT0 * Math.PI) / 180));
  const ring = (cx: number, cy: number, rx: number, ry: number, m: number, reverse: boolean): number[][] => {
    const pts: number[][] = [];
    for (let i = 0; i < m; i++) {
      const a = (2 * Math.PI * (reverse ? m - i : i)) / m;
      const r = 0.7 + 0.25 * Math.sin(9 * a + 2 * Math.sin(13 * a)) + 0.05 * rnd();
      pts.push([cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a)]);
    }
    pts.push(pts[0]!);
    return pts;
  };
  const coords = [ring(LON0, LAT0, dLon, dLat, n, false)];
  for (let h = 0; h < holes; h++) {
    const a = (2 * Math.PI * h) / holes;
    coords.push(ring(LON0 + 0.35 * dLon * Math.cos(a), LAT0 + 0.35 * dLat * Math.sin(a), dLon * 0.05, dLat * 0.05, 400, true));
  }
  const features: SourceFeature[] = [{ type: "Feature", properties: { code: "A" }, geometry: { type: "Polygon", coordinates: coords } }];
  for (let k = 0; k < 4; k++) {
    features.push({
      type: "Feature",
      properties: { code: `Z${k}` },
      geometry: { type: "Polygon", coordinates: [ring(LON0 + (k - 1.5) * 0.3 * dLon, LAT0 + 0.1 * dLat, dLon * 0.02, dLat * 0.02, 64, false)] },
    });
  }
  return features;
}

describe("tiled clip in the builder", () => {
  it("gives the same tiles as the per-tile path (zones with holes, multipolygons, lots)", () => {
    const zones = giantZone(20_000, 8, 12);
    const multi: SourceFeature = {
      type: "Feature",
      properties: { code: "M" },
      geometry: {
        type: "MultiPolygon",
        coordinates: zones.slice(1).map((f) => f.geometry!.coordinates as number[][][]),
      },
    };
    for (const [features, profile] of [
      [[...zones, multi], ZONES_PROFILE],
      [zones.slice(1), LOTS_PROFILE],
    ] as const) {
      const perTileBuild = buildLayerTiles(features, profile, { tiledClipFrom: Infinity });
      const tiledBuild = buildLayerTiles(features, profile, { tiledClipFrom: 1 });
      expect(tiledBuild.tiles.length).toBe(perTileBuild.tiles.length);
      expect(tiledBuild.tiles.map((t) => `${t.z}/${t.x}/${t.y}`)).toEqual(perTileBuild.tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
      tiledBuild.tiles.forEach((t, i) => expect(Buffer.from(t.gzip).equals(Buffer.from(perTileBuild.tiles[i]!.gzip))).toBe(true));
      expect(tiledBuild.zooms.map((z) => z.missing)).toEqual([0, 0, 0, 0]);
    }
  }, 120_000);

  it("a 500 000-vertex zone with holes builds z12–z15 within a time budget", () => {
    // Per-tile clipping reads every vertex for every tile of the bbox
    // (~ 4 300 tiles over the four zooms here): ~ 2·10^9 vertex visits.
    const features = giantZone(500_000, 25, 40);
    const t0 = performance.now();
    const built = buildLayerTiles(features, ZONES_PROFILE, {});
    const ms = performance.now() - t0;
    expect(built.zooms.map((z) => z.missing)).toEqual([0, 0, 0, 0]);
    expect(built.zooms[3]!.tiles).toBeGreaterThan(1_000);
    expect(ms).toBeLessThan(60_000);
  }, 120_000);
});
