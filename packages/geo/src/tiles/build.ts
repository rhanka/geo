/**
 * Build the vector tiles of one polygon layer (SPEC_VECTOR_TILES.md).
 *
 * Guarantees, checked per zoom and reported in {@link ZoomStats}:
 *
 * - no feature dropping: every source polygon feature is present in at least
 *   one tile of every zoom (`missing` must be 0). A feature whose geometry
 *   collapses on the zoom's pixel grid (smaller than one tile unit) is kept as
 *   a one-unit square at its quantized position (`markers`): it stays present
 *   and queryable, and the shift is within the grid's own rounding;
 * - shared borders: simplification runs on arcs between junctions over the
 *   whole layer (geometry.ts), so neighbours keep identical borders;
 * - property whitelist: only the profile's properties reach the tile, by zoom
 *   tier (`tierProperties`: lots carry only `zoneCode` below z14).
 *
 * MVT feature id: profile rule (`FeatureIdAssigner`) — lots: the lot number
 * (`noLot` without spaces), with a deterministic fallback; zones: the source
 * ordinal.
 *
 * Features are fed one at a time ({@link LayerTilesBuilder.add}), so a caller
 * that streams the source never holds the parsed collection.
 */

import { gzipSync } from "node:zlib";

import { clipRing, ringBBox, type Rect } from "./clip.js";
import {
  isUsableRing,
  projectRing,
  quantizeRing,
  simplifyLayer,
  unmatchedEdgeLength,
  type QPolygon,
  type WorldPolygon,
} from "./geometry.js";
import { encodeMvt, type MvtPolygonFeature } from "./mvt.js";
import { PmCompression, PmTileType, writePmtiles } from "./pmtiles.js";
import {
  FeatureIdAssigner,
  pickProperties,
  tierProperties,
  type FeatureIdStats,
  type LayerProfile,
  type TileValue,
} from "./profiles.js";

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

/** The source exceeds a build budget ({@link BuildTilesOptions.maxFeatures}); raised before the heavy work. */
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
  /**
   * Receives each tile as soon as it is encoded; the tiles are then NOT kept
   * in {@link LayerTiles.tiles} (bounded memory for a streaming writer).
   */
  onTile?: (tile: BuiltTile) => void;
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

export interface LayerTiles {
  layer: string;
  features: number;
  skippedNonPolygon: number;
  bounds: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  fields: Record<string, string>;
  /** Every tile, unless {@link BuildTilesOptions.onTile} consumed them. */
  tiles: BuiltTile[];
  /** Number of tiles built (also with `onTile`). */
  tileCount: number;
  zooms: ZoomStats[];
  ids: FeatureIdStats;
}

interface PreparedFeature {
  id: number;
  properties: Record<string, TileValue>;
  polygons: WorldPolygon[];
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

/**
 * Accumulates the source one feature at a time (projected rings + whitelisted
 * properties; the parsed GeoJSON is not retained), then builds every zoom.
 */
export class LayerTilesBuilder {
  readonly #profile: LayerProfile;
  readonly #options: BuildTilesOptions;
  readonly #ids: FeatureIdAssigner;
  readonly #prepared: PreparedFeature[] = [];
  readonly #fields: Record<string, string> = {};
  #ordinal = 0;
  #skippedNonPolygon = 0;
  #minLon = Infinity;
  #minLat = Infinity;
  #maxLon = -Infinity;
  #maxLat = -Infinity;

  constructor(profile: LayerProfile, options: BuildTilesOptions = {}) {
    this.#profile = profile;
    this.#options = options;
    this.#ids = new FeatureIdAssigner(profile.featureId);
  }

  /** Polygon features added so far. */
  get features(): number {
    return this.#prepared.length;
  }

  add(f: SourceFeature): void {
    const ordinal = this.#ordinal++;
    const polys = polygonsOf(f.geometry);
    if (!polys || polys.length === 0) {
      this.#skippedNonPolygon++;
      return;
    }
    const max = this.#options.maxFeatures;
    if (max !== undefined && this.#prepared.length >= max) {
      throw new TileBudgetError(`more than ${max} polygon features`);
    }
    for (const poly of polys) {
      for (const ring of poly) {
        for (const p of ring) {
          const lon = p[0]!;
          const lat = p[1]!;
          if (lon < this.#minLon) this.#minLon = lon;
          if (lon > this.#maxLon) this.#maxLon = lon;
          if (lat < this.#minLat) this.#minLat = lat;
          if (lat > this.#maxLat) this.#maxLat = lat;
        }
      }
    }
    const properties = pickProperties(f.properties, this.#profile, this.#options.citySlug);
    for (const [k, v] of Object.entries(properties)) {
      this.#fields[k] ??= typeof v === "string" ? "String" : typeof v === "number" ? "Number" : "Boolean";
    }
    const id = this.#ids.assign(ordinal, f.properties);
    const polygons = polys.map((poly) => poly.map(projectRing));
    this.#countTilePairs(polygons);
    this.#prepared.push({ id, properties, polygons });
  }

  #tilePairs = 0;

  /** Tiles each exterior ring's bbox (+ buffer) touches at maxZoom, accumulated against the budget. */
  #countTilePairs(polygons: WorldPolygon[]): void {
    const z = this.#options.maxZoom ?? TILE_DEFAULTS.maxZoom;
    const n = 2 ** z;
    const pad = (this.#options.buffer ?? TILE_DEFAULTS.buffer) / (this.#options.extent ?? TILE_DEFAULTS.extent);
    for (const poly of polygons) {
      const ring = poly[0]!;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < ring.length; i += 2) {
        const x = ring[i]! * n;
        const y = ring[i + 1]! * n;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (!Number.isFinite(minX)) continue;
      const tx0 = Math.max(0, Math.floor(minX - pad));
      const tx1 = Math.min(n - 1, Math.floor(maxX + pad));
      const ty0 = Math.max(0, Math.floor(minY - pad));
      const ty1 = Math.min(n - 1, Math.floor(maxY + pad));
      this.#tilePairs += Math.max(0, tx1 - tx0 + 1) * Math.max(0, ty1 - ty0 + 1);
    }
    const max = this.#options.maxTilePairs ?? DEFAULT_MAX_TILE_PAIRS;
    if (this.#tilePairs > max) throw new TileBudgetError(`more than ${max} (feature, tile) pairs at z${z}`);
  }

  /** Build every tile of the layer, `minZoom` … `maxZoom`. */
  finish(): LayerTiles {
    return buildPrepared(
      this.#prepared,
      this.#profile,
      this.#options,
      this.#skippedNonPolygon,
      [this.#minLon, this.#minLat, this.#maxLon, this.#maxLat],
      this.#fields,
      this.#ids.stats,
    );
  }
}

function quantizeFeature(f: PreparedFeature, scale: number): QPolygon[] {
  const out: QPolygon[] = [];
  for (const poly of f.polygons) {
    const ext = quantizeRing(poly[0]!, scale);
    if (!isUsableRing(ext)) continue;
    const rings: QPolygon = [ext];
    for (let i = 1; i < poly.length; i++) {
      const hole = quantizeRing(poly[i]!, scale);
      if (isUsableRing(hole)) rings.push(hole);
    }
    out.push(rings);
  }
  return out;
}

/** One-unit square at the quantized centre of the feature's exterior rings. */
function markerFor(f: PreparedFeature, scale: number): QPolygon[] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const poly of f.polygons) {
    const ext = poly[0]!;
    for (let i = 0; i < ext.length; i += 2) {
      sx += ext[i]!;
      sy += ext[i + 1]!;
      n++;
    }
  }
  const x = Math.floor((sx / n) * scale);
  const y = Math.floor((sy / n) * scale);
  // Clockwise on screen (y down): positive shoelace area.
  return [[Int32Array.from([x, y, x + 1, y, x + 1, y + 1, x, y + 1])]];
}

/** Build every tile of one layer, `minZoom` … `maxZoom`. */
export function buildLayerTiles(features: Iterable<SourceFeature>, profile: LayerProfile, options: BuildTilesOptions = {}): LayerTiles {
  const builder = new LayerTilesBuilder(profile, options);
  for (const f of features) builder.add(f);
  return builder.finish();
}

function buildPrepared(
  prepared: PreparedFeature[],
  profile: LayerProfile,
  options: BuildTilesOptions,
  skippedNonPolygon: number,
  bounds: [number, number, number, number],
  fields: Record<string, string>,
  ids: FeatureIdStats,
): LayerTiles {
  const minZoom = options.minZoom ?? TILE_DEFAULTS.minZoom;
  const maxZoom = options.maxZoom ?? TILE_DEFAULTS.maxZoom;
  const extent = options.extent ?? TILE_DEFAULTS.extent;
  const buffer = options.buffer ?? TILE_DEFAULTS.buffer;
  const tolerance = options.tolerance ?? TILE_DEFAULTS.tolerance;
  const maxZoomTolerance = options.maxZoomTolerance ?? TILE_DEFAULTS.maxZoomTolerance;
  const sharedBorders = options.sharedBorders ?? TILE_DEFAULTS.sharedBorders;
  const gzipLevel = options.gzipLevel ?? TILE_DEFAULTS.gzipLevel;
  if (minZoom < 0 || maxZoom > 18 || minZoom > maxZoom) throw new Error(`zoom range out of bounds: ${minZoom}…${maxZoom}`);

  const tiles: BuiltTile[] = [];
  let tileCount = 0;
  const zooms: ZoomStats[] = [];

  for (let z = minZoom; z <= maxZoom; z++) {
    const t0 = performance.now();
    const scale = extent * 2 ** z;
    const tilesPerAxis = 2 ** z;
    let markers = 0;
    const quantized = prepared.map((f) => {
      const q = quantizeFeature(f, scale);
      if (q.length > 0) return q;
      markers++;
      return markerFor(f, scale);
    });
    const tol = z === maxZoom ? maxZoomTolerance : tolerance;
    const unmatchedBefore = options.borderCheck ? unmatchedEdgeLength(quantized) : undefined;
    const { layer: simplified, stats } = simplifyLayer(quantized, tol, sharedBorders);
    const unmatchedAfter = options.borderCheck ? unmatchedEdgeLength(simplified) : undefined;

    // Bucket clipped parts per tile.
    const buckets = new Map<number, MvtPolygonFeature[]>();
    const present = new Set<number>();
    simplified.forEach((polys, fi) => {
      const f = prepared[fi]!;
      const perTile = new Map<number, Int32Array[][]>();
      for (const poly of polys) {
        const bb = ringBBox(poly[0]!);
        const tx0 = Math.max(0, Math.floor((bb.minX - buffer) / extent));
        const tx1 = Math.min(tilesPerAxis - 1, Math.floor((bb.maxX + buffer) / extent));
        const ty0 = Math.max(0, Math.floor((bb.minY - buffer) / extent));
        const ty1 = Math.min(tilesPerAxis - 1, Math.floor((bb.maxY + buffer) / extent));
        for (let tx = tx0; tx <= tx1; tx++) {
          for (let ty = ty0; ty <= ty1; ty++) {
            const ox = tx * extent;
            const oy = ty * extent;
            const rect: Rect = { minX: ox - buffer, minY: oy - buffer, maxX: ox + extent + buffer, maxY: oy + extent + buffer };
            const ext = clipRing(poly[0]!, rect, ox, oy);
            if (!ext) continue;
            const rings: Int32Array[] = [ext];
            for (let h = 1; h < poly.length; h++) {
              const hole = clipRing(poly[h]!, rect, ox, oy);
              if (hole) rings.push(hole);
            }
            const key = tx * tilesPerAxis + ty;
            let list = perTile.get(key);
            if (!list) perTile.set(key, (list = []));
            list.push(rings);
          }
        }
      }
      if (perTile.size === 0) {
        // Every clipped part degenerated (a sliver along a tile edge): keep the
        // feature present as a marker in the tile holding its centre.
        markers++;
        const square = markerFor(f, scale)[0]![0]!;
        const tx = Math.min(tilesPerAxis - 1, Math.floor(square[0]! / extent));
        const ty = Math.min(tilesPerAxis - 1, Math.floor(square[1]! / extent));
        const local = square.map((v, i) => v - (i % 2 === 0 ? tx : ty) * extent);
        perTile.set(tx * tilesPerAxis + ty, [[Int32Array.from(local)]]);
      }
      const properties = tierProperties(f.properties, profile, z);
      for (const [key, polygons] of perTile) {
        let bucket = buckets.get(key);
        if (!bucket) buckets.set(key, (bucket = []));
        bucket.push({ id: f.id, properties, polygons });
        present.add(fi);
      }
    });

    let maxTileBytes = 0;
    let maxTileGzipBytes = 0;
    let totalTileBytes = 0;
    let totalGzipBytes = 0;
    let maxFeaturesPerTile = 0;
    for (const [key, list] of buckets) {
      const x = Math.floor(key / tilesPerAxis);
      const y = key % tilesPerAxis;
      const raw = encodeMvt([{ name: profile.layer, extent, features: list }]);
      const gz = gzipSync(raw, { level: gzipLevel });
      const tile: BuiltTile = { z, x, y, gzip: gz, bytes: raw.length };
      if (options.onTile) options.onTile(tile);
      else tiles.push(tile);
      tileCount++;
      maxTileBytes = Math.max(maxTileBytes, raw.length);
      maxTileGzipBytes = Math.max(maxTileGzipBytes, gz.length);
      totalTileBytes += raw.length;
      totalGzipBytes += gz.length;
      maxFeaturesPerTile = Math.max(maxFeaturesPerTile, list.length);
    }
    zooms.push({
      z,
      tiles: buckets.size,
      featuresPresent: present.size,
      missing: prepared.length - present.size,
      markers,
      verticesIn: stats.verticesIn,
      verticesOut: stats.verticesOut,
      fallbackRings: stats.fallbackRings,
      junctions: stats.junctions,
      maxTileBytes,
      maxTileGzipBytes,
      totalTileBytes,
      totalGzipBytes,
      maxFeaturesPerTile,
      ...(unmatchedBefore !== undefined ? { unmatchedBefore: Math.round(unmatchedBefore) } : {}),
      ...(unmatchedAfter !== undefined ? { unmatchedAfter: Math.round(unmatchedAfter) } : {}),
      ms: Math.round(performance.now() - t0),
    });
  }

  return { layer: profile.layer, features: prepared.length, skippedNonPolygon, bounds, minZoom, maxZoom, fields, tiles, tileCount, zooms, ids };
}

/** TileJSON-style metadata stored in the archive. */
export function layerMetadata(built: Omit<LayerTiles, "tiles">, extraMetadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: "pbf",
    generator: "@sentropic/geo tiles",
    vector_layers: [{ id: built.layer, fields: built.fields, minzoom: built.minZoom, maxzoom: built.maxZoom }],
    ...extraMetadata,
  };
}

/** Package built layer tiles into one PMTiles archive (gzip MVT). */
export function layerTilesToPmtiles(built: LayerTiles, extraMetadata: Record<string, unknown> = {}): Uint8Array {
  return writePmtiles(
    built.tiles.map((t) => ({ z: t.z, x: t.x, y: t.y, data: t.gzip })),
    {
      tileCompression: PmCompression.Gzip,
      tileType: PmTileType.Mvt,
      minZoom: built.minZoom,
      maxZoom: built.maxZoom,
      bounds: built.bounds,
      metadata: layerMetadata(built, extraMetadata),
    },
  );
}
