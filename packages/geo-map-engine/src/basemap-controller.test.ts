import { describe, expect, it } from "vitest";

import type { BasemapSpec, RasterSource } from "./basemap.js";
import {
  MaplibreBasemapController,
  type BasemapControllerOptions,
  type MaplibreBasemapStyle,
  type MaplibreBasemapTarget,
  type MaplibreStyleReadyEvent,
} from "./basemap-controller.js";
import type { GeoMapError, ResolvedRasterSource } from "./surface.js";
import type { GeoViewport } from "./viewport.js";

/** In-memory MapLibre style seam: no canvas, WebGL, or browser runtime. */
class FakeBasemapMap implements MaplibreBasemapTarget {
  readonly styles: MaplibreBasemapStyle[] = [];
  readonly order: string[] = [];
  readonly attributions: (string | null)[] = [];
  viewport: GeoViewport = { center: [-73.6, 45.5], zoom: 10, bearing: 0, pitch: 0 };
  readonly #listeners = new Map<MaplibreStyleReadyEvent | "moveend", Set<() => void>>([
    ["styledata", new Set()],
    ["load", new Set()],
    ["moveend", new Set()],
  ]);

  setStyle(style: MaplibreBasemapStyle): void {
    this.styles.push(style);
    this.order.push("setStyle");
  }

  on(event: MaplibreStyleReadyEvent | "moveend", listener: () => void): void {
    this.#listeners.get(event)?.add(listener);
  }

  off(event: MaplibreStyleReadyEvent | "moveend", listener: () => void): void {
    this.#listeners.get(event)?.delete(listener);
  }

  getViewport(): GeoViewport {
    return this.viewport;
  }

  setDynamicAttribution(text: string | null): void {
    this.attributions.push(text);
  }

  emit(event: MaplibreStyleReadyEvent | "moveend"): void {
    this.order.push(event);
    for (const listener of this.#listeners.get(event) ?? []) listener();
  }
}

const tokens = { "surface-default": "#f6f7f9" };

function makeController(
  map: FakeBasemapMap,
  reinjectOverlays = (): void => {},
  extra: Partial<BasemapControllerOptions> = {},
): MaplibreBasemapController {
  return new MaplibreBasemapController(map, { tokens, reinjectOverlays, ...extra });
}

/** Flushes the microtask queue so an awaited `attributionResolver` settles. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const dynamicSource: RasterSource = {
  id: "google-2d",
  imageryType: "provider-2d",
  attribution: { mode: "dynamic" },
  policy: "live-embed-only",
};
const resolvedDynamic: ResolvedRasterSource = {
  tileUrlTemplateBase: "https://tile.example.test/v1/2dtiles/{z}/{x}/{y}",
  tileSize: { width: 256, height: 256 },
  imageFormat: "png",
  attributionResolver: () => Promise.resolve("Imagery ©2026 Example, Maxar"),
};

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
    expect(map.attributions).toEqual([]);
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

  describe("raster-source (v2, §2.5)", () => {
    it("fail-closes to onError + the declared blank fallback when no resolveRasterSource is wired", () => {
      const map = new FakeBasemapMap();
      const errors: GeoMapError[] = [];
      const controller = makeController(map, undefined, { onError: (e) => errors.push(e) });

      // Never throws (a runtime provider is a normal-mode refusal, not a crash — §2.4).
      controller.setBasemap({ kind: "raster-source", source: dynamicSource });

      expect(errors).toEqual([{
        source: "basemap",
        sourceId: "google-2d",
        kind: "resolve-failed",
        recoverable: false,
        message: "no resolveRasterSource for a raster-source basemap",
      }]);
      expect(map.styles).toEqual([{ version: 8, sources: {}, layers: [] }]);
      expect(map.attributions).toEqual(["Basemap imagery unavailable"]);
    });

    it("fail-closes when a dynamic source resolves WITHOUT an attributionResolver (B4)", () => {
      const map = new FakeBasemapMap();
      const errors: GeoMapError[] = [];
      const controller = makeController(map, undefined, {
        onError: (e) => errors.push(e),
        resolveRasterSource: () => ({
          tileUrlTemplateBase: "https://tile.example.test/v1/2dtiles/{z}/{x}/{y}",
          tileSize: { width: 256, height: 256 },
          imageFormat: "png",
        }),
      });

      controller.setBasemap({ kind: "raster-source", source: dynamicSource });

      expect(errors[0]?.kind).toBe("resolve-failed");
      expect(errors[0]?.message).toBe("dynamic attribution without an attributionResolver");
      expect(map.styles).toEqual([{ version: 8, sources: {}, layers: [] }]);
    });

    it("compiles a resolved dynamic source (tiles=base, tileSize, empty source attribution)", async () => {
      const map = new FakeBasemapMap();
      const controller = makeController(map, undefined, { resolveRasterSource: () => resolvedDynamic });

      controller.setBasemap({ kind: "raster-source", source: dynamicSource });

      expect(map.styles).toEqual([{
        version: 8,
        sources: {
          "basemap/raster": {
            type: "raster",
            tiles: ["https://tile.example.test/v1/2dtiles/{z}/{x}/{y}"],
            attribution: "",
            tileSize: 256,
          },
        },
        layers: [{ id: "basemap/raster", type: "raster", source: "basemap/raster" }],
      }]);
      // The tile URL template base carries NO session/key (§3.3).
      const tileUrl = map.styles[0]?.sources["basemap/raster"]?.tiles[0] ?? "";
      expect(tileUrl).not.toContain("session=");
      expect(tileUrl).not.toContain("key=");

      await flush();
      // The dynamic per-viewport copyright is rendered DOM-visibly right after style-ready (§3.1).
      expect(map.attributions).toEqual(["Imagery ©2026 Example, Maxar"]);
    });

    it("refreshes the dynamic attribution on moveend with the current viewport", async () => {
      const map = new FakeBasemapMap();
      const seen: GeoViewport[] = [];
      const controller = makeController(map, undefined, {
        resolveRasterSource: () => ({
          ...resolvedDynamic,
          attributionResolver: (v) => {
            seen.push(v);
            return Promise.resolve(`©z${Math.round(v.zoom)}`);
          },
        }),
      });

      controller.setBasemap({ kind: "raster-source", source: dynamicSource });
      await flush();
      expect(map.attributions).toEqual(["©z10"]);

      map.viewport = { center: [-71, 46], zoom: 14, bearing: 0, pitch: 0 };
      map.emit("moveend");
      await flush();

      expect(map.attributions).toEqual(["©z10", "©z14"]);
      expect(seen.map((v) => v.zoom)).toEqual([10, 14]);
    });

    it("renders a STATIC source attribution in the source string (no dynamic control)", () => {
      const map = new FakeBasemapMap();
      const staticSource: RasterSource = { ...dynamicSource, attribution: { mode: "static", text: "©Static" } };
      const controller = makeController(map, undefined, {
        resolveRasterSource: () => ({
          tileUrlTemplateBase: "https://tile.example.test/v1/2dtiles/{z}/{x}/{y}",
          tileSize: { width: 256, height: 256 },
          imageFormat: "png",
        }),
      });

      controller.setBasemap({ kind: "raster-source", source: staticSource });

      expect(map.styles[0]?.sources["basemap/raster"]?.attribution).toBe("©Static");
      expect(map.attributions).toEqual([]);
    });

    it("fail-closes to onError + fallback when the attributionResolver rejects, mapping its kind", async () => {
      const map = new FakeBasemapMap();
      const errors: GeoMapError[] = [];
      const controller = makeController(map, undefined, {
        onError: (e) => errors.push(e),
        resolveRasterSource: () => ({
          ...resolvedDynamic,
          attributionResolver: () => Promise.reject(Object.assign(new Error("429"), { kind: "quota" })),
        }),
      });

      controller.setBasemap({ kind: "raster-source", source: dynamicSource });
      await flush();

      expect(errors[0]?.kind).toBe("quota");
      expect(errors[0]?.recoverable).toBe(true);
      // Last style is the declared blank fallback; last notice is non-silent.
      expect(map.styles.at(-1)).toEqual({ version: 8, sources: {}, layers: [] });
      expect(map.attributions.at(-1)).toBe("Basemap imagery unavailable");
    });

    it("clears the dynamic control + stops refreshing when switching away to a blank basemap", async () => {
      const map = new FakeBasemapMap();
      const controller = makeController(map, undefined, { resolveRasterSource: () => resolvedDynamic });

      controller.setBasemap({ kind: "raster-source", source: dynamicSource });
      await flush();
      expect(map.attributions).toEqual(["Imagery ©2026 Example, Maxar"]);

      controller.setBasemap({ kind: "blank", background: "surface-default" });
      expect(map.attributions.at(-1)).toBeNull(); // dynamic notice cleared

      // A stale moveend after the switch must not resurrect the resolver.
      map.emit("moveend");
      await flush();
      expect(map.attributions.at(-1)).toBeNull();
    });
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
