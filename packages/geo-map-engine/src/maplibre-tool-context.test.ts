import { describe, expect, it } from "vitest";

import type { GeoToolContext } from "./index.js";
import type { GeoLayerSpec } from "./layers.js";
import {
  MaplibreToolContext,
  type MaplibreToolInteractionState,
  type MaplibreToolPointerEvent,
  type MaplibreToolPointerEventName,
  type MaplibreToolTarget,
} from "./maplibre-tool-context.js";
import type { MaplibreLayerDefinition } from "./layer-reconciler.js";

type MapCall = {
  readonly method: "addLayer" | "removeLayer" | "setInteractionState";
  readonly id?: string;
  readonly state?: MaplibreToolInteractionState;
};

/** In-memory MapLibre tool seam: no canvas, WebGL, or browser runtime. */
class FakeToolMap implements MaplibreToolTarget {
  readonly layers = new Map<string, MaplibreLayerDefinition>();
  readonly calls: MapCall[] = [];
  readonly #listeners = new Map<MaplibreToolPointerEventName, Set<(event: MaplibreToolPointerEvent) => void>>([
    ["click", new Set()],
    ["mousemove", new Set()],
  ]);
  #interactionState: MaplibreToolInteractionState;

  constructor(interactionState: MaplibreToolInteractionState) {
    this.#interactionState = copyInteractionState(interactionState);
  }

  seed(layer: MaplibreLayerDefinition): void {
    this.layers.set(layer.id, layer);
  }

  addLayer(layer: MaplibreLayerDefinition): void {
    this.calls.push({ method: "addLayer", id: layer.id });
    this.layers.set(layer.id, layer);
  }

  removeLayer(id: string): void {
    this.calls.push({ method: "removeLayer", id });
    this.layers.delete(id);
  }

  getLayer(id: string): MaplibreLayerDefinition | undefined {
    return this.layers.get(id);
  }

  on(event: MaplibreToolPointerEventName, listener: (event: MaplibreToolPointerEvent) => void): void {
    this.#listeners.get(event)?.add(listener);
  }

  off(event: MaplibreToolPointerEventName, listener: (event: MaplibreToolPointerEvent) => void): void {
    this.#listeners.get(event)?.delete(listener);
  }

  getInteractionState(): MaplibreToolInteractionState {
    return copyInteractionState(this.#interactionState);
  }

  setInteractionState(state: MaplibreToolInteractionState): void {
    this.#interactionState = copyInteractionState(state);
    this.calls.push({ method: "setInteractionState", state: copyInteractionState(state) });
  }

  emit(event: MaplibreToolPointerEventName, coordinate: readonly [number, number]): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      listener({ lngLat: { lng: coordinate[0], lat: coordinate[1] } });
    }
  }

  listenerCount(event: MaplibreToolPointerEventName): number {
    return this.#listeners.get(event)?.size ?? 0;
  }
}

function scratchLayer(id: string, sourceRef: string): GeoLayerSpec {
  return {
    id,
    kind: "geojson",
    data: { sourceRef },
    outline: { color: { by: "constant", token: "category1" } },
  };
}

function makeContext(map: FakeToolMap): GeoToolContext {
  return new MaplibreToolContext(map, {
    toolId: "measure",
    projectScratchLayer: (layer) => [{
      id: layer.id,
      type: "line",
      source: "sourceRef" in layer.data ? layer.data.sourceRef : "geojson",
    }],
  });
}

function copyInteractionState(state: MaplibreToolInteractionState): MaplibreToolInteractionState {
  return { hover: state.hover, select: state.select };
}

describe("MaplibreToolContext", () => {
  it("should create, update, and remove only scratch layers in its own tool namespace", () => {
    const map = new FakeToolMap({ hover: true, select: false });
    map.seed({ id: "layers/declared", type: "fill" });
    map.seed({ id: "sync/high-frequency", type: "circle" });
    const context = makeContext(map);

    expect(context.layerIdPrefix).toBe("tools/measure/");
    context.setScratchLayers([scratchLayer("tools/measure/line", "first")]);
    context.setScratchLayers([scratchLayer("tools/measure/line", "updated")]);

    expect(map.layers.get("tools/measure/line")).toEqual({
      id: "tools/measure/line",
      type: "line",
      source: "updated",
    });
    context.setScratchLayers([]);

    expect([...map.layers.keys()]).toEqual([
      "layers/declared",
      "sync/high-frequency",
    ]);
    expect(map.calls.filter((call) => call.method === "removeLayer")).toEqual([
      { method: "removeLayer", id: "tools/measure/line" },
      { method: "removeLayer", id: "tools/measure/line" },
    ]);
    expect(map.calls.every((call) => (
      call.id === undefined || !["layers/declared", "sync/high-frequency"].includes(call.id)
    ))).toBe(true);
  });

  it("should reject a scratch layer outside the active tool namespace", () => {
    const map = new FakeToolMap({ hover: false, select: true });
    const context = makeContext(map);

    expect(() => context.setScratchLayers([scratchLayer("layers/declared", "foreign")]))
      .toThrow("must stay within tool namespace");
    expect(map.layers.size).toBe(0);
  });

  it("should deliver normalized click and move pointer events while active", () => {
    const map = new FakeToolMap({ hover: true, select: true });
    const context = makeContext(map);
    const received: unknown[] = [];
    context.onPointerEvent((event) => received.push(event));

    map.emit("click", [-71.208, 46.813]);
    map.emit("mousemove", [-71.209, 46.814]);

    expect(received).toEqual([
      { type: "click", coordinate: [-71.208, 46.813] },
      { type: "move", coordinate: [-71.209, 46.814] },
    ]);
  });

  it("should suppress then exactly restore base interactions and clean up on destroy", () => {
    const initialState = { hover: true, select: false } as const;
    const map = new FakeToolMap(initialState);
    const context = makeContext(map);
    context.setScratchLayers([scratchLayer("tools/measure/line", "line")]);
    context.onPointerEvent(() => {});

    expect(map.getInteractionState()).toEqual({ hover: false, select: false });
    expect(map.listenerCount("click")).toBe(1);
    expect(map.listenerCount("mousemove")).toBe(1);

    context.destroy();
    context.destroy();

    expect(map.layers.has("tools/measure/line")).toBe(false);
    expect(map.listenerCount("click")).toBe(0);
    expect(map.listenerCount("mousemove")).toBe(0);
    expect(map.getInteractionState()).toEqual(initialState);
    expect(map.calls.filter((call) => call.method === "setInteractionState")).toEqual([
      { method: "setInteractionState", state: { hover: false, select: false } },
      { method: "setInteractionState", state: initialState },
    ]);
  });
});
