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
};

/** In-memory MapLibre seam: no canvas, WebGL, or browser runtime. */
class FakeMaplibreMap implements MaplibreLayerTarget {
  readonly layers = new Map<string, MaplibreLayerDefinition>();
  readonly calls: MapCall[] = [];

  seed(layer: MaplibreLayerDefinition): void {
    this.layers.set(layer.id, layer);
  }

  addLayer(layer: MaplibreLayerDefinition): void {
    this.calls.push({ method: "addLayer", id: layer.id, value: layer });
    this.layers.set(layer.id, layer);
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
    layer: { id: layer.id, type: "fill", source: `source/${layer.id}` },
    structure: { type: "fill", source: sourceIdentity(layer.data) },
    data: layer.data,
    paint: {
      "fill-color": layer.fill.color,
      "fill-opacity": layer.fill.opacity ?? layer.opacity ?? null,
    },
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
