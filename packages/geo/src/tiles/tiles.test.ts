import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PMTiles, zxyToTileId as refZxyToTileId, type RangeResponse, type Source } from "pmtiles";
import { describe, expect, it } from "vitest";

import {
  buildLayerTiles,
  FALLBACK_ID_BASE,
  FeatureIdAssigner,
  layerTilesToPmtiles,
  lotNumberId,
  LOTS_PROFILE,
  pickProperties,
  tierProperties,
  profileForCollection,
  quantizeRing,
  simplifyLayer,
  unmatchedEdgeLength,
  writePmtiles,
  zxyToTileId,
  ZONES_PROFILE,
  type QPolygon,
  type SourceFeature,
} from "./index.js";
import { parseTilesArgs, runTilesCli } from "./build-cli.js";
import { lonLatToWorld, projectRing } from "./geometry.js";

// ---------------------------------------------------------------------------
// Synthetic cadastre: n rows of n ~20 m lots near Rawdon, laid as bricks (every
// other row shifted by half a lot), so a lot's corner sits in the middle of its
// neighbours' sides (T-junctions, as in a real cadastre). Every half-side
// carries jittered intermediate vertices that BOTH neighbours share (a perfect
// partition), so simplification has vertices to remove and any per-ring
// decision shows up as a gap/overlap.

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

function gridLots(n: number, perEdge = 4, jitterM = 1.2): SourceFeature[] {
  const rnd = lcg(42);
  const node = (i: number, j: number): [number, number] => [LON0 + i * DLON, LAT0 + j * DLAT];
  // Intermediate points of the edge between node a and node b, keyed canonically.
  const edges = new Map<string, [number, number][]>();
  const edgePoints = (a: [number, number], b: [number, number], horizontal: boolean): [number, number][] => {
    const key = `${a.join()}|${b.join()}`;
    const rev = `${b.join()}|${a.join()}`;
    if (edges.has(key)) return edges.get(key)!;
    if (edges.has(rev)) return [...edges.get(rev)!].reverse();
    const pts: [number, number][] = [];
    for (let k = 1; k <= perEdge; k++) {
      const t = k / (perEdge + 1);
      const off = (rnd() - 0.5) * 2 * jitterM;
      const x = a[0] + (b[0] - a[0]) * t + (horizontal ? 0 : off * (DLON / 20));
      const y = a[1] + (b[1] - a[1]) * t + (horizontal ? off * (DLAT / 20) : 0);
      pts.push([x, y]);
    }
    edges.set(key, pts);
    return pts;
  };
  const features: SourceFeature[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = i + (j % 2) * 0.5;
      const sw = node(x0, j);
      const sm = node(x0 + 0.5, j);
      const se = node(x0 + 1, j);
      const ne = node(x0 + 1, j + 1);
      const nm = node(x0 + 0.5, j + 1);
      const nw = node(x0, j + 1);
      const ring = [
        sw,
        ...edgePoints(sw, sm, true),
        sm,
        ...edgePoints(sm, se, true),
        se,
        ...edgePoints(se, ne, false),
        ne,
        ...edgePoints(ne, nm, true),
        nm,
        ...edgePoints(nm, nw, true),
        nw,
        ...edgePoints(nw, sw, false),
        sw,
      ];
      features.push({
        type: "Feature",
        properties: { noLot: `${j}-${i}`, zone_code: `Z-${j % 3}`, NO_LOT: "dup", adresse: "secret", in_tod: null },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
  }
  return features;
}

function quantizeAll(features: SourceFeature[], z: number): QPolygon[][] {
  const scale = 4096 * 2 ** z;
  return features.map((f) => {
    const coords = (f.geometry as { coordinates: number[][][] }).coordinates;
    return [coords.map((r) => quantizeRing(projectRing(r), scale))];
  });
}

function decode(gz: Uint8Array): VectorTile {
  return new VectorTile(new PbfReader(gunzipSync(gz)));
}

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

const gunzipDecompress = async (buf: ArrayBuffer, compression: number): Promise<ArrayBuffer> => {
  if (compression === 1) return buf;
  if (compression !== 2) throw new Error(`unexpected compression ${compression}`);
  const out = gunzipSync(new Uint8Array(buf));
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
};

describe("profiles", () => {
  it("maps collections to profiles, norms are not tiled", () => {
    expect(profileForCollection("qc-lots-rawdon")).toBe(LOTS_PROFILE);
    expect(profileForCollection("qc-zonage-saint-eustache")).toBe(ZONES_PROFILE);
    expect(profileForCollection("qc-zonage-norms-rawdon")).toBeUndefined();
    expect(profileForCollection("qc-lots-")).toBeUndefined();
  });

  it("keeps only whitelisted lot properties, renamed, nulls dropped, citySlug derived", () => {
    const props = pickProperties(
      { NO_LOT: "1 2", noLot: "5 530 108", zone_code: "RD-12", code_zone: "XX", in_tod: null, adresse: "x", surface_m2: 3, zone_codes: ["a"] },
      LOTS_PROFILE,
      "rawdon",
    );
    expect(props).toEqual({ noLot: "5 530 108", zoneCode: "RD-12", citySlug: "rawdon" });
  });

  it("immo-computed properties and fid are not in the tiles", () => {
    const props = pickProperties(
      { noLot: 5530108, fid: 3, priorite: 1, multifamilial4plus: true, potentialScore: 0.4, potential_score: 0.4 },
      LOTS_PROFILE,
      undefined,
    );
    // noLot is emitted as a string (the numeric id carries the integer).
    expect(props).toEqual({ noLot: "5530108" });
    expect(pickProperties({ code: "A", fid: 1 }, ZONES_PROFILE, undefined)).toEqual({ code: "A" });
  });

  it("tiers: zoneCode / code only below z14", () => {
    const full = { noLot: "1", zoneCode: "Z", tod: true, citySlug: "c" };
    expect(tierProperties(full, LOTS_PROFILE, 12)).toEqual({ zoneCode: "Z" });
    expect(tierProperties(full, LOTS_PROFILE, 13)).toEqual({ zoneCode: "Z" });
    expect(tierProperties(full, LOTS_PROFILE, 14)).toBe(full);
    expect(tierProperties({ code: "A", kind: "k" }, ZONES_PROFILE, 12)).toEqual({ code: "A" });
    expect(tierProperties({ noLot: "1" }, LOTS_PROFILE, 12)).toEqual({});
  });

  it("zones: alias zone → code, zone_code first, booleans/numbers kept", () => {
    expect(pickProperties({ zone: "A-1", kind: "residential", reglement_millesime: "1988" }, ZONES_PROFILE, "x")).toEqual({
      code: "A-1",
      kind: "residential",
      reglementMillesime: "1988",
      citySlug: "x",
    });
    expect(pickProperties({ zone_code: "B-2", zone: "A-1", affectation: null, proof: { a: 1 } }, ZONES_PROFILE, undefined)).toEqual({ code: "B-2" });
  });
});

describe("feature ids", () => {
  it("lot number without spaces, numeric only, below the fallback base", () => {
    expect(lotNumberId("5 530 108")).toBe(5530108);
    expect(lotNumberId(" 1 234 567 ")).toBe(1234567);
    expect(lotNumberId(5530108)).toBe(5530108);
    expect(lotNumberId("5530108-1")).toBeUndefined();
    expect(lotNumberId("PC-1234")).toBeUndefined();
    expect(lotNumberId("")).toBeUndefined();
    expect(lotNumberId(1.5)).toBeUndefined();
    expect(lotNumberId("9".repeat(17))).toBeUndefined();
    expect(lotNumberId(String(FALLBACK_ID_BASE))).toBeUndefined();
  });

  it("falls back deterministically on missing, non-numeric and duplicated lot numbers, and counts them", () => {
    const ids = new FeatureIdAssigner("noLot");
    const got = [
      ids.assign(0, { noLot: "5 530 108" }),
      ids.assign(1, { NO_LOT: "1 000 001" }),
      ids.assign(2, { noLot: null, lot_id: "77" }),
      ids.assign(3, { noLot: "5530108" }), // duplicate of #0 → fallback
      ids.assign(4, {}),
      ids.assign(5, { noLot: "  " }),
      ids.assign(6, { noLot: "PC-12" }),
      ids.assign(7, null),
    ];
    expect(got).toEqual([
      5530108,
      1000001,
      77,
      FALLBACK_ID_BASE + 3,
      FALLBACK_ID_BASE + 4,
      FALLBACK_ID_BASE + 5,
      FALLBACK_ID_BASE + 6,
      FALLBACK_ID_BASE + 7,
    ]);
    expect(ids.stats).toEqual({ rule: "noLot", fromNoLot: 3, missingNoLot: 3, nonNumericNoLot: 1, duplicateNoLot: 1 });
    expect(new Set(got).size).toBe(got.length);
    expect(got.every(Number.isSafeInteger)).toBe(true);
  });

  it("zones use the source ordinal", () => {
    const ids = new FeatureIdAssigner("ordinal");
    expect([ids.assign(0, { noLot: "5" }), ids.assign(7, {})]).toEqual([0, 7]);
  });

  it("built lot tiles carry the lot number as feature id", () => {
    const lots = gridLots(3).map((f, i) => ({ ...f, properties: { ...f.properties, noLot: `5 530 ${100 + i}` } }));
    const built = buildLayerTiles(lots, LOTS_PROFILE, { minZoom: 12, maxZoom: 12 });
    expect(built.ids).toMatchObject({ fromNoLot: 9, missingNoLot: 0, nonNumericNoLot: 0, duplicateNoLot: 0 });
    const seen = new Set<number>();
    for (const t of built.tiles) {
      const layer = decode(t.gzip).layers.lots!;
      for (let i = 0; i < layer.length; i++) seen.add(layer.feature(i).id!);
    }
    expect([...seen].sort()).toEqual(lots.map((_, i) => 5530100 + i));
  });
});

describe("shared-border simplification", () => {
  const lots = gridLots(8);

  it("keeps adjacent lots gap- and overlap-free where per-ring simplification does not", () => {
    const q = quantizeAll(lots, 16);
    const before = unmatchedEdgeLength(q);
    const shared = simplifyLayer(q, 8, true);
    const naive = simplifyLayer(q, 8, false);
    expect(shared.stats.verticesOut).toBeLessThan(shared.stats.verticesIn);
    expect(shared.stats.fallbackRings).toBe(0);
    // Only the outer boundary is unmatched; simplifying it may only shorten it.
    expect(unmatchedEdgeLength(shared.layer)).toBeLessThanOrEqual(before);
    // Per-ring DP picks different vertices on each side of a border.
    expect(unmatchedEdgeLength(naive.layer)).toBeGreaterThan(before * 2);
  });

  it("every interior edge has its reverse after shared simplification", () => {
    const q = quantizeAll(lots, 16);
    const { layer } = simplifyLayer(q, 8, true);
    const edges = new Set<string>();
    for (const f of layer) for (const p of f) for (const r of p) {
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        edges.add(`${r[2 * i]},${r[2 * i + 1]},${r[2 * j]},${r[2 * j + 1]}`);
      }
    }
    // Lot (row 3, col 3) is interior: all of its edges must be matched.
    const interior = layer[3 * 8 + 3]![0]![0]!;
    const n = interior.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      expect(edges.has(`${interior[2 * j]},${interior[2 * j + 1]},${interior[2 * i]},${interior[2 * i + 1]}`)).toBe(true);
    }
  });

  it("a lot filling another lot's hole shares the hole ring (no junction case)", () => {
    const outer = [
      [LON0, LAT0],
      [LON0 + 10 * DLON, LAT0],
      [LON0 + 10 * DLON, LAT0 + 10 * DLAT],
      [LON0, LAT0 + 10 * DLAT],
      [LON0, LAT0],
    ];
    const rnd = lcg(7);
    const island: number[][] = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * 2 * Math.PI;
      const r = 3 + rnd() * 0.05;
      island.push([LON0 + (5 + r * Math.cos(a)) * DLON, LAT0 + (5 + r * Math.sin(a)) * DLAT]);
    }
    island.push(island[0]!);
    const holed: SourceFeature = { properties: {}, geometry: { type: "Polygon", coordinates: [outer, [...island].reverse()] } };
    const filler: SourceFeature = { properties: {}, geometry: { type: "Polygon", coordinates: [island] } };
    const scale = 4096 * 2 ** 16;
    const q: QPolygon[][] = [holed, filler].map((f) => [
      (f.geometry as { coordinates: number[][][] }).coordinates.map((r) => quantizeRing(projectRing(r), scale)),
    ]);
    const before = unmatchedEdgeLength(q);
    const { layer } = simplifyLayer(q, 6, true);
    expect(layer[1]![0]![0]!.length).toBeLessThan(q[1]![0]![0]!.length);
    expect(unmatchedEdgeLength(layer)).toBeLessThanOrEqual(before);
  });
});

describe("buildLayerTiles", () => {
  const lots = gridLots(12);

  it("every lot is present at every zoom, z12 included, with the properties of its zoom tier", () => {
    const built = buildLayerTiles(lots, LOTS_PROFILE, { minZoom: 12, maxZoom: 16, citySlug: "rawdon", borderCheck: true });
    for (const z of built.zooms) {
      expect(z.missing).toBe(0);
      expect(z.featuresPresent).toBe(lots.length);
      expect(z.unmatchedAfter!).toBeLessThanOrEqual(z.unmatchedBefore!);
    }
    // `${j}-${i}` is not a lot number: every id is the deterministic fallback.
    expect(built.ids).toMatchObject({ fromNoLot: 0, nonNumericNoLot: lots.length });
    for (const z of [12, 13, 14, 15, 16]) {
      const ids = new Set<number>();
      for (const t of built.tiles.filter((t) => t.z === z)) {
        const layer = decode(t.gzip).layers.lots!;
        expect(layer.extent).toBe(4096);
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          ids.add(f.id!);
          expect(f.type).toBe(3);
          const source = lots[f.id! - FALLBACK_ID_BASE]!.properties!;
          if (z < 14) {
            expect(Object.keys(f.properties)).toEqual(["zoneCode"]);
          } else {
            expect(Object.keys(f.properties).sort()).toEqual(["citySlug", "noLot", "zoneCode"]);
            expect(f.properties.noLot).toBe(source.noLot);
          }
          expect(f.properties.zoneCode).toBe(source.zone_code);
        }
      }
      expect(ids.size).toBe(lots.length);
    }
  });

  it("defaults to z12–z15", () => {
    const built = buildLayerTiles(lots.slice(0, 2), LOTS_PROFILE);
    expect([built.minZoom, built.maxZoom]).toEqual([12, 15]);
    expect(built.zooms.map((z) => z.z)).toEqual([12, 13, 14, 15]);
  });

  it("zones: ordinal ids, code only below z14, full whitelist from z14", () => {
    const zones: SourceFeature[] = lots.slice(0, 3).map((f, i) => ({
      ...f,
      properties: { zone: `Z${i}`, kind: "residential", fid: 9, priorite: 1 },
    }));
    const built = buildLayerTiles(zones, ZONES_PROFILE, { minZoom: 13, maxZoom: 14, citySlug: "x" });
    for (const t of built.tiles) {
      const layer = decode(t.gzip).layers.zones!;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        expect(f.properties.code).toBe(`Z${f.id}`);
        expect(Object.keys(f.properties).sort()).toEqual(t.z < 14 ? ["code"] : ["citySlug", "code", "kind"]);
      }
    }
  });

  it("encodes exterior rings so that MVT readers classify one polygon per lot", () => {
    const built = buildLayerTiles(lots.slice(0, 4), LOTS_PROFILE, { minZoom: 16, maxZoom: 16 });
    const layer = decode(built.tiles[0]!.gzip).layers.lots!;
    for (let i = 0; i < layer.length; i++) {
      const gj = layer.feature(i).toGeoJSON(built.tiles[0]!.x, built.tiles[0]!.y, 16);
      expect(gj.geometry.type).toBe("Polygon");
    }
  });

  it("keeps a sub-pixel lot present as a marker", () => {
    const tiny: SourceFeature = {
      properties: { noLot: "tiny" },
      geometry: {
        type: "Polygon",
        coordinates: [[[LON0, LAT0], [LON0 + DLON / 40, LAT0], [LON0 + DLON / 40, LAT0 + DLAT / 40], [LON0, LAT0]]],
      },
    };
    const built = buildLayerTiles([tiny], LOTS_PROFILE, { minZoom: 12, maxZoom: 13 });
    expect(built.zooms.map((z) => z.missing)).toEqual([0, 0]);
    expect(built.zooms[0]!.markers).toBe(1);
  });

  it("counts non-polygon features instead of hiding them", () => {
    const built = buildLayerTiles([{ properties: {}, geometry: { type: "Point", coordinates: [LON0, LAT0] } }, ...lots.slice(0, 1)], LOTS_PROFILE, {
      minZoom: 12,
      maxZoom: 12,
    });
    expect(built.skippedNonPolygon).toBe(1);
    expect(built.features).toBe(1);
  });
});

describe("PMTiles", () => {
  it("tile ids match the reference implementation", () => {
    const rnd = lcg(3);
    for (let z = 0; z <= 16; z++) {
      for (let k = 0; k < 20; k++) {
        const x = Math.floor(rnd() * 2 ** z);
        const y = Math.floor(rnd() * 2 ** z);
        expect(zxyToTileId(z, x, y)).toBe(refZxyToTileId(z, x, y));
      }
    }
  });

  it("an archive of built tiles reads back with the reference reader", async () => {
    const built = buildLayerTiles(gridLots(6), LOTS_PROFILE, { minZoom: 12, maxZoom: 16, citySlug: "rawdon" });
    const archive = layerTilesToPmtiles(built, { name: "qc-lots-test" });
    const pm = new PMTiles(new BufferSource(archive), undefined, gunzipDecompress);
    const header = await pm.getHeader();
    expect(header.minZoom).toBe(12);
    expect(header.maxZoom).toBe(16);
    expect(header.tileType).toBe(1);
    expect(header.numAddressedTiles).toBe(built.tiles.length);
    const meta = (await pm.getMetadata()) as { vector_layers: { id: string }[]; name: string };
    expect(meta.vector_layers[0]!.id).toBe("lots");
    expect(meta.name).toBe("qc-lots-test");
    for (const t of built.tiles) {
      // The reader inflates with the archive's declared tile compression.
      const got = await pm.getZxy(t.z, t.x, t.y);
      expect(Buffer.from(got!.data).equals(gunzipSync(t.gzip))).toBe(true);
    }
    expect(await pm.getZxy(12, 0, 0)).toBeUndefined();
  });

  it("splits into leaf directories when the root would not fit, dedupes contents", async () => {
    const rnd = lcg(11);
    const tiles = [];
    let x = 0;
    for (let i = 0; i < 40_000; i++) {
      x += 1 + Math.floor(rnd() * 5);
      const z = 14;
      const tx = x % 2 ** z;
      const ty = Math.floor(x / 2 ** z);
      const data = i % 10 === 0 ? Uint8Array.from([1, 2, 3]) : Uint8Array.from([i & 255, (i >> 8) & 255, Math.floor(rnd() * 255)]);
      tiles.push({ z, x: tx, y: ty, data });
    }
    const archive = writePmtiles(tiles, { tileCompression: 1, tileType: 1, minZoom: 14, maxZoom: 14, bounds: [-74, 45, -73, 46], metadata: {} });
    const pm = new PMTiles(new BufferSource(archive), undefined, gunzipDecompress);
    const header = await pm.getHeader();
    expect(header.leafDirectoryLength).toBeGreaterThan(0);
    expect(header.numTileContents).toBeLessThan(tiles.length);
    for (const t of tiles.filter((_, i) => i % 997 === 0 || i % 10 === 0).slice(0, 200)) {
      const got = await pm.getZxy(t.z, t.x, t.y);
      expect(Array.from(new Uint8Array(got!.data))).toEqual(Array.from(t.data));
    }
  });
});

describe("build CLI", () => {
  it("parses arguments and refuses ambiguous sources", () => {
    expect(parseTilesArgs(["--collection", "qc-lots-x", "--api", "https://h", "--max-zoom", "15"]).maxZoom).toBe(15);
    expect(() => parseTilesArgs(["--collection", "qc-lots-x"])).toThrow(/exactly one/);
    expect(() => parseTilesArgs(["--collection", "qc-lots-x", "--api", "a", "--file", "b"])).toThrow(/exactly one/);
    expect(() => parseTilesArgs(["--api", "a"])).toThrow(/--collection/);
  });

  it("builds an archive from a GeoJSON file and reports every zoom complete", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tiles-cli-"));
    try {
      const src = join(dir, "lots.geojson");
      const out = join(dir, "lots.pmtiles");
      await writeFile(src, JSON.stringify({ type: "FeatureCollection", features: gridLots(4) }));
      const lines: string[] = [];
      const code = await runTilesCli(["--collection", "qc-lots-rawdon", "--file", src, "--out", out, "--max-zoom", "14"], (l) => lines.push(l));
      expect(code).toBe(0);
      const report = JSON.parse(lines[0]!) as { features: number; zooms: { missing: number }[]; archiveBytes: number };
      expect(report.features).toBe(16);
      expect(report.zooms.map((z) => z.missing)).toEqual([0, 0, 0]);
      expect((await readFile(out)).length).toBe(report.archiveBytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("projection", () => {
  it("world coordinates are y-down Web Mercator", () => {
    const [x, y] = lonLatToWorld(0, 0);
    expect(x).toBeCloseTo(0.5, 12);
    expect(y).toBeCloseTo(0.5, 12);
    expect(lonLatToWorld(0, 45)[1]).toBeLessThan(0.5);
  });
});
