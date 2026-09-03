import { describe, expect, it } from "vitest";

import type { BasemapSpec } from "./basemap.js";
import {
  MaplibreBasemapController,
  type MaplibreBasemapStyle,
  type MaplibreBasemapTarget,
  type MaplibreStyleReadyEvent,
} from "./basemap-controller.js";

/** In-memory MapLibre style seam: no canvas, WebGL, or browser runtime. */
class FakeBasemapMap implements MaplibreBasemapTarget {
  readonly styles: MaplibreBasemapStyle[] = [];
  readonly order: string[] = [];
  readonly #listeners = new Map<MaplibreStyleReadyEvent, Set<() => void>>([
    ["styledata", new Set()],
    ["load", new Set()],
  ]);

  setStyle(style: MaplibreBasemapStyle): void {
    this.styles.push(style);
    this.order.push("setStyle");
  }

  on(event: MaplibreStyleReadyEvent, listener: () => void): void {
    this.#listeners.get(event)?.add(listener);
  }

  off(event: MaplibreStyleReadyEvent, listener: () => void): void {
    this.#listeners.get(event)?.delete(listener);
  }

  emit(event: MaplibreStyleReadyEvent): void {
    this.order.push(event);
    for (const listener of this.#listeners.get(event) ?? []) listener();
  }
}

const tokens = { "surface-default": "#f6f7f9" };

function makeController(map: FakeBasemapMap, reinjectOverlays = (): void => {}): MaplibreBasemapController {
  return new MaplibreBasemapController(map, { tokens, reinjectOverlays });
}

describe("MaplibreBasemapController", () => {
  it("should compile a blank basemap with its resolved background token", () => {
    const map = new FakeBasemapMap();
    const controller = makeController(map);

    controller.setBasemap({ kind: "blank", background: "surface-default" });

    expect(map.styles).toEqual([{
      version: 8,
      sources: {},
      layers: [{
        id: "basemap/background",
        type: "background",
        paint: { "background-color": "#f6f7f9" },
      }],
    }]);
  });

  it("should hard-fail a blank basemap when its token is absent", () => {
    const map = new FakeBasemapMap();
    const controller = new MaplibreBasemapController(map, {
      tokens: {},
      reinjectOverlays: (): void => {},
    });

    expect(() => controller.setBasemap({ kind: "blank", background: "surface-default" }))
      .toThrow("Missing resolved token for role: surface-default");
    expect(map.styles).toEqual([]);
  });

  it("should compile a raster basemap source and layer without an omitted saturation", () => {
    const map = new FakeBasemapMap();
    const controller = makeController(map);

    controller.setBasemap({
      kind: "raster",
      tiles: ["https://tiles.example.test/{z}/{x}/{y}.png"],
      attribution: "© Test tiles",
    });

    expect(map.styles).toEqual([{
      version: 8,
      sources: {
        "basemap/raster": {
          type: "raster",
          tiles: ["https://tiles.example.test/{z}/{x}/{y}.png"],
          attribution: "© Test tiles",
        },
      },
      layers: [{
        id: "basemap/raster",
        type: "raster",
        source: "basemap/raster",
      }],
    }]);
  });

  it("should compile raster saturation only when the spec provides it", () => {
    const map = new FakeBasemapMap();
    const controller = makeController(map);

    controller.setBasemap({
      kind: "raster",
      tiles: ["https://tiles.example.test/{z}/{x}/{y}.png"],
      attribution: "© Test tiles",
      saturation: -1,
    });

    expect(map.styles[0]?.layers).toEqual([{
      id: "basemap/raster",
      type: "raster",
      source: "basemap/raster",
      paint: { "raster-saturation": -1 },
    }]);
  });

  it("should hard-fail a raster basemap without attribution", () => {
    const map = new FakeBasemapMap();
    const controller = makeController(map);
    const withoutAttribution = {
      kind: "raster",
      tiles: ["https://tiles.example.test/{z}/{x}/{y}.png"],
    } as unknown as BasemapSpec;

    expect(() => controller.setBasemap(withoutAttribution))
      .toThrow("A raster basemap requires attribution");
    expect(map.styles).toEqual([]);
  });

  it("should fail closed for the deferred vector basemap", () => {
    const map = new FakeBasemapMap();
    const controller = makeController(map);

    expect(() => controller.setBasemap({
      kind: "vector",
      style: "https://styles.example.test/style.json",
      attribution: "© Test tiles",
    })).toThrow("vector basemap not yet supported — pending contract ratification");
    expect(map.styles).toEqual([]);
  });

  it("should fail closed for the v2.0 raster-source basemap (flag-OFF, adapter is increment-2)", () => {
    const map = new FakeBasemapMap();
    const controller = makeController(map);

    expect(() => controller.setBasemap({
      kind: "raster-source",
      source: {
        id: "sat-2d",
        imageryType: "provider-2d",
        attribution: { mode: "dynamic" },
        policy: "live-embed-only",
      },
    })).toThrow("raster-source basemap not yet supported — provider adapter is wp7 increment-2 (flag-OFF by construction)");
    expect(map.styles).toEqual([]);
  });

  it.each<readonly [string, MaplibreStyleReadyEvent, BasemapSpec]>([
    ["blank", "styledata", { kind: "blank", background: "surface-default" }],
    ["raster", "load", {
      kind: "raster",
      tiles: ["https://tiles.example.test/{z}/{x}/{y}.png"],
      attribution: "© Test tiles",
    }],
  ])("should reinject overlays after %s %s style-ready event", (_kind, event, spec) => {
    const map = new FakeBasemapMap();
    const controller = makeController(map, () => map.order.push("reinject"));

    controller.setBasemap(spec);
    expect(map.order).toEqual(["setStyle"]);

    map.emit(event);
    expect(map.order).toEqual(["setStyle", event, "reinject"]);

    map.emit(event === "styledata" ? "load" : "styledata");
    expect(map.order).toEqual([
      "setStyle",
      event,
      "reinject",
      event === "styledata" ? "load" : "styledata",
    ]);
  });
});
