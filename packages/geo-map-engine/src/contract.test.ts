import { describe, it, expect } from "vitest";
import type { FeatureCollection } from "@sentropic/geo-core";

import {
  CONTRACT_VERSION,
  COLOR_ENCODING_KINDS,
  LAYER_KINDS,
  RENDERER_KINDS,
  NORMALIZED_ZOOM,
  type BasemapSpec,
  type GeoLayerSpec,
  type GeoViewport,
  type TokenMap,
} from "./index.js";

// A FeatureCollection from the geo-core GeoJSON model (the engine's `data` type).
const polygons: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "poly-1",
      properties: { id: "poly-1", d: 5 },
      geometry: { type: "Polygon", coordinates: [[[-72.5, 46.5], [-71.5, 46.5], [-71.5, 47.5], [-72.5, 47.5], [-72.5, 46.5]]] },
    },
  ],
};

// Mirrors the DS consumer payload (choropleth valueStep + extrusion; points radius∝value).
const choropleth: GeoLayerSpec = {
  id: "spike/choropleth-density",
  kind: "choropleth",
  data: polygons,
  interactivity: { hover: true, select: true, idField: "id" },
  fill: {
    color: {
      by: "valueStep",
      field: "d",
      stops: [
        { upTo: 10, token: "category1" },
        { upTo: 25, token: "category3" },
        { upTo: 50, token: "category5" },
        { upTo: Number.POSITIVE_INFINITY, token: "category7" },
      ],
    },
    opacity: { by: "constant", value: 0.72 },
  },
  outline: { color: { by: "constant", token: "border-subtle" }, width: { by: "constant", value: 1 } },
  extrusion: { heightField: "d", unit: "m" },
};

const points: GeoLayerSpec = {
  id: "spike/points-signals",
  kind: "points",
  data: { sourceRef: "signals" },
  color: { by: "constant", token: "category2" },
  radius: { by: "value", field: "w", domain: [0, 100], range: [4, 18] },
};

const tokens: TokenMap = {
  category1: "#4e79a7",
  category2: "#f28e2b",
  category3: "#59a14f",
  category5: "#af7aa1",
  category7: "#9c755f",
  "border-subtle": "#e2e8f0",
  "surface-default": "#ffffff",
};

const basemap: BasemapSpec = { kind: "blank", background: "surface-default" };
const vp2d: GeoViewport = { center: [-71.5, 47], zoom: 6, bearing: 0, pitch: 0 };
const vp3d: GeoViewport = { center: [-71.5, 47], zoom: 6, bearing: 30, pitch: 55 };

describe("@sentropic/geo-map-engine — frozen v1 contract (ADR-0026)", () => {
  it("exposes the frozen contract version", () => {
    expect(CONTRACT_VERSION).toBe("1.0.0");
  });

  it("accepts a conforming choropleth + points layer set (DS consumer payload)", () => {
    const layers: readonly GeoLayerSpec[] = [choropleth, points];
    expect(layers.map((l) => l.kind)).toEqual(["choropleth", "points"]);
    expect(choropleth.kind === "choropleth" && choropleth.fill.color.by).toBe("valueStep");
    expect(points.kind === "points" && points.radius.by).toBe("value");
  });

  it("carries a blank basemap + a resolved token map (roles → primitives, DOM-free)", () => {
    expect(basemap.kind).toBe("blank");
    expect(basemap.kind === "blank" && tokens[basemap.background]).toBe("#ffffff");
  });

  it("round-trips a viewport across the 2D/3D common domain (§1.5.1)", () => {
    // Same GeoViewport type feeds both renderers — no contract change 2D↔3D.
    const both: readonly GeoViewport[] = [vp2d, vp3d];
    expect(both.every((v) => v.center.length === 2)).toBe(true);
    expect(vp3d.pitch).toBeGreaterThan(vp2d.pitch);
  });

  it("declares the frozen v1 discriminant sets", () => {
    expect(RENDERER_KINDS).toEqual(["2d", "3d"]);
    expect(LAYER_KINDS).toEqual(["choropleth", "points", "geojson"]);
    expect(COLOR_ENCODING_KINDS).toContain("valueStep");
    expect(NORMALIZED_ZOOM.tileSize).toBe(512);
  });
});
