/**
 * Unit tests for the zoning-producer serving helpers (zones/serve.ts).
 *
 * Pure, network-free. We build small synthetic FeatureCollections with known
 * geometry and assert the serving contract exactly: great-circle distance,
 * polygon bbox/centre, and the "1 feature per distinct zone_code" collapse that
 * unions real lot geometry, sums n_lots, and drops the internal assign_method.
 *
 * Ported alongside `zones/serve.ts` from the acquisition recalage pipeline
 * (`acquisition/src/lib/zone-serve.ts`); this golden is new (the source module
 * had no committed test).
 */
import { describe, it, expect } from "vitest";

import type { FeatureCollection, MultiPolygon } from "@sentropic/geo-core";

import { bboxCenter, haversineKm, mergeByZoneCode } from "./serve.js";

describe("zones/serve — haversineKm", () => {
  it("is zero for identical points", () => {
    expect(haversineKm([-73.5, 45.4], [-73.5, 45.4])).toBe(0);
  });

  it("returns ~111.19 km for a one-degree latitude step", () => {
    // 1° of latitude ≈ R·π/180 = 6371·0.0174533 ≈ 111.19 km.
    expect(haversineKm([-73.5, 45.0], [-73.5, 46.0])).toBeCloseTo(111.19, 1);
  });

  it("is symmetric", () => {
    const a: [number, number] = [-73.6, 45.5];
    const b: [number, number] = [-71.2, 46.8];
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});

describe("zones/serve — bboxCenter", () => {
  it("spans a Polygon and a MultiPolygon into one bbox + centre", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: null,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [2, 0],
                [2, 2],
                [0, 2],
                [0, 0],
              ],
            ],
          },
        },
        {
          type: "Feature",
          properties: null,
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [4, 4],
                  [6, 4],
                  [6, 6],
                  [4, 6],
                  [4, 4],
                ],
              ],
            ],
          },
        },
      ],
    };
    const { center, bbox } = bboxCenter(fc);
    expect(bbox).toEqual([0, 0, 6, 6]);
    expect(center).toEqual([3, 3]);
  });
});

describe("zones/serve — mergeByZoneCode", () => {
  // Two OVERLAPPING R-1 lots (union → a single polygon) + one disjoint C-2 lot.
  const fc: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { zone_code: "R-1", n_lots: 1, assign_method: "nearest", municipality: "test" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ],
          ],
        },
      },
      {
        type: "Feature",
        properties: { zone_code: "R-1", n_lots: 1, assign_method: "nearest", municipality: "test" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0.5],
              [1, 0.5],
              [1, 1.5],
              [0, 1.5],
              [0, 0.5],
            ],
          ],
        },
      },
      {
        type: "Feature",
        properties: { zone_code: "C-2", n_lots: 3, assign_method: "centroid" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [5, 5],
              [6, 5],
              [6, 6],
              [5, 6],
              [5, 5],
            ],
          ],
        },
      },
    ],
  };

  const out = mergeByZoneCode(fc);

  it("emits exactly one feature per distinct zone_code", () => {
    expect(out.features).toHaveLength(2);
    const codes = out.features.map((f) => f.properties?.["zone_code"]).sort();
    expect(codes).toEqual(["C-2", "R-1"]);
  });

  it("sums n_lots, drops assign_method, preserves other props", () => {
    const r1 = out.features.find((f) => f.properties?.["zone_code"] === "R-1")!;
    expect(r1.properties?.["n_lots"]).toBe(2);
    expect(r1.properties).not.toHaveProperty("assign_method");
    expect(r1.properties?.["municipality"]).toBe("test");
  });

  it("unions the two overlapping R-1 lots into a single real polygon", () => {
    const r1 = out.features.find((f) => f.properties?.["zone_code"] === "R-1")!;
    expect(r1.geometry.type).toBe("MultiPolygon");
    // Overlap collapses the two squares into ONE polygon (proof the union ran).
    expect((r1.geometry as MultiPolygon).coordinates).toHaveLength(1);
  });

  it("keeps a disjoint zone_code separate with its own n_lots", () => {
    const c2 = out.features.find((f) => f.properties?.["zone_code"] === "C-2")!;
    expect(c2.properties?.["n_lots"]).toBe(3);
    expect(c2.properties).not.toHaveProperty("assign_method");
  });
});
