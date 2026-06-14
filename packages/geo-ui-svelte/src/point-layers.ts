/**
 * Point-aggregation layer builders for `GeoMap` (ADR-0016).
 *
 * For POINT inputs (e.g. immo signals — distinct from admin polygons) these
 * consume `@sentropic/dataviz-core`'s point builders and map their
 * rendering-neutral output to NATIVE MapLibre layer specs (no deck.gl yet):
 *
 *  - `hexbin`  — `buildGeoHexbinModel`  → a GeoJSON polygon source (one hex ring
 *                per bin) + a `fill` layer coloured by bin count.
 *  - `cluster` — `buildGeoClusterModel` → a GeoJSON point source + a `circle`
 *                layer sized (and labelled) by cluster count.
 *  - `density` — `buildGeoDensityModel` → a GeoJSON point source + a `heatmap`
 *                layer weighted by per-cell density.
 *
 * Pure functions, no DOM/WebGL — `GeoMap` adds the returned source + layer.
 * The hexagon / no rendering math lives here (dataviz cells carry only a
 * `center`/`bounds`, not a polygon ring — see `BUILDER_NOTES`).
 */

import type {
  GeoClusterModel,
  GeoDensityModel,
  GeoHexbinModel,
} from "@sentropic/dataviz-core";
import {
  buildGeoClusterModel,
  buildGeoDensityModel,
  buildGeoHexbinModel,
} from "@sentropic/dataviz-core";
import type { FeatureCollection, Position } from "@sentropic/geo-core";
import { LAT_KEY, LNG_KEY, pointInput } from "./dataviz-adapter.js";

/** The point-aggregation layer kinds (excludes the polygon `choropleth`). */
export type PointLayerKind = "hexbin" | "cluster" | "density";

/** A minimal GeoJSON source spec + the layer specs to render it (MapLibre). */
export interface PointLayerSpec {
  /** Source id MapLibre will register the GeoJSON under. */
  sourceId: string;
  /** GeoJSON FeatureCollection to feed the source. */
  source: FeatureCollection;
  /**
   * Layer specs (MapLibre `LayerSpecification`s). Typed as `unknown[]` because
   * `maplibre-gl` does not export its spec types from this package's deps; the
   * caller casts at `map.addLayer`.
   */
  layers: unknown[];
}

/** Shared tuning for the point-aggregation builders. */
export interface PointLayerOptions {
  /** Numeric property to weight cells/clusters by (else each point counts 1). */
  valueKey?: string;
  /** Hexbin/density cell size in degrees. Builder default `1`. */
  cellSize?: number;
  /** Cluster merge radius in degrees. Builder default `1`. */
  radius?: number;
  /** Fill/heat colour ramp (lo→hi), already resolved to concrete colours. */
  ramp?: readonly string[];
}

/** Default ramp (resolved fallbacks) mirroring the choropleth ramp. */
const DEFAULT_RAMP: readonly string[] = [
  "#eff6ff",
  "#bfdbfe",
  "#60a5fa",
  "#2563eb",
  "#1e3a8a",
];

/** Regular hexagon ring (6 vertices, closed) around a center, in degrees. */
function hexRing(
  centerLng: number,
  centerLat: number,
  cellSize: number,
): Position[] {
  const ring: Position[] = [];
  const radius = cellSize / 2;
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i + Math.PI / 6;
    ring.push([
      centerLng + radius * Math.cos(angle),
      centerLat + radius * Math.sin(angle),
    ]);
  }
  ring.push(ring[0] as Position); // close the ring
  return ring;
}

/** Max of a numeric accessor across a list (≥ 1 so we never divide by zero). */
function maxOf<T>(items: readonly T[], get: (item: T) => number): number {
  let max = 0;
  for (const item of items) {
    const v = get(item);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return Math.max(max, 1);
}

/** Build a step `[count→color]` interpolation across the ramp. */
function countColorExpr(maxCount: number, ramp: readonly string[]): unknown {
  const stops: unknown[] = ["interpolate", ["linear"], ["get", "count"]];
  const n = ramp.length;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1);
    stops.push(t * maxCount, ramp[i]);
  }
  return stops;
}

/**
 * Hexbin layer: `buildGeoHexbinModel` → a GeoJSON polygon source (a hex ring per
 * bin, properties `count`/`value`) + a `fill` layer coloured by count.
 */
export function buildHexbinLayer(
  data: FeatureCollection,
  layerId: string,
  options: PointLayerOptions = {},
): { spec: PointLayerSpec; model: GeoHexbinModel } {
  const ramp = options.ramp ?? DEFAULT_RAMP;
  const { model, rows } = pointInput(data, options.valueKey);
  const hex = buildGeoHexbinModel(model, rows, {
    longitude: LNG_KEY,
    latitude: LAT_KEY,
    ...(options.valueKey === undefined ? {} : { value: options.valueKey }),
    ...(options.cellSize === undefined ? {} : { cellSize: options.cellSize }),
  });
  const maxCount = maxOf(hex.bins, (b) => b.count);
  const source: FeatureCollection = {
    type: "FeatureCollection",
    features: hex.bins.map((bin) => ({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          hexRing(bin.center.longitude, bin.center.latitude, hex.cellSize),
        ],
      },
      properties: { id: bin.id, count: bin.count, value: bin.value },
    })),
  };
  const sourceId = `${layerId}-src`;
  const spec: PointLayerSpec = {
    sourceId,
    source,
    layers: [
      {
        id: `${layerId}-fill`,
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": countColorExpr(maxCount, ramp),
          "fill-opacity": 0.7,
          "fill-outline-color": ramp[ramp.length - 1],
        },
      },
    ],
  };
  return { spec, model: hex };
}

/**
 * Cluster layer: `buildGeoClusterModel` → a GeoJSON point source (one point per
 * cluster, properties `count`/`value`) + a `circle` layer sized by count and a
 * `symbol` count label.
 */
export function buildClusterLayer(
  data: FeatureCollection,
  layerId: string,
  options: PointLayerOptions = {},
): { spec: PointLayerSpec; model: GeoClusterModel } {
  const ramp = options.ramp ?? DEFAULT_RAMP;
  const { model, rows } = pointInput(data, options.valueKey);
  const cluster = buildGeoClusterModel(model, rows, {
    longitude: LNG_KEY,
    latitude: LAT_KEY,
    ...(options.valueKey === undefined ? {} : { value: options.valueKey }),
    ...(options.radius === undefined ? {} : { radius: options.radius }),
  });
  const maxCount = maxOf(cluster.clusters, (c) => c.count);
  const source: FeatureCollection = {
    type: "FeatureCollection",
    features: cluster.clusters.map((c) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [c.longitude, c.latitude] as Position,
      },
      properties: { id: c.id, count: c.count, value: c.value },
    })),
  };
  const sourceId = `${layerId}-src`;
  const spec: PointLayerSpec = {
    sourceId,
    source,
    layers: [
      {
        id: `${layerId}-circle`,
        type: "circle",
        source: sourceId,
        paint: {
          // Radius scales with count from 8px (singleton) up to 28px (max).
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["get", "count"],
            1,
            8,
            maxCount,
            28,
          ],
          "circle-color": countColorExpr(maxCount, ramp),
          "circle-opacity": 0.85,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      },
      {
        id: `${layerId}-count`,
        type: "symbol",
        source: sourceId,
        layout: {
          "text-field": ["to-string", ["get", "count"]],
          "text-size": 12,
        },
        paint: {
          "text-color": "#ffffff",
        },
      },
    ],
  };
  return { spec, model: cluster };
}

/**
 * Density layer: `buildGeoDensityModel` → a GeoJSON point source (one point per
 * cell at its center, weighted by `density`) + a MapLibre `heatmap` layer.
 */
export function buildDensityLayer(
  data: FeatureCollection,
  layerId: string,
  options: PointLayerOptions = {},
): { spec: PointLayerSpec; model: GeoDensityModel } {
  const { model, rows } = pointInput(data, options.valueKey);
  const density = buildGeoDensityModel(model, rows, {
    longitude: LNG_KEY,
    latitude: LAT_KEY,
    ...(options.valueKey === undefined ? {} : { value: options.valueKey }),
    ...(options.cellSize === undefined ? {} : { cellSize: options.cellSize }),
  });
  const maxDensity = maxOf(density.cells, (c) => c.density);
  const source: FeatureCollection = {
    type: "FeatureCollection",
    features: density.cells.map((cell) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [
          cell.center.longitude,
          cell.center.latitude,
        ] as Position,
      },
      properties: {
        id: cell.id,
        count: cell.count,
        value: cell.value,
        density: cell.density,
      },
    })),
  };
  const sourceId = `${layerId}-src`;
  const spec: PointLayerSpec = {
    sourceId,
    source,
    layers: [
      {
        id: `${layerId}-heat`,
        type: "heatmap",
        source: sourceId,
        paint: {
          // Normalize each cell's density into the heatmap weight [0,1].
          "heatmap-weight": [
            "interpolate",
            ["linear"],
            ["get", "density"],
            0,
            0,
            maxDensity,
            1,
          ],
          "heatmap-radius": 24,
          "heatmap-opacity": 0.75,
        },
      },
    ],
  };
  return { spec, model: density };
}

/** Dispatch to the matching point-aggregation builder by kind. */
export function buildPointLayer(
  kind: PointLayerKind,
  data: FeatureCollection,
  layerId: string,
  options: PointLayerOptions = {},
): PointLayerSpec {
  switch (kind) {
    case "hexbin":
      return buildHexbinLayer(data, layerId, options).spec;
    case "cluster":
      return buildClusterLayer(data, layerId, options).spec;
    case "density":
      return buildDensityLayer(data, layerId, options).spec;
  }
}
