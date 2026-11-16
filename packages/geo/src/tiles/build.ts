/**
 * Build the vector tiles of one polygon layer (SPEC_VECTOR_TILES.md).
 *
 * Guarantees, checked per zoom and reported in {@link ZoomStats}:
 *
 * - no feature dropping: every source polygon feature is present in at least
 *   one tile of every zoom (`missing` must be 0). A feature whose geometry
 *   collapses on the zoom's pixel grid (smaller than one tile unit), or whose
 *   every clipped part degenerates, is kept as a one-unit square at its
 *   quantized position (`markers`): it stays present and queryable, and the
 *   shift is within the grid's own rounding;
 * - shared borders: simplification runs on arcs between junctions over the
 *   whole layer (`flat.ts`), so neighbours keep identical borders;
 * - property whitelist: only the profile's properties reach the tile, by zoom
 *   tier (`tierProperties`: lots carry only `zoneCode` below z14).
 *
 * MVT feature id: profile rule (`FeatureIdAssigner`) — lots: the lot number
 * (`noLot` without spaces), with a deterministic fallback; zones: the source
 * ordinal.
 *
 * Memory (§ Scale): features are fed one at a time ({@link LayerTilesBuilder.add})
 * and kept in compact typed arrays — coordinates quantized once at the max
 * zoom (`Int32Array`, 8 B per vertex), ring and feature offsets, property
 * columns with interned values. Each zoom derives its grid from them, is
 * simplified with a partitioned junction table, then built tile by tile
 * (clip, encode, gzip, append to a {@link TileSpool}): only one tile is encoded
 * at a time and the tiles never accumulate in memory when the spool is a file.
 * A feature spanning many tiles is clipped by a tile tree, column by column
 * (`clipRingToColumns`, `clipColumnToTiles`: same coordinates as a per-tile
 * clip, linear instead of tiles × vertices), and each distinct tile content is
 * gzipped and spooled once ({@link TileRecords}: 13 B per tile).
 */

import { clipColumnToTiles, clipRing, clipRingToColumns, ringBBox, tileRange, type Rect } from "./clip.js";
import { Growable, simplifyFlat, type FlatRings } from "./flat.js";
import { isUsableRing, lonLatToWorld, unmatchedEdgeLength, type QPolygon } from "./geometry.js";
import { encodeMvt, type MvtPolygonFeature } from "./mvt.js";
import { layoutPmtilesIndexed, PmCompression, PmTileType, writePmtiles, zxyToTileId } from "./pmtiles.js";
import { TileContents, TileRecords } from "./records.js";
import {
  FeatureIdAssigner,
  pickProperties,
  type FeatureIdStats,
  type LayerProfile,
  type TileValue,
} from "./profiles.js";
import { MemorySpool, type TileSpool } from "./spool.js";

/** Tile build defaults (T1): z12–z15, tolerance 1 below maxZoom, buffer 64, gzip -9. */
export const TILE_DEFAULTS = Object.freeze({
  minZoom: 12,
  maxZoom: 15,
  extent: 4096,
  buffer: 64,
  tolerance: 1,
  maxZoomTolerance: 0,
  sharedBorders: true,
  gzipLevel: 9,
});

/**
 * Default budget of (feature, tile) pairs at the max zoom: 8 Mi. Montréal's
 * 680 087 lots touch about one z15 tile each; a single polygon spanning a
 * whole region would need millions.
 */
export const DEFAULT_MAX_TILE_PAIRS = 2 ** 23;

/**
 * Candidate tiles (sum of its exteriors' bbox tile ranges at the zoom) from
 * which a feature is clipped to all its tiles at once (`clipRingToTiles`)
 * instead of once per tile. Both paths give the same tiles byte for byte; this
 * only trades the per-tile path's tiles × vertices CPU for holding the
 * feature's clipped parts until its tiles are encoded.
 */
export const TILED_CLIP_FROM = 16;

/** The source exceeds a build budget; raised before the heavy work. */
export class TileBudgetError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "TileBudgetError";
  }
}

export interface SourceFeature {
  type?: string;
  id?: unknown;
  properties?: Record<string, unknown> | null;
  geometry?: { type: string; coordinates?: unknown; geometries?: unknown } | null;
}

export interface BuildTilesOptions {
  /** Default 12. */
  minZoom?: number;
  /** Default 15 (≈ 21 cm per tile unit at Québec latitudes, extent 4096); clients overzoom. */
  maxZoom?: number;
  /** Tile extent, default 4096. */
  extent?: number;
  /** Buffer around each tile in tile units, default 64. */
  buffer?: number;
  /** Douglas–Peucker tolerance in tile units below `maxZoom`, default 1. */
  tolerance?: number;
  /** Tolerance at `maxZoom`, default 0 (quantization only). */
  maxZoomTolerance?: number;
  /** Shared-border-aware simplification (default true). */
  sharedBorders?: boolean;
  /** Compute the unmatched-edge border metric per zoom (costly; default false). */
  borderCheck?: boolean;
  /** gzip level of the stored tiles, default 9. */
  gzipLevel?: number;
  /** City slug derived from the collection id — never read from the source. */
  citySlug?: string | undefined;
  /** Refuse ({@link TileBudgetError}) a source with more polygon features than this. */
  maxFeatures?: number;
  /**
   * Refuse ({@link TileBudgetError}) a source whose features touch more than
   * this many (feature, tile) pairs at `maxZoom` (bbox estimate, counted while
   * the source is read). Default {@link DEFAULT_MAX_TILE_PAIRS}. Bounds the CPU
   * of a huge polygon (a zone covering a region is thousands of z15 tiles).
   */
  maxTilePairs?: number;
  /** Vertex occurrences per junction-table partition (default 2^21). */
  partitionVertices?: number;
  /** See {@link TILED_CLIP_FROM} (default); does not change the tiles. */
  tiledClipFrom?: number;
}

export interface ZoomStats {
  z: number;
  tiles: number;
  featuresPresent: number;
  missing: number;
  markers: number;
  verticesIn: number;
  verticesOut: number;
  fallbackRings: number;
  junctions: number;
  /** Junction-table partitions used by the simplification. */
  partitions: number;
  maxTileBytes: number;
  maxTileGzipBytes: number;
  totalTileBytes: number;
  totalGzipBytes: number;
  maxFeaturesPerTile: number;
  /** Border metric in tile units of this zoom (borderCheck only). */
  unmatchedBefore?: number;
  unmatchedAfter?: number;
  ms: number;
}

export interface BuiltTile {
  z: number;
  x: number;
  y: number;
  /** gzip-compressed MVT. */
  gzip: Uint8Array;
  bytes: number;
}

export type { TileRecord } from "./records.js";

/** Everything but the tile bytes. */
export interface LayerSummary {
  layer: string;
  features: number;
  skippedNonPolygon: number;
  bounds: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  fields: Record<string, string>;
  /** Number of tiles built. */
  tileCount: number;
  zooms: ZoomStats[];
  ids: FeatureIdStats;
}

export interface LayerTiles extends LayerSummary {
  tiles: BuiltTile[];
}

export interface SpooledLayer extends LayerSummary {
  /** Every tile (compact; each distinct content is spooled once). */
  records: TileRecords;
}

function polygonsOf(geometry: SourceFeature["geometry"]): number[][][][] | undefined {
  if (!geometry) return undefined;
  if (geometry.type === "Polygon") return [geometry.coordinates as number[][][]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as number[][][][];
  if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
    const out: number[][][][] = [];
    for (const g of geometry.geometries as SourceFeature["geometry"][]) out.push(...(polygonsOf(g) ?? []));
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

/** One kept ring of a column-cut feature, reduced to one tile column. */
interface ColumnPart {
  fi: number;
  ring: number;
  /** -1 for an exterior; for a hole, its exterior ring. */
  owner: number;
  column: Int32Array;
  ty0: number;
  ty1: number;
}

/** A column-cut feature's polygons in one tile. */
interface TiledPolygons {
  fi: number;
  polygons: Int32Array[][];
  /** Exterior ring of the last polygon. */
  exterior: number;
}

/** A property column: per feature, 0 (absent) or 1 + index into interned values. */
interface Column {
  out: string;
  index: Growable<Uint32Array>;
  values: TileValue[];
  intern: Map<string, number>;
}

interface Settings {
  minZoom: number;
  maxZoom: number;
  extent: number;
  buffer: number;
  tolerance: number;
  maxZoomTolerance: number;
  sharedBorders: boolean;
  gzipLevel: number;
}

/**
 * Accumulates the source one feature at a time in compact typed arrays (the
 * parsed GeoJSON is not retained), then builds every zoom into a spool.
 */
export class LayerTilesBuilder {
  readonly #profile: LayerProfile;
  readonly #options: BuildTilesOptions;
  readonly #s: Settings;
  readonly #ids: FeatureIdAssigner;
  /** Coordinates quantized at maxZoom (extent × 2^maxZoom), x/y interleaved. */
  readonly #q = new Growable(Int32Array, 2 ** 28);
  /** Ring r = vertices ringStart[r] … ringStart[r + 1] - 1. */
  readonly #ringStart = new Growable(Uint32Array, 2 ** 27);
  /** 1 when the ring is a polygon's exterior (holes follow it). */
  readonly #exterior = new Growable(Uint8Array, 2 ** 27);
  /** Feature f = rings featRing[f] … featRing[f + 1] - 1. */
  readonly #featRing = new Growable(Uint32Array, 2 ** 26);
  readonly #featId = new Growable(Float64Array, 2 ** 26);
  readonly #columns: Column[];
  readonly #fields: Record<string, string> = {};
  #ordinal = 0;
  #skippedNonPolygon = 0;
  #minLon = Infinity;
  #minLat = Infinity;
  #maxLon = -Infinity;
  #maxLat = -Infinity;
  #tilePairs = 0;
  #released = false;

  constructor(profile: LayerProfile, options: BuildTilesOptions = {}) {
    this.#profile = profile;
    this.#options = options;
    this.#s = {
      minZoom: options.minZoom ?? TILE_DEFAULTS.minZoom,
      maxZoom: options.maxZoom ?? TILE_DEFAULTS.maxZoom,
      extent: options.extent ?? TILE_DEFAULTS.extent,
      buffer: options.buffer ?? TILE_DEFAULTS.buffer,
      tolerance: options.tolerance ?? TILE_DEFAULTS.tolerance,
      maxZoomTolerance: options.maxZoomTolerance ?? TILE_DEFAULTS.maxZoomTolerance,
      sharedBorders: options.sharedBorders ?? TILE_DEFAULTS.sharedBorders,
      gzipLevel: options.gzipLevel ?? TILE_DEFAULTS.gzipLevel,
    };
    const { minZoom, maxZoom, extent } = this.#s;
    if (minZoom < 0 || maxZoom > 18 || minZoom > maxZoom) throw new Error(`zoom range out of bounds: ${minZoom}…${maxZoom}`);
    if (extent * 2 ** maxZoom > 2 ** 30) throw new Error(`extent × 2^maxZoom over 2^30: ${extent} × 2^${maxZoom}`);
    this.#ids = new FeatureIdAssigner(profile.featureId);
    this.#columns = profile.properties.map((rule) => ({
      out: rule.out,
      index: new Growable(Uint32Array, 2 ** 26),
      values: [],
      intern: new Map(),
    }));
    this.#ringStart.push(0);
    this.#featRing.push(0);
  }

  /** Polygon features added so far. */
  get features(): number {
    return this.#featId.length;
  }

  /** Bytes held by the compact source (typed arrays; property values not counted). */
  get compactBytes(): number {
    return this.#q.bytes + this.#ringStart.bytes + this.#exterior.bytes + this.#featRing.bytes + this.#featId.bytes +
      this.#columns.reduce((n, c) => n + c.index.bytes, 0);
  }

  add(f: SourceFeature): void {
    const ordinal = this.#ordinal++;
    const polys = polygonsOf(f.geometry);
    if (!polys || polys.length === 0) {
      this.#skippedNonPolygon++;
      return;
    }
    const max = this.#options.maxFeatures;
    if (max !== undefined && this.features >= max) throw new TileBudgetError(`more than ${max} polygon features`);

    const scale = this.#s.extent * 2 ** this.#s.maxZoom;
    const ringsBefore = this.#ringStart.length - 1;
    const coordsBefore = this.#q.length;
    let exteriorVertices = 0;
    for (const poly of polys) {
      poly.forEach((ring, ri) => {
        let n = ring.length;
        if (n > 1 && ring[0]![0] === ring[n - 1]![0] && ring[0]![1] === ring[n - 1]![1]) n--;
        const start = this.#q.length;
        let m = 0;
        for (let i = 0; i < n; i++) {
          const lon = ring[i]![0]!;
          const lat = ring[i]![1]!;
          if (lon < this.#minLon) this.#minLon = lon;
          if (lon > this.#maxLon) this.#maxLon = lon;
          if (lat < this.#minLat) this.#minLat = lat;
          if (lat > this.#maxLat) this.#maxLat = lat;
          const [wx, wy] = lonLatToWorld(lon, lat);
          const x = Math.round(wx * scale);
          const y = Math.round(wy * scale);
          if (m > 0 && this.#q.get(this.#q.length - 2) === x && this.#q.get(this.#q.length - 1) === y) continue;
          this.#q.push(x);
          this.#q.push(y);
          m++;
        }
        // Closing duplicates created by the rounding.
        while (m > 1 && this.#q.get(start) === this.#q.get(this.#q.length - 2) && this.#q.get(start + 1) === this.#q.get(this.#q.length - 1)) {
          this.#q.length -= 2;
          m--;
        }
        this.#ringStart.push(this.#q.length / 2);
        this.#exterior.push(ri === 0 ? 1 : 0);
        if (ri === 0) {
          exteriorVertices += m;
          this.#countTilePairs(start, this.#q.length);
        }
      });
    }
    if (exteriorVertices === 0) {
      // Polygons without any position: nothing to tile (counted, not hidden).
      this.#q.length = coordsBefore;
      this.#ringStart.length = ringsBefore + 1;
      this.#exterior.length = ringsBefore;
      this.#skippedNonPolygon++;
      return;
    }
    this.#featRing.push(this.#ringStart.length - 1);
    this.#featId.push(this.#ids.assign(ordinal, f.properties));

    const properties = pickProperties(f.properties, this.#profile, this.#options.citySlug);
    for (const [k, v] of Object.entries(properties)) {
      this.#fields[k] ??= typeof v === "string" ? "String" : typeof v === "number" ? "Number" : "Boolean";
    }
    for (const col of this.#columns) {
      const v = properties[col.out];
      if (v === undefined) {
        col.index.push(0);
        continue;
      }
      const key = `${typeof v}:${String(v)}`;
      let idx = col.intern.get(key);
      if (idx === undefined) {
        col.values.push(v);
        idx = col.values.length;
        col.intern.set(key, idx);
      }
      col.index.push(idx);
    }
  }

  /** Tiles the exterior's bbox (+ buffer) touches at maxZoom, accumulated against the budget. */
  #countTilePairs(from: number, to: number): void {
    const { extent, buffer, maxZoom } = this.#s;
    const n = 2 ** maxZoom;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = from; i < to; i += 2) {
      const x = this.#q.get(i);
      const y = this.#q.get(i + 1);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return;
    const tx0 = Math.max(0, Math.floor((minX - buffer) / extent));
    const tx1 = Math.min(n - 1, Math.floor((maxX + buffer) / extent));
    const ty0 = Math.max(0, Math.floor((minY - buffer) / extent));
    const ty1 = Math.min(n - 1, Math.floor((maxY + buffer) / extent));
    this.#tilePairs += Math.max(0, tx1 - tx0 + 1) * Math.max(0, ty1 - ty0 + 1);
    const budget = this.#options.maxTilePairs ?? DEFAULT_MAX_TILE_PAIRS;
    if (this.#tilePairs > budget) throw new TileBudgetError(`more than ${budget} (feature, tile) pairs at z${maxZoom}`);
  }

  /** Build every tile into memory (tests, the measuring CLI, small layers). */
  finish(): LayerTiles {
    const spool = new MemorySpool();
    const gen = this.#run(spool);
    let step = gen.next();
    while (!step.done) step = gen.next();
    const { records, ...summary } = step.value;
    return { ...summary, tiles: [...records].map((r) => ({ z: r.z, x: r.x, y: r.y, gzip: spool.read(r.offset, r.length), bytes: r.bytes })) };
  }

  /**
   * Build every tile into `spool`, yielding to the event loop between tiles
   * (so a deadline timer can fire) and checking `signal`. The compact source is
   * released at the end.
   */
  async buildToSpool(spool: TileSpool, signal?: AbortSignal): Promise<SpooledLayer> {
    const gen = this.#run(spool);
    let step = gen.next();
    let since = Date.now();
    while (!step.done) {
      if (Date.now() - since > 50) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        signal?.throwIfAborted();
        since = Date.now();
      }
      step = gen.next();
    }
    return step.value;
  }

  /** Free the compact source (idempotent). */
  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#q.release();
    this.#ringStart.release();
    this.#exterior.release();
    this.#featRing.release();
    this.#featId.release();
    for (const c of this.#columns) c.index.release();
  }

  *#run(spool: TileSpool): Generator<void, SpooledLayer> {
    if (this.#released) throw new Error("tiles: builder already released");
    const records = new TileRecords(new TileContents(spool, this.#s.gzipLevel));
    const zooms: ZoomStats[] = [];
    try {
      for (let z = this.#s.minZoom; z <= this.#s.maxZoom; z++) zooms.push(yield* this.#zoom(z, records));
    } finally {
      this.release();
    }
    return {
      layer: this.#profile.layer,
      features: zooms.length > 0 ? zooms[0]!.featuresPresent + zooms[0]!.missing : 0,
      skippedNonPolygon: this.#skippedNonPolygon,
      bounds: [this.#minLon, this.#minLat, this.#maxLon, this.#maxLat],
      minZoom: this.#s.minZoom,
      maxZoom: this.#s.maxZoom,
      fields: this.#fields,
      tileCount: records.length,
      zooms,
      ids: this.#ids.stats,
      records,
    };
  }

  /** Properties of feature `fi` at zoom `z` (tiers: `lowZoomProperties` below `fullFromZoom`). */
  #propsFor(fi: number, z: number): Record<string, TileValue> {
    const out: Record<string, TileValue> = {};
    const full = z >= this.#profile.fullFromZoom;
    for (const col of this.#columns) {
      if (!full && !this.#profile.lowZoomProperties.includes(col.out)) continue;
      const idx = col.index.get(fi);
      if (idx !== 0) out[col.out] = col.values[idx - 1]!;
    }
    const slug = this.#options.citySlug;
    if (this.#profile.citySlug && slug !== undefined && (full || this.#profile.lowZoomProperties.includes("citySlug"))) {
      out.citySlug = slug;
    }
    return out;
  }

  /** Coordinates of every ring at zoom z (rounded from maxZoom, duplicates dropped); the stored array at maxZoom. */
  #quantize(z: number): { rings: FlatRings; release(): void } {
    const ringStart = this.#ringStart.view();
    const d = 2 ** (this.#s.maxZoom - z);
    if (d === 1) return { rings: { coords: this.#q.view(), ringStart }, release: () => {} };
    const q = this.#q.view();
    const ringCount = ringStart.length - 1;
    const out = new Growable(Int32Array, 2 ** 28);
    const outStart = new Uint32Array(ringCount + 1);
    for (let r = 0; r < ringCount; r++) {
      const start = out.length;
      let m = 0;
      for (let v = ringStart[r]!; v < ringStart[r + 1]!; v++) {
        const x = Math.round(q[2 * v]! / d);
        const y = Math.round(q[2 * v + 1]! / d);
        if (m > 0 && out.get(out.length - 2) === x && out.get(out.length - 1) === y) continue;
        out.push(x);
        out.push(y);
        m++;
      }
      while (m > 1 && out.get(start) === out.get(out.length - 2) && out.get(start + 1) === out.get(out.length - 1)) {
        out.length -= 2;
        m--;
      }
      outStart[r + 1] = out.length / 2;
    }
    return { rings: { coords: out.view(), ringStart: outStart }, release: () => out.release() };
  }

  /** One-unit square at the quantized centre of feature fi's exterior rings, in zoom z units. */
  #markerAt(fi: number, z: number): [number, number] {
    const d = 2 ** (this.#s.maxZoom - z);
    const q = this.#q.view();
    const ringStart = this.#ringStart.view();
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let r = this.#featRing.get(fi); r < this.#featRing.get(fi + 1); r++) {
      if (!this.#exterior.get(r)) continue;
      for (let v = ringStart[r]!; v < ringStart[r + 1]!; v++) {
        sx += q[2 * v]!;
        sy += q[2 * v + 1]!;
        n++;
      }
    }
    return [Math.floor(sx / n / d), Math.floor(sy / n / d)];
  }

  /**
   * The kept rings of feature `fi` cut into columns ({@link clipRingToColumns}),
   * appended to `parts` per column in (feature, ring) order.
   */
  #columnParts(
    fi: number,
    coords: Int32Array,
    ringStart: Uint32Array,
    keep: Uint8Array,
    extent: number,
    buffer: number,
    tilesPerAxis: number,
    parts: Map<number, ColumnPart[]>,
  ): void {
    const exterior = this.#exterior.view();
    let owner = -1;
    for (let r = this.#featRing.get(fi); r < this.#featRing.get(fi + 1); r++) {
      if (exterior[r]) owner = r;
      if (!keep[r]) continue;
      const ring = coords.subarray(2 * ringStart[r]!, 2 * ringStart[r + 1]!);
      const range = tileRange(ringBBox(ring), extent, buffer, tilesPerAxis);
      clipRingToColumns(ring, range, extent, buffer, (tx, column, ty0, ty1) => {
        let list = parts.get(tx);
        if (!list) parts.set(tx, (list = []));
        list.push({ fi, ring: r, owner: exterior[r] ? -1 : owner, column, ty0, ty1 });
      });
    }
  }

  *#zoom(z: number, records: TileRecords): Generator<void, ZoomStats> {
    const t0 = performance.now();
    const { extent, buffer } = this.#s;
    const tilesPerAxis = 2 ** z;
    const featureCount = this.features;
    const exterior = this.#exterior.view();
    const featRing = this.#featRing.view();
    const ringCount = exterior.length;

    // 1. Grid of this zoom; which rings survive it (a polygon whose exterior
    //    collapses is dropped with its holes; a feature left without polygon
    //    becomes a marker).
    const quantized = this.#quantize(z);
    const keep = new Uint8Array(ringCount);
    const hasPolygon = new Uint8Array(featureCount);
    {
      const { coords, ringStart } = quantized.rings;
      for (let fi = 0; fi < featureCount; fi++) {
        let exteriorKept = false;
        for (let r = featRing[fi]!; r < featRing[fi + 1]!; r++) {
          const usable = isUsableRing(coords.subarray(2 * ringStart[r]!, 2 * ringStart[r + 1]!));
          if (exterior[r]) exteriorKept = usable;
          if (usable && exteriorKept) {
            keep[r] = 1;
            if (exterior[r]) hasPolygon[fi] = 1;
          }
        }
      }
    }
    yield;

    // 2. Shared-border simplification over the whole layer.
    const tol = z === this.#s.maxZoom ? this.#s.maxZoomTolerance : this.#s.tolerance;
    const before = this.#options.borderCheck ? unmatchedEdgeLength(nested(quantized.rings, keep, featRing, exterior)) : undefined;
    const simplified = simplifyFlat(quantized.rings, keep, tol, this.#s.sharedBorders, {
      ...(this.#options.partitionVertices !== undefined ? { partitionVertices: this.#options.partitionVertices } : {}),
    });
    const after = this.#options.borderCheck ? unmatchedEdgeLength(nested(simplified.rings, keep, featRing, exterior)) : undefined;
    if (simplified.rings !== quantized.rings) quantized.release();
    const { coords, ringStart } = simplified.rings;
    yield;

    // 3. Tile lists: every tile each kept exterior's bbox (+ buffer) touches;
    //    a feature without polygon gets a marker in the tile of its centre.
    //    A feature spanning many tiles is not listed per tile: its rings are
    //    cut into columns here (linear), and each column is clipped to its
    //    tiles when the sweep reaches it (step 4) — the same coordinates as a
    //    per-tile `clipRing`, which reads every vertex of the feature for every
    //    tile of its bboxes (tiles × vertices), and no per-tile state for the
    //    millions of tiles a region-sized polygon covers.
    const lists = new Map<number, number[]>();
    const markers = new Map<number, [number, number]>();
    const columnParts = new Map<number, ColumnPart[]>();
    const tiledFrom = this.#options.tiledClipFrom ?? TILED_CLIP_FROM;
    const addTo = (key: number, fi: number): void => {
      let list = lists.get(key);
      if (!list) lists.set(key, (list = []));
      if (list[list.length - 1] !== fi) list.push(fi);
    };
    const markerTile = (fi: number): number => {
      const [mx, my] = this.#markerAt(fi, z);
      markers.set(fi, [mx, my]);
      const tx = Math.max(0, Math.min(tilesPerAxis - 1, Math.floor(mx / extent)));
      const ty = Math.max(0, Math.min(tilesPerAxis - 1, Math.floor(my / extent)));
      return tx * tilesPerAxis + ty;
    };
    for (let fi = 0; fi < featureCount; fi++) {
      if (!hasPolygon[fi]) {
        addTo(markerTile(fi), fi);
        continue;
      }
      const ranges: [number, number, number, number][] = [];
      let candidates = 0;
      for (let r = featRing[fi]!; r < featRing[fi + 1]!; r++) {
        if (!exterior[r] || !keep[r]) continue;
        const range = tileRange(ringBBox(coords.subarray(2 * ringStart[r]!, 2 * ringStart[r + 1]!)), extent, buffer, tilesPerAxis);
        ranges.push(range);
        candidates += Math.max(0, range[1] - range[0] + 1) * Math.max(0, range[3] - range[2] + 1);
      }
      if (candidates >= tiledFrom) {
        this.#columnParts(fi, coords, ringStart, keep, extent, buffer, tilesPerAxis, columnParts);
        yield;
        continue;
      }
      // Tiles of all its polygons, each once (a Set: a large zone spans thousands of tiles).
      const seen = new Set<number>();
      for (const [tx0, tx1, ty0, ty1] of ranges) {
        for (let tx = tx0; tx <= tx1; tx++) {
          for (let ty = ty0; ty <= ty1; ty++) seen.add(tx * tilesPerAxis + ty);
        }
      }
      for (const key of seen) addTo(key, fi);
    }

    // 4. Column by column (tiles in increasing key = x · 2^z + y), tile by
    //    tile: clip, encode, gzip (once per distinct content), spool.
    const present = new Uint8Array(featureCount);
    let maxFeaturesPerTile = 0;
    const zoomStart = records.length;
    let mainEnd = -1;
    const keyOf = (i: number): number => records.x(i) * tilesPerAxis + records.y(i);
    /** Record index of tile `key` in this zoom, or -1. */
    const findRecord = (key: number): number => {
      let lo = zoomStart;
      let hi = mainEnd;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (keyOf(mid) < key) lo = mid + 1;
        else hi = mid;
      }
      if (lo < mainEnd && keyOf(lo) === key) return lo;
      for (let i = mainEnd; i < records.length; i++) if (keyOf(i) === key) return i;
      return -1;
    };
    /** Clipped polygons of the column-cut features in column tx, rows ty0 … ty1: per row, in feature order. */
    const columnTiles = (tx: number, ty0: number, ty1: number): Map<number, TiledPolygons[]> => {
      const byRow = new Map<number, TiledPolygons[]>();
      for (const p of columnParts.get(tx) ?? []) {
        const a = Math.max(p.ty0, ty0);
        const b = Math.min(p.ty1, ty1);
        if (a > b) continue;
        clipColumnToTiles(p.column, tx, a, b, extent, buffer, (ty, part) => {
          let row = byRow.get(ty);
          if (!row) byRow.set(ty, (row = []));
          const last = row[row.length - 1];
          if (p.owner === -1) {
            if (last && last.fi === p.fi) {
              last.polygons.push([part]);
              last.exterior = p.ring;
            } else {
              row.push({ fi: p.fi, polygons: [[part]], exterior: p.ring });
            }
          } else if (last && last.fi === p.fi && last.exterior === p.owner) {
            // A hole goes with its exterior's part in this tile (none: dropped).
            last.polygons[last.polygons.length - 1]!.push(part);
          }
        });
      }
      return byRow;
    };
    const encodeTile = (key: number, list: readonly number[], tiled: readonly TiledPolygons[], redo: boolean): void => {
      const x = Math.floor(key / tilesPerAxis);
      const y = key % tilesPerAxis;
      const ox = x * extent;
      const oy = y * extent;
      const rect: Rect = { minX: ox - buffer, minY: oy - buffer, maxX: ox + extent + buffer, maxY: oy + extent + buffer };
      const features: MvtPolygonFeature[] = [];
      // Listed and column-cut features, merged in feature order.
      let i = 0;
      let j = 0;
      while (i < list.length || j < tiled.length) {
        let fi: number;
        let polygons: Int32Array[][] | undefined;
        if (j >= tiled.length || (i < list.length && list[i]! <= tiled[j]!.fi)) {
          fi = list[i++]!;
          if (j < tiled.length && tiled[j]!.fi === fi) j++;
        } else {
          fi = tiled[j]!.fi;
          polygons = tiled[j++]!.polygons;
        }
        const marker = markers.get(fi);
        if (marker) {
          const [mx, my] = marker;
          const lx = mx - ox;
          const ly = my - oy;
          // Clockwise on screen (y down): positive shoelace area.
          polygons = [[Int32Array.from([lx, ly, lx + 1, ly, lx + 1, ly + 1, lx, ly + 1])]];
        } else if (polygons === undefined) {
          polygons = [];
          let current: Int32Array[] | undefined;
          for (let r = featRing[fi]!; r < featRing[fi + 1]!; r++) {
            if (!keep[r]) continue;
            const ring = coords.subarray(2 * ringStart[r]!, 2 * ringStart[r + 1]!);
            if (exterior[r]) {
              const ext = clipRing(ring, rect, ox, oy);
              current = ext ? [ext] : undefined;
              if (current) polygons.push(current);
            } else if (current) {
              const hole = clipRing(ring, rect, ox, oy);
              if (hole) current.push(hole);
            }
          }
          if (polygons.length === 0) continue;
        }
        present[fi] = 1;
        features.push({ id: this.#featId.get(fi), properties: this.#propsFor(fi, z), polygons });
      }
      // Only buffer-zone slivers that clipped to nothing: no tile (served 204).
      if (features.length === 0) return;
      // A re-encoded tile only gains a marker: the running max is the final one.
      maxFeaturesPerTile = Math.max(maxFeaturesPerTile, features.length);
      const content = records.contents.add(encodeMvt([{ name: this.#profile.layer, extent, features }]));
      const at = redo ? findRecord(key) : -1;
      if (at === -1) records.push(z, x, y, content);
      else records.setContent(at, content);
    };
    const listedKeys = [...lists.keys()].sort((a, b) => a - b);
    const columns = new Set<number>(columnParts.keys());
    for (const key of listedKeys) columns.add(Math.floor(key / tilesPerAxis));
    let k = 0;
    for (const tx of [...columns].sort((a, b) => a - b)) {
      const byRow = columnTiles(tx, 0, tilesPerAxis - 1);
      const rows = new Set<number>(byRow.keys());
      while (k < listedKeys.length && Math.floor(listedKeys[k]! / tilesPerAxis) === tx) rows.add(listedKeys[k++]! % tilesPerAxis);
      for (const ty of [...rows].sort((a, b) => a - b)) {
        const key = tx * tilesPerAxis + ty;
        encodeTile(key, lists.get(key) ?? [], byRow.get(ty) ?? [], false);
        yield;
      }
    }
    mainEnd = records.length;

    // 5. Features whose every clipped part degenerated (a sliver along tile
    //    edges): a marker in the tile of their centre, that tile re-encoded.
    const redo = new Set<number>();
    let markerCount = 0;
    for (let fi = 0; fi < featureCount; fi++) {
      if (!hasPolygon[fi]) markerCount++;
      if (present[fi]) continue;
      markerCount += hasPolygon[fi] ? 1 : 0;
      const key = markerTile(fi);
      let list = lists.get(key);
      if (!list) lists.set(key, (list = []));
      if (!list.includes(fi)) {
        list.push(fi);
        list.sort((a, b) => a - b);
      }
      redo.add(key);
    }
    for (const key of [...redo].sort((a, b) => a - b)) {
      const tx = Math.floor(key / tilesPerAxis);
      const ty = key % tilesPerAxis;
      encodeTile(key, lists.get(key)!, columnTiles(tx, ty, ty).get(ty) ?? [], true);
      yield;
    }

    let featuresPresent = 0;
    for (let fi = 0; fi < featureCount; fi++) featuresPresent += present[fi]!;
    const stats = { maxTileBytes: 0, maxTileGzipBytes: 0, totalTileBytes: 0, totalGzipBytes: 0, maxFeaturesPerTile };
    const { contents } = records;
    for (let i = zoomStart; i < records.length; i++) {
      const c = records.content(i);
      const bytes = contents.bytes.get(c);
      const length = contents.length.get(c);
      stats.maxTileBytes = Math.max(stats.maxTileBytes, bytes);
      stats.maxTileGzipBytes = Math.max(stats.maxTileGzipBytes, length);
      stats.totalTileBytes += bytes;
      stats.totalGzipBytes += length;
    }
    simplified.release();
    if (simplified.rings === quantized.rings) quantized.release();

    return {
      z,
      tiles: records.length - zoomStart,
      featuresPresent,
      missing: featureCount - featuresPresent,
      markers: markerCount,
      verticesIn: simplified.stats.verticesIn,
      verticesOut: simplified.stats.verticesOut,
      fallbackRings: simplified.stats.fallbackRings,
      junctions: simplified.stats.junctions,
      partitions: simplified.stats.partitions,
      ...stats,
      ...(before !== undefined ? { unmatchedBefore: Math.round(before) } : {}),
      ...(after !== undefined ? { unmatchedAfter: Math.round(after) } : {}),
      ms: Math.round(performance.now() - t0),
    };
  }
}

/** Kept rings as `[feature][polygon][ring]` (border metric only). */
function nested(rings: FlatRings, keep: Uint8Array, featRing: Uint32Array, exterior: Uint8Array): QPolygon[][] {
  const out: QPolygon[][] = [];
  for (let fi = 0; fi + 1 < featRing.length; fi++) {
    const polys: QPolygon[] = [];
    for (let r = featRing[fi]!; r < featRing[fi + 1]!; r++) {
      if (!keep[r]) continue;
      const ring = rings.coords.slice(2 * rings.ringStart[r]!, 2 * rings.ringStart[r + 1]!);
      if (exterior[r]) polys.push([ring]);
      else polys[polys.length - 1]?.push(ring);
    }
    out.push(polys);
  }
  return out;
}

/** Build every tile of one layer, `minZoom` … `maxZoom`, in memory. */
export function buildLayerTiles(features: Iterable<SourceFeature>, profile: LayerProfile, options: BuildTilesOptions = {}): LayerTiles {
  const builder = new LayerTilesBuilder(profile, options);
  try {
    for (const f of features) builder.add(f);
    return builder.finish();
  } finally {
    builder.release();
  }
}

/** TileJSON-style metadata stored in the archive. */
export function layerMetadata(built: LayerSummary, extraMetadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: "pbf",
    generator: "@sentropic/geo tiles",
    vector_layers: [{ id: built.layer, fields: built.fields, minzoom: built.minZoom, maxzoom: built.maxZoom }],
    ...extraMetadata,
  };
}

function archiveOptions(built: LayerSummary, extraMetadata: Record<string, unknown>) {
  return {
    tileCompression: PmCompression.Gzip,
    tileType: PmTileType.Mvt,
    minZoom: built.minZoom,
    maxZoom: built.maxZoom,
    bounds: built.bounds,
    metadata: layerMetadata(built, extraMetadata),
  };
}

/** Package built layer tiles into one PMTiles archive (gzip MVT), in memory. */
export function layerTilesToPmtiles(built: LayerTiles, extraMetadata: Record<string, unknown> = {}): Uint8Array {
  return writePmtiles(
    built.tiles.map((t) => ({ z: t.z, x: t.x, y: t.y, data: t.gzip })),
    archiveOptions(built, extraMetadata),
  );
}

/**
 * Write the PMTiles archive of a spooled layer through `write` (header and
 * directories first, then each distinct tile copied from the spool in tile-id
 * order): the archive is never held whole. Returns its size.
 */
export function writeSpooledPmtiles(
  built: SpooledLayer,
  spool: TileSpool,
  write: (chunk: Uint8Array) => void,
  extraMetadata: Record<string, unknown> = {},
): number {
  const { records } = built;
  const { contents } = records;
  const layout = layoutPmtilesIndexed(
    {
      count: records.length,
      contents: contents.count,
      tileId: (i) => zxyToTileId(records.z(i), records.x(i), records.y(i)),
      length: (i) => contents.length.get(records.content(i)),
      content: (i) => records.content(i),
    },
    archiveOptions(built, extraMetadata),
  );
  write(layout.prefix);
  for (const i of layout.dataOrder) {
    const c = records.content(i);
    write(spool.read(contents.offset.get(c), contents.length.get(c)));
  }
  return layout.totalBytes;
}
