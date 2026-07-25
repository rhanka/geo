/**
 * Minimal, dependency-free GeoJSON type model following RFC 7946.
 *
 * Per RFC 7946 §4, coordinates are in CRS84 / WGS84 (EPSG:4326), longitude then
 * latitude. Any non-WGS84 source must be reprojected before it is emitted as
 * GeoJSON (handled by `@sentropic/geo-acquire`).
 */

/** [longitude, latitude] or [longitude, latitude, elevation]. */
export type Position = [number, number] | [number, number, number];

/** [west, south, east, north] (2D) or with min/max elevation (3D). */
export type BBox =
  | [number, number, number, number]
  | [number, number, number, number, number, number];

export interface Point {
  type: "Point";
  coordinates: Position;
  bbox?: BBox;
}
export interface MultiPoint {
  type: "MultiPoint";
  coordinates: Position[];
  bbox?: BBox;
}
export interface LineString {
  type: "LineString";
  coordinates: Position[];
  bbox?: BBox;
}
export interface MultiLineString {
  type: "MultiLineString";
  coordinates: Position[][];
  bbox?: BBox;
}
export interface Polygon {
  type: "Polygon";
  coordinates: Position[][];
  bbox?: BBox;
}
export interface MultiPolygon {
  type: "MultiPolygon";
  coordinates: Position[][][];
  bbox?: BBox;
}
export interface GeometryCollection {
  type: "GeometryCollection";
  geometries: Geometry[];
  bbox?: BBox;
}

export type Geometry =
  | Point
  | MultiPoint
  | LineString
  | MultiLineString
  | Polygon
  | MultiPolygon
  | GeometryCollection;

export type GeoJsonProperties = Record<string, unknown> | null;

export interface Feature<
  G extends Geometry | null = Geometry,
  P extends GeoJsonProperties = GeoJsonProperties,
> {
  type: "Feature";
  geometry: G;
  properties: P;
  id?: string | number;
  bbox?: BBox;
}

export interface FeatureCollection<
  G extends Geometry | null = Geometry,
  P extends GeoJsonProperties = GeoJsonProperties,
> {
  type: "FeatureCollection";
  features: Feature<G, P>[];
  bbox?: BBox;
}

export const GEOJSON_GEOMETRY_TYPES = [
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
] as const;

export type GeometryType = (typeof GEOJSON_GEOMETRY_TYPES)[number];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isGeometry(value: unknown): value is Geometry {
  return (
    isObject(value) &&
    typeof value["type"] === "string" &&
    (GEOJSON_GEOMETRY_TYPES as readonly string[]).includes(value["type"])
  );
}

export function isFeature(value: unknown): value is Feature {
  return isObject(value) && value["type"] === "Feature" && "geometry" in value;
}

export function isFeatureCollection(value: unknown): value is FeatureCollection {
  return (
    isObject(value) &&
    value["type"] === "FeatureCollection" &&
    Array.isArray(value["features"])
  );
}
