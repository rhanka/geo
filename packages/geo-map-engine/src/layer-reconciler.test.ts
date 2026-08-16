import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "@sentropic/geo-core";

import type { GeoLayerSpec, LayerData } from "./layers.js";
import {
  DeclarativeLayerReconciler,
  type MaplibreLayerDefinition,
  type MaplibreLayerProjection,
  type MaplibreLayerTarget,
} from "./layer-reconciler.js";

type MapCall = {
  readonly method: "addLayer" | "removeLayer" | "getLayer" | "setPaintProperty" | "setData";
  readonly id: string;
  readonly property?: string;
  readonly value?: unknown;
  readonly beforeId?: string;
};

/** In-memory MapLibre seam: no canvas, WebGL, or browser runtime. */
class FakeMaplibreMap implements MaplibreLayerTarget {
  readonly layers = new Map<string, MaplibreLayerDefinition>();
  readonly calls: MapCall[] = [];

  seed(layer: MaplibreLayerDefinition): void {
    this.layers.set(layer.id, layer);
  }

  addLayer(layer: MaplibreLayerDefinition, beforeId?: string): void {
    this.calls.push({ method: "addLayer", id: layer.id, value: layer, ...(beforeId ? { beforeId } : {}) });
    if (!beforeId || !this.layers.has(beforeId)) {
      this.layers.set(layer.id, layer);
      return;
    }

    const existing = [...this.layers];
    this.layers.clear();
    for (const [id, existingLayer] of existing) {
      if (id === beforeId) this.layers.set(layer.id, layer);
      this.layers.set(id, existingLayer);
    }
  }

  removeLayer(id: string): void {
    this.calls.push({ method: "removeLayer", id });
    this.layers.delete(id);
  }

  getLayer(id: string): MaplibreLayerDefinition | undefined {
    this.calls.push({ method: "getLayer", id });
    return this.layers.get(id);
  }

  setPaintProperty(id: string, property: string, value: unknown): void {
    this.calls.push({ method: "setPaintProperty", id, property, value });
  }

  setData(id: string, data: LayerData): void {
    this.calls.push({ method: "setData", id, value: data });
  }

  clearCalls(): void {
    this.calls.length = 0;
  }
}

function featureCollection(value: string): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { value },
        geometry: { type: "Point", coordinates: [-71.2, 46.8] },
      },
    ],
  };
}

function choropleth(id: string, data: LayerData, token = "category1"): GeoLayerSpec {
  return {
    id,
    kind: "choropleth",
    data,
    fill: { color: { by: "constant", token } },
  };
}

/**
 * W1 deliberately receives this projection from the renderer. It makes paint
 * and source data independently mutable without introducing a MapLibre type or
 * raw paint expression into the frozen public contract.
 */
function project(layer: GeoLayerSpec): MaplibreLayerProjection {
  if (layer.kind !== "choropleth") {
    throw new Error("fixture projector only needs choropleth layers");
  }

  return {
    layers: [{
      layer: { id: layer.id, type: "fill", source: `source/${layer.id}` },
      structure: { type: "fill", source: sourceIdentity(layer.data) },
      data: layer.data,
      paint: {
        "fill-color": layer.fill.color,
        "fill-opacity": layer.fill.opacity ?? layer.opacity ?? null,
      },
    }],
  };
}

function projectMultiple(layer: GeoLayerSpec): MaplibreLayerProjection {
  if (layer.kind !== "choropleth") {
    throw new Error("fixture projector only needs choropleth layers");
  }

  return {
    layers: [
      {
        layer: { id: layer.id, type: "fill", source: `source/${layer.id}` },
        structure: { type: "fill", source: sourceIdentity(layer.data) },
        data: layer.data,
        paint: { "fill-color": layer.fill.color },
      },
      {
        layer: { id: `${layer.id}::outline`, type: "line", source: `source/${layer.id}` },
        structure: { type: "line", source: sourceIdentity(layer.data) },
        data: layer.data,
        paint: { "line-color": layer.fill.color },
      },
    ],
  };
}

function projectAllPrimitives(layer: GeoLayerSpec): MaplibreLayerProjection {
  return {
    layers: [
      { layer: { id: layer.id, type: "fill" }, structure: { type: "fill" }, paint: {}, data: layer.data },
      {
        layer: { id: `${layer.id}::outline`, type: "line" },
        structure: { type: "line" },
        paint: {},
        data: layer.data,
      },
      {
        layer: { id: `${layer.id}::points`, type: "circle" },
        structure: { type: "circle" },
        paint: {},
        data: layer.data,
      },
      {
        layer: { id: `${layer.id}::label`, type: "symbol" },
        structure: { type: "symbol" },
        paint: {},
        data: layer.data,
      },
    ],
  };
}

function sourceIdentity(data: LayerData): string | undefined {
  return "sourceRef" in data ? data.sourceRef : undefined;
}

function mutations(map: FakeMaplibreMap): MapCall[] {
  return map.calls.filter((call) => call.method !== "getLayer");
}

describe("DeclarativeLayerReconciler", () => {
  it("should diff additions, in-place paint/data updates, and removals by layer id", () => {
    const map = new FakeMaplibreMap();
    const reconciler = new DeclarativeLayerReconciler(map, {
      layerIdPrefix: "layers/",
      project,
    });
    const firstData = featureCollection("first");
    const updatedData = featureCollection("updated");

    reconciler.setLayers([
      choropleth("layers/kept", firstData),
      choropleth("layers/removed", featureCollection("removed")),
    ]);
    map.clearCalls();

    reconciler.setLayers([
      choropleth("layers/kept", updatedData, "category2"),
      choropleth("layers/added", featureCollection("added")),
    ]);

    expect(mutations(map)).toEqual([
      { method: "removeLayer", id: "layers/removed" },
      { method: "setData", id: "layers/kept", value: updatedData },
      {
        method: "setPaintProperty",
        id: "layers/kept",
        property: "fill-color",
        value: { by: "constant", token: "category2" },
      },
      { method: "addLayer", id: "layers/added", value: expect.any(Object) },
    ]);
    expect(map.layers.has("layers/kept")).toBe(true);
    expect(map.layers.has("layers/added")).toBe(true);
    expect(map.layers.has("layers/removed")).toBe(false);
  });

  it("should be a no-op when the same declarative layers are applied again", () => {
    const map = new FakeMaplibreMap();
    const reconciler = new DeclarativeLayerReconciler(map, {
      layerIdPrefix: "layers/",
      project,
    });
    const layers = [choropleth("layers/one", featureCollection("one"))];

    reconciler.setLayers(layers);
    map.clearCalls();
    reconciler.setLayers(layers);

    expect(map.calls).toEqual([]);
  });

  it("should update data and paint for every derived sub-layer", () => {
    const map = new FakeMaplibreMap();
    const reconciler = new DeclarativeLayerReconciler(map, {
      layerIdPrefix: "layers/",
      project: projectMultiple,
    });
    const updatedData = featureCollection("updated");

    reconciler.setLayers([choropleth("layers/owned", featureCollection("first"))]);
    map.clearCalls();
    reconciler.setLayers([choropleth("layers/owned", updatedData, "category2")]);

    expect(mutations(map)).toEqual([
      { method: "setData", id: "layers/owned", value: updatedData },
      {
        method: "setPaintProperty",
        id: "layers/owned",
        property: "fill-color",
        value: { by: "constant", token: "category2" },
      },
      { method: "setData", id: "layers/owned::outline", value: updatedData },
      {
        method: "setPaintProperty",
        id: "layers/owned::outline",
        property: "line-color",
        value: { by: "constant", token: "category2" },
      },
    ]);
  });

  it("should retain ordered derived ids and never cross into a foreign namespace", () => {
    const map = new FakeMaplibreMap();
    const foreignLayerId = "sync/high-frequency";
    map.seed({ id: foreignLayerId, type: "circle" });
    const reconciler = new DeclarativeLayerReconciler(map, {
      layerIdPrefix: "layers/",
      project: projectAllPrimitives,
    });

    reconciler.setLayers([choropleth("layers/owned", featureCollection("owned"))]);

    expect([...map.layers.keys()]).toEqual([
      foreignLayerId,
      "layers/owned",
      "layers/owned::outline",
      "layers/owned::points",
      "layers/owned::label",
    ]);
    map.clearCalls();
    reconciler.setLayers([]);

    expect(map.layers.has(foreignLayerId)).toBe(true);
    expect(map.calls.every((call) => call.id !== foreignLayerId)).toBe(true);
    expect(mutations(map)).toEqual([
      { method: "removeLayer", id: "layers/owned" },
      { method: "removeLayer", id: "layers/owned::outline" },
      { method: "removeLayer", id: "layers/owned::points" },
      { method: "removeLayer", id: "layers/owned::label" },
    ]);
  });

  it("should re-inject all derived ids after setStyle while identical setLayers stays a no-op", () => {
    const map = new FakeMaplibreMap();
    const reconciler = new DeclarativeLayerReconciler(map, {
      layerIdPrefix: "layers/",
      project: projectMultiple,
    });
    const layers = [choropleth("layers/owned", featureCollection("owned"))];

    reconciler.setLayers(layers);
    map.clearCalls();
    reconciler.setLayers(layers);
    expect(map.calls).toEqual([]);

    map.layers.clear();
    reconciler.reinjectAfterStyle();

    expect([...map.layers.keys()]).toEqual(["layers/owned", "layers/owned::outline"]);
    expect(mutations(map)).toEqual([
      { method: "addLayer", id: "layers/owned", value: expect.any(Object) },
      { method: "addLayer", id: "layers/owned::outline", value: expect.any(Object) },
    ]);
  });

  it("should reject empty, escaped, and colliding projected sub-layer ids", () => {
    const layer = choropleth("layers/parent", featureCollection("parent"));
    const empty = new DeclarativeLayerReconciler(new FakeMaplibreMap(), {
      layerIdPrefix: "layers/",
      project: () => ({ layers: [] }),
    });
    const escaped = new DeclarativeLayerReconciler(new FakeMaplibreMap(), {
      layerIdPrefix: "layers/",
      project: (projected) => ({
        layers: [{
          layer: { id: "layers/other", type: "fill" },
          structure: {},
          paint: {},
          data: projected.data,
        }],
      }),
    });
    const colliding = new DeclarativeLayerReconciler(new FakeMaplibreMap(), {
      layerIdPrefix: "layers/",
      project: projectMultiple,
    });

    expect(() => empty.setLayers([layer])).toThrow("at least one sub-layer");
    expect(() => escaped.setLayers([layer])).toThrow("must stay within declarative layer id");
    expect(() =>
      colliding.setLayers([
        choropleth("layers/a", featureCollection("a")),
        choropleth("layers/a::outline", featureCollection("b")),
      ]),
    ).toThrow("Duplicate projected layer id: layers/a::outline");
  });

  it("should never touch a layer outside its namespace prefix", () => {
    const map = new FakeMaplibreMap();
    const foreignLayerId = "sync/high-frequency";
    map.seed({ id: foreignLayerId, type: "circle" });
    const reconciler = new DeclarativeLayerReconciler(map, {
      layerIdPrefix: "layers/",
      project,
    });

    reconciler.setLayers([
      choropleth("layers/owned", featureCollection("owned")),
      choropleth(foreignLayerId, featureCollection("foreign")),
    ]);
    map.clearCalls();
    reconciler.setLayers([]);

    expect(map.layers.has(foreignLayerId)).toBe(true);
    expect(map.calls.every((call) => call.id !== foreignLayerId)).toBe(true);
    expect(mutations(map)).toEqual([{ method: "removeLayer", id: "layers/owned" }]);
  });
});
