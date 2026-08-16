/**
 * Renderer-neutral feature-query helpers — SPEC_GEO_MAP_ENGINE §1.3.4.
 *
 * MapLibre feature objects are intentionally reduced to these JSON-shaped
 * inputs before they cross this seam. The public handle therefore never
 * exposes a renderer type.
 */

import type { GeoLayerSpec } from "./layers.js";
import type { GeoBounds, GeoFeatureHit } from "./surface.js";

/** The renderer metadata needed to resolve one displayed feature to a layer. */
export interface RenderedFeatureMetadata {
  readonly layerId: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

/** Resolves a projected renderer layer ID to its neutral parent layer ID. */
export function parentLayerId(layerId: string): string {
  const separator = layerId.indexOf("::");
  return separator === -1 ? layerId : layerId.slice(0, separator);
}

/**
 * Maps a displayed renderer feature to the frozen neutral hit surface. Layers
 * without an interactivity identity deliberately cannot become a hit: the
 * public contract has no renderer feature identifier fallback.
 */
export function mapRenderedFeatureHit(
  feature: RenderedFeatureMetadata,
  layers: readonly GeoLayerSpec[],
  interaction?: "hover" | "select",
): GeoFeatureHit | null {
  const layer = layers.find((candidate) => candidate.id === parentLayerId(feature.layerId));
  const interactivity = layer?.interactivity;
  if (!interactivity || (interaction !== undefined && !interactivity[interaction])) return null;

  const featureId = feature.properties?.[interactivity.idField];
  if (typeof featureId !== "string" && typeof featureId !== "number") return null;
  return {
    layerId: layer.id,
    featureId,
    properties: feature.properties ?? {},
  };
}

/** Calculates CRS84 bounds from a GeoJSON geometry, ignoring Z ordinates. */
export function geometryBounds(geometry: unknown): GeoBounds | null {
  const accumulator = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  visitGeometry(geometry, accumulator);
  return accumulator.west === Infinity ? null : accumulator;
}

type BoundsAccumulator = GeoBounds;

function visitGeometry(geometry: unknown, bounds: BoundsAccumulator): void {
  if (!isRecord(geometry)) return;
  if (geometry["type"] === "GeometryCollection") {
    const geometries = geometry["geometries"];
    if (Array.isArray(geometries)) geometries.forEach((child) => visitGeometry(child, bounds));
    return;
  }

  switch (geometry["type"]) {
    case "Point":
      visitPosition(geometry["coordinates"], bounds);
      return;
    case "MultiPoint":
    case "LineString":
      visitPositions(geometry["coordinates"], bounds);
      return;
    case "MultiLineString":
    case "Polygon":
      visitPositionGroups(geometry["coordinates"], bounds);
      return;
    case "MultiPolygon":
      visitPolygonGroups(geometry["coordinates"], bounds);
      return;
  }
}

function visitPositions(value: unknown, bounds: BoundsAccumulator): void {
  if (Array.isArray(value)) value.forEach((position) => visitPosition(position, bounds));
}

function visitPositionGroups(value: unknown, bounds: BoundsAccumulator): void {
  if (Array.isArray(value)) value.forEach((positions) => visitPositions(positions, bounds));
}

function visitPolygonGroups(value: unknown, bounds: BoundsAccumulator): void {
  if (Array.isArray(value)) value.forEach((groups) => visitPositionGroups(groups, bounds));
}

function visitPosition(value: unknown, bounds: BoundsAccumulator): void {
  if (!Array.isArray(value)) return;
  const [longitude, latitude] = value;
  if (typeof longitude !== "number" || typeof latitude !== "number") return;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;

  bounds.west = Math.min(bounds.west, longitude);
  bounds.south = Math.min(bounds.south, latitude);
  bounds.east = Math.max(bounds.east, longitude);
  bounds.north = Math.max(bounds.north, latitude);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
