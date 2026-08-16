import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "@sentropic/geo-core";

import type { GeoLayerSpec, LayerData } from "./layers.js";
import {
  DeclarativeLayerReconciler,
  type MaplibreLayerDefinition,
  type MaplibreLayerTarget,
} from "./layer-reconciler.js";
import {
  compileColorEncoding,
  compileNumberEncoding,
  createMaplibreLayerProjector,
  projectMaplibreLayer,
} from "./paint-compiler.js";

const tokens = {
  category1: "#4e79a7",
  category2: "#f28e2b",
  category3: "#59a14f",
  "border-subtle": "#e2e8f0",
} as const;

const polygons: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { density: 12, category: "commercial", size: 8 },
      geometry: {
        type: "Polygon",
        coordinates: [[[-71.2, 46.8], [-71.1, 46.8], [-71.1, 46.9], [-71.2, 46.8]]],
      },
    },
  ],
};

class FakeMaplibreMap implements MaplibreLayerTarget {
  readonly layers = new Map<string, MaplibreLayerDefinition>();

  addLayer(layer: MaplibreLayerDefinition): void {
    this.layers.set(layer.id, layer);
  }

  removeLayer(id: string): void {
    this.layers.delete(id);
  }

  getLayer(id: string): MaplibreLayerDefinition | undefined {
    return this.layers.get(id);
  }

  setPaintProperty(_id: string, _property: string, _value: unknown): void {}

  setData(_id: string, _data: LayerData): void {}
}

describe("paint compiler", () => {
  it("should compile every neutral color encoding through the resolved token map", () => {
    expect(compileColorEncoding({ by: "constant", token: "category1" }, tokens)).toBe("#4e79a7");
    expect(
      compileColorEncoding(
        { by: "category", field: "category", map: { residential: "category1", commercial: "category2" } },
        tokens,
      ),
    ).toEqual([
      "match",
      ["get", "category"],
      "residential",
      "#4e79a7",
      "commercial",
      "#f28e2b",
      "#4e79a7",
    ]);
    expect(
      compileColorEncoding(
        {
          by: "valueStep",
          field: "density",
          stops: [
            { upTo: 10, token: "category1" },
            { upTo: 25, token: "category2" },
            { upTo: Number.POSITIVE_INFINITY, token: "category3" },
          ],
        },
        tokens,
      ),
    ).toEqual(["step", ["get", "density"], "#4e79a7", 10, "#f28e2b", 25, "#59a14f"]);
    expect(
      compileColorEncoding(
        {
          by: "valueRamp",
          field: "density",
          domain: [0, 100],
          ramp: ["category1", "category2", "category3"],
        },
        tokens,
      ),
    ).toEqual([
      "interpolate",
      ["linear"],
      ["get", "density"],
      0,
      "#4e79a7",
      50,
      "#f28e2b",
      100,
      "#59a14f",
    ]);
  });

  it("should compile constant and value-driven numeric channels", () => {
    expect(compileNumberEncoding({ by: "constant", value: 3 })).toBe(3);
    expect(
      compileNumberEncoding({ by: "value", field: "size", domain: [0, 10], range: [4, 18] }),
    ).toEqual(["interpolate", ["linear"], ["get", "size"], 0, 4, 10, 18]);
  });

  it("should hard-fail when an encoding references an absent token role", () => {
    expect(() => compileColorEncoding({ by: "constant", token: "missing-role" }, tokens)).toThrow(
      "Missing resolved token for role: missing-role",
    );
  });

  it("should create fresh paint from a replacement token map", () => {
    const encoding = { by: "constant", token: "category1" } as const;
    expect(compileColorEncoding(encoding, tokens)).toBe("#4e79a7");
    expect(compileColorEncoding(encoding, { ...tokens, category1: "#1d4ed8" })).toBe("#1d4ed8");
  });

  it("should project complete choropleth and points layers through W1's injected projector", () => {
    const layers: readonly GeoLayerSpec[] = [
      {
        id: "layers/density",
        kind: "choropleth",
        data: polygons,
        fill: { color: { by: "constant", token: "category1" }, opacity: { by: "constant", value: 0.72 } },
        outline: { color: { by: "constant", token: "border-subtle" } },
        extrusion: { heightField: "density", unit: "m" },
      },
      {
        id: "layers/signals",
        kind: "points",
        data: { sourceRef: "signals" },
        color: { by: "constant", token: "category2" },
        radius: { by: "value", field: "size", domain: [0, 10], range: [4, 18] },
      },
    ];
    const map = new FakeMaplibreMap();
    const reconciler = new DeclarativeLayerReconciler(map, {
      layerIdPrefix: "layers/",
      project: createMaplibreLayerProjector(tokens),
    });

    reconciler.setLayers(layers);

    expect(map.layers.get("layers/density")).toMatchObject({
      id: "layers/density",
      type: "fill",
      source: { type: "geojson", data: polygons },
      paint: {
        "fill-color": "#4e79a7",
        "fill-opacity": 0.72,
        "fill-outline-color": "#e2e8f0",
      },
    });
    expect(map.layers.get("layers/signals")).toMatchObject({
      id: "layers/signals",
      type: "circle",
      source: "signals",
      paint: {
        "circle-color": "#f28e2b",
        "circle-radius": ["interpolate", ["linear"], ["get", "size"], 0, 4, 10, 18],
      },
    });
  });

  it("should project each supported geojson primitive to its MapLibre paint kind", () => {
    const base = { id: "layers/geojson", kind: "geojson" as const, data: polygons };

    expect(
      projectMaplibreLayer(
        { ...base, fill: { color: { by: "constant", token: "category1" } } },
        tokens,
      ).layer,
    ).toMatchObject({ type: "fill", paint: { "fill-color": "#4e79a7" } });
    expect(
      projectMaplibreLayer(
        {
          ...base,
          outline: {
            color: { by: "constant", token: "border-subtle" },
            width: { by: "constant", value: 2 },
          },
        },
        tokens,
      ).layer,
    ).toMatchObject({
      type: "line",
      paint: { "line-color": "#e2e8f0", "line-width": 2 },
    });
    expect(
      projectMaplibreLayer(
        {
          ...base,
          points: {
            color: { by: "constant", token: "category2" },
            radius: { by: "constant", value: 5 },
          },
        },
        tokens,
      ).layer,
    ).toMatchObject({
      type: "circle",
      paint: { "circle-color": "#f28e2b", "circle-radius": 5 },
    });
    expect(
      projectMaplibreLayer(
        {
          ...base,
          label: { field: "category", color: { by: "constant", token: "category3" } },
        },
        tokens,
      ).layer,
    ).toMatchObject({
      type: "symbol",
      layout: { "text-field": ["get", "category"] },
      paint: { "text-color": "#59a14f" },
    });
  });
});
