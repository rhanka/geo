import { describe, expect, it } from "vitest";

import type { GeoLayerSpec } from "./layers.js";
import { geometryBounds, mapRenderedFeatureHit } from "./feature-query.js";

const layers: readonly GeoLayerSpec[] = [{
  id: "layers/zones",
  kind: "choropleth",
  data: { type: "FeatureCollection", features: [] },
  fill: { color: { by: "constant", token: "category1" } },
  interactivity: { hover: true, select: false, idField: "zoneId" },
}];

describe("renderer-neutral feature queries", () => {
  it("should resolve a rendered sub-layer to a neutral feature hit", () => {
    expect(mapRenderedFeatureHit({
      layerId: "layers/zones::outline",
      properties: { zoneId: "zone-7", zoning: "R4", renderedOnly: true },
    }, layers)).toEqual({
      layerId: "layers/zones",
      featureId: "zone-7",
      properties: { zoneId: "zone-7", zoning: "R4", renderedOnly: true },
    });
  });

  it("should require the layer identity and requested interaction", () => {
    expect(mapRenderedFeatureHit({
      layerId: "layers/zones",
      properties: { zoneId: 42 },
    }, layers, "hover")).toMatchObject({ featureId: 42 });
    expect(mapRenderedFeatureHit({
      layerId: "layers/zones",
      properties: { zoneId: 42 },
    }, layers, "select")).toBeNull();
    expect(mapRenderedFeatureHit({
      layerId: "layers/zones",
      properties: { unrelated: true },
    }, layers)).toBeNull();
  });

  it("should calculate CRS84 bounds from nested geometry coordinates", () => {
    expect(geometryBounds({
      type: "GeometryCollection",
      geometries: [
        { type: "Point", coordinates: [-71.2, 46.8, 100] },
        {
          type: "MultiPolygon",
          coordinates: [[[
            [-71.6, 46.4],
            [-71.1, 46.4],
            [-71.1, 47.1],
            [-71.6, 47.1],
            [-71.6, 46.4],
          ]]],
        },
      ],
    })).toEqual({ west: -71.6, south: 46.4, east: -71.1, north: 47.1 });
  });

  it("should return null when no valid position is available", () => {
    expect(geometryBounds(null)).toBeNull();
    expect(geometryBounds({ type: "Point", coordinates: ["west", "south"] })).toBeNull();
  });
});
