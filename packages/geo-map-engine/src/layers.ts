/**
 * Layer model `GeoLayerSpec` — SPEC_GEO_MAP_ENGINE §1.3.1 (FROZEN v1).
 *
 * A discriminated union (on `kind`). `data` is a geo-core `FeatureCollection` (the GeoJSON
 * model lives in `@sentropic/geo-core`, RFC 7946) or a source reference. All visual channels
 * pass through neutral {@link ColorEncoding}/{@link NumberEncoding} — never a raw maplibre
 * expression (§1.1 principle 1). The engine compiles them to paint PER RENDERER.
 *
 * Frozen v1 concrete kinds: `choropleth`, `points`, `geojson` — the set proven at the gate
 * (§9) and required by the DS consumer contract. Additional kinds (`hexbin`, `cluster`,
 * `density`, `flow`) — enumerated in the spec, consuming neutral bins/encodings from
 * `dataviz-core` — are added ADDITIVELY when a real layer requires them (arbitrage E.2,
 * non-breaking); they are reserved here rather than half-specified.
 */

import type { FeatureCollection } from "@sentropic/geo-core";
import type { ColorEncoding, NumberEncoding } from "./encodings.js";

/** GeoJSON FeatureCollection served to the engine, or an opaque source reference (§1.3.1). */
export type LayerData = FeatureCollection | { sourceRef: string };

/** Per-layer interactivity (§1.3.1). `idField` keys hover/select back to a feature. */
export interface LayerInteractivity {
  hover?: boolean;
  select?: boolean;
  idField: string;
}

/** 3D extrusion (optional, non-breaking — the 2D renderer ignores it). §1.3.1 / E.4. */
export interface ExtrusionSpec {
  heightField: string;
  unit: "m";
}

/** 3D per-vertex elevation (optional, non-breaking). §1.3.1 / E.4. */
export interface ElevationSpec {
  field: string;
}

/** Fields common to every {@link GeoLayerSpec} member (§1.3.1). `id` is namespaced (§1.4). */
interface LayerCommon {
  id: string;
  visible?: boolean;
  opacity?: NumberEncoding;
  interactivity?: LayerInteractivity;
  extrusion?: ExtrusionSpec;
  elevation?: ElevationSpec;
}

/** A filled area sub-spec (§1.3.1). */
export interface FillSpec {
  color: ColorEncoding;
  opacity?: NumberEncoding;
}

/** A stroked outline sub-spec (§1.3.1). */
export interface OutlineSpec {
  color: ColorEncoding;
  width?: NumberEncoding;
}

/** Point / marker sub-spec (§1.3.1). */
export interface PointSymbolSpec {
  color: ColorEncoding;
  radius: NumberEncoding;
}

/** Text label sub-spec (§1.3.1). */
export interface LabelSpec {
  field: string;
  color?: ColorEncoding;
}

/** Choropleth layer: neutral bins/`valueStep` fill + optional outline + optional 3D extrusion (§1.3.1). */
export interface ChoroplethLayer extends LayerCommon {
  kind: "choropleth";
  data: LayerData;
  fill: FillSpec;
  outline?: OutlineSpec;
}

/** Points/markers layer: radius ∝ value + color encoding (§1.3.1). */
export interface PointsLayer extends LayerCommon {
  kind: "points";
  data: LayerData;
  color: ColorEncoding;
  radius: NumberEncoding;
}

/** Generic GeoJSON layer with optional fill/outline/points/label sub-specs (§1.3.1). */
export interface GeojsonLayer extends LayerCommon {
  kind: "geojson";
  data: LayerData;
  fill?: FillSpec;
  outline?: OutlineSpec;
  points?: PointSymbolSpec;
  label?: LabelSpec;
}

/** The frozen v1 layer contract (§1.3.1). See module note on reserved additive kinds. */
export type GeoLayerSpec = ChoroplethLayer | PointsLayer | GeojsonLayer;

/** Concrete v1 layer kinds. Reserved additive kinds (E.2): `hexbin` | `cluster` | `density` | `flow`. */
export const LAYER_KINDS = ["choropleth", "points", "geojson"] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];
