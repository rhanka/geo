/**
 * Smoke tests for the point-aggregation layer builders. Each asserts the
 * matching `@sentropic/dataviz-core` builder is consumed (its model is returned)
 * and that a native MapLibre layer spec of the right type is produced from a
 * point `FeatureCollection`. Pure data — no DOM/WebGL.
 */

import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "@sentropic/geo-core";
import {
  buildClusterLayer,
  buildDensityLayer,
  buildHexbinLayer,
  buildPointLayer,
} from "./point-layers.js";

/** A small cloud of point features around two clusters. */
function points(...coords: Array<[number, number]>): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: coords.map(([lng, lat], i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { id: i, weight: 2 },
    })),
  };
}

const cloud = points(
  [-71.2, 46.8],
  [-71.21, 46.81],
  [-71.19, 46.79],
  [-73.5, 45.5],
  [-73.51, 45.51],
);

describe("buildHexbinLayer", () => {
  it("builds hexbins → a fill layer over a polygon source", () => {
    const { spec, model } = buildHexbinLayer(cloud, "hexbin", { cellSize: 0.5 });
    // dataviz-core builder consumed.
    expect(model.cellSize).toBe(0.5);
    expect(model.bins.length).toBeGreaterThan(0);
    // Source carries one Polygon feature per bin.
    expect(spec.source.features.length).toBe(model.bins.length);
    expect(spec.source.features[0]!.geometry!.type).toBe("Polygon");
    // A fill layer is produced, bound to the source.
    const fill = spec.layers[0] as { type: string; source: string };
    expect(fill.type).toBe("fill");
    expect(fill.source).toBe(spec.sourceId);
  });

  it("weights bins by the value key when given", () => {
    const { model } = buildHexbinLayer(cloud, "hexbin", {
      cellSize: 5,
      valueKey: "weight",
    });
    // All 5 points fall in few coarse cells; value sums weight (2 each).
    const total = model.bins.reduce((acc, b) => acc + b.value, 0);
    expect(total).toBe(10);
  });
});

describe("buildClusterLayer", () => {
  it("builds clusters → a circle layer sized by count", () => {
    const { spec, model } = buildClusterLayer(cloud, "cluster", { radius: 0.5 });
    // Two spatial groups → two clusters.
    expect(model.clusters.length).toBe(2);
    expect(spec.source.features[0]!.geometry!.type).toBe("Point");
    const circle = spec.layers[0] as {
      type: string;
      paint: Record<string, unknown>;
    };
    expect(circle.type).toBe("circle");
    expect(circle.paint["circle-radius"]).toBeDefined();
    expect(spec.source.features[0]!.properties!["count"]).toBeGreaterThan(0);
  });
});

describe("buildDensityLayer", () => {
  it("builds density cells → a heatmap layer weighted by density", () => {
    const { spec, model } = buildDensityLayer(cloud, "density", { cellSize: 1 });
    expect(model.cells.length).toBeGreaterThan(0);
    expect(spec.source.features[0]!.geometry!.type).toBe("Point");
    const heat = spec.layers[0] as {
      type: string;
      paint: Record<string, unknown>;
    };
    expect(heat.type).toBe("heatmap");
    expect(heat.paint["heatmap-weight"]).toBeDefined();
  });
});

describe("buildPointLayer dispatch", () => {
  it("routes each kind to its builder and produces the expected layer type", () => {
    expect(
      (buildPointLayer("hexbin", cloud, "h").layers[0] as { type: string }).type,
    ).toBe("fill");
    expect(
      (buildPointLayer("cluster", cloud, "c").layers[0] as { type: string })
        .type,
    ).toBe("circle");
    expect(
      (buildPointLayer("density", cloud, "d").layers[0] as { type: string })
        .type,
    ).toBe("heatmap");
  });
});
