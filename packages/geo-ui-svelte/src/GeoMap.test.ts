/**
 * Unit tests for `GeoMap`. jsdom cannot create a WebGL context, so MapLibre is
 * mocked: these tests cover the SSR-guarded mount (component renders without
 * throwing) and the French empty-state DOM. Real WebGL rendering is covered by
 * Playwright (per ADR-0015), not here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/svelte";
import type { FeatureCollection } from "@sentropic/geo-core";

// MapLibre touches WebGL/`window` in its constructor; stub it so the
// `onMount` dynamic import resolves to a no-op map in jsdom. This fake also
// captures layer-scoped event handlers (`on(type, layerId, handler)`) and fires
// the `"load"` handler immediately, so the layer + event wiring under
// `map.on("load", …)` actually runs — that is what lets us assert hover/select.
interface FakeMapLike {
  handlers: Map<string, (event?: unknown) => void>;
  fire(type: string, layerId: string, event?: unknown): void;
}

const removeSpy = vi.fn();
const createdMaps: FakeMapLike[] = [];

vi.mock("maplibre-gl", () => {
  class FakeMap implements FakeMapLike {
    handlers = new Map<string, (event?: unknown) => void>();
    addControl = vi.fn();
    addSource = vi.fn();
    addLayer = vi.fn();
    setFeatureState = vi.fn();
    fitBounds = vi.fn();
    getCanvas = vi.fn(() => ({ style: {} as Record<string, string> }));
    remove = removeSpy;

    constructor() {
      createdMaps.push(this);
    }

    on(
      type: string,
      layerOrHandler: string | ((event?: unknown) => void),
      maybeHandler?: (event?: unknown) => void,
    ): void {
      if (typeof layerOrHandler === "function") {
        // `on(type, handler)` — fire "load" synchronously so wiring runs.
        if (type === "load") layerOrHandler();
        return;
      }
      // `on(type, layerId, handler)` — remember it so a test can dispatch it.
      if (maybeHandler) this.handlers.set(`${type}:${layerOrHandler}`, maybeHandler);
    }

    fire(type: string, layerId: string, event?: unknown): void {
      this.handlers.get(`${type}:${layerId}`)?.(event);
    }
  }
  return {
    default: {
      Map: FakeMap,
      NavigationControl: class {},
      AttributionControl: class {},
    },
  };
});

// The dynamically-imported stylesheet has no behaviour under test.
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

import GeoMap from "./GeoMap.svelte";

const sampleData: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-71.2, 46.8] },
      properties: { name: "Québec", category: "a" },
    },
  ],
};

afterEach(() => {
  cleanup();
  removeSpy.mockClear();
  createdMaps.length = 0;
});

describe("GeoMap", () => {
  it("renders the French empty-state when given no data", () => {
    const { getByText, container } = render(GeoMap, { props: {} });
    expect(getByText("Aucune donnée à afficher")).toBeTruthy();
    // The map container is present but no data layers are wired.
    expect(container.querySelector(".geo-map")).toBeTruthy();
  });

  it("renders the empty-state for an empty FeatureCollection", () => {
    const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
    const { getByText } = render(GeoMap, { props: { data: empty } });
    expect(getByText("Aucune donnée à afficher")).toBeTruthy();
  });

  it("mounts with data under the SSR guard without throwing", () => {
    expect(() =>
      render(GeoMap, {
        props: {
          data: sampleData,
          categories: [{ id: "a", labelFr: "Catégorie A", color: "#2563eb" }],
          categoryKey: "category",
        },
      }),
    ).not.toThrow();
    // No empty-state when data is present.
    expect(document.body.textContent).not.toContain("Aucune donnée à afficher");
  });

  it("mounts a point-aggregation layerKind without throwing", () => {
    const points: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-71.2, 46.8] },
          properties: { weight: 3 },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-73.5, 45.5] },
          properties: { weight: 1 },
        },
      ],
    };
    for (const layerKind of ["hexbin", "cluster", "density"] as const) {
      expect(() =>
        render(GeoMap, {
          props: { data: points, layerKind, pointLayer: { valueKey: "weight" } },
        }),
      ).not.toThrow();
    }
  });

  it("applies the height prop to the wrapper", () => {
    const { container } = render(GeoMap, { props: { height: "640px" } });
    const wrap = container.querySelector(".geo-map-wrap") as HTMLElement;
    expect(wrap.style.height).toBe("640px");
  });
});

describe("GeoMap point-aggregation events", () => {
  const aggPoints: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-71.2, 46.8] },
        properties: { weight: 3 },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-71.21, 46.81] },
        properties: { weight: 1 },
      },
    ],
  };

  // The queryable geometry layer each aggregation kind exposes for picking.
  // (density's heatmap is not queryable, so it ships a transparent `-hit`.)
  const AGG_LAYER = {
    hexbin: "hexbin-fill",
    cluster: "cluster-circle",
    density: "density-hit",
  } as const;

  for (const kind of ["hexbin", "cluster", "density"] as const) {
    it(`forwards hover/select from the ${kind} aggregation layer`, async () => {
      const onHover = vi.fn();
      const onSelect = vi.fn();
      render(GeoMap, {
        props: {
          data: aggPoints,
          layerKind: kind,
          pointLayer: { valueKey: "weight", cellSize: 1, radius: 1 },
          onHover,
          onSelect,
        },
      });

      // Wait for the async MapLibre mount + the synchronous "load" wiring.
      const map = await vi.waitFor(() => {
        const m = createdMaps.at(-1);
        if (!m || m.handlers.size === 0) throw new Error("map not wired yet");
        return m;
      });

      const layerId = AGG_LAYER[kind];
      // The aggregation branch (not just choropleth) must register handlers.
      expect(map.handlers.has(`mousemove:${layerId}`)).toBe(true);
      expect(map.handlers.has(`click:${layerId}`)).toBe(true);
      expect(map.handlers.has(`mouseleave:${layerId}`)).toBe(true);

      const feature = { properties: { id: "agg-1", count: 4 }, geometry: null };

      map.fire("mousemove", layerId, { features: [feature] });
      expect(onHover).toHaveBeenCalledTimes(1);
      expect(onHover.mock.calls[0]![0]).toMatchObject({
        properties: { id: "agg-1", count: 4 },
      });

      map.fire("click", layerId, { features: [feature] });
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect.mock.calls[0]![0]).toMatchObject({
        properties: { id: "agg-1", count: 4 },
      });

      map.fire("mouseleave", layerId, {});
      expect(onHover).toHaveBeenLastCalledWith(null);
    });
  }
});
