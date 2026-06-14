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
// `onMount` dynamic import resolves to a no-op map in jsdom.
const removeSpy = vi.fn();
vi.mock("maplibre-gl", () => {
  class FakeMap {
    on = vi.fn();
    addControl = vi.fn();
    addSource = vi.fn();
    addLayer = vi.fn();
    setFeatureState = vi.fn();
    fitBounds = vi.fn();
    getCanvas = vi.fn(() => ({ style: {} }));
    remove = removeSpy;
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
