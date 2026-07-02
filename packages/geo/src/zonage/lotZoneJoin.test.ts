import type { Feature, Polygon } from "geojson";
import { describe, expect, it } from "vitest";

import { assignLotZones, enrichWithNorms, normalizeZoneCode } from "./lotZoneJoin.js";

type Props = Record<string, unknown>;

function rect(id: string, x0: number, y0: number, x1: number, y1: number): Feature<Polygon, Props> {
  return {
    type: "Feature",
    properties: { lot_id: id, zone_code: id },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
          [x0, y0],
        ],
      ],
    },
  };
}

function zone(code: string, x0: number, y0: number, x1: number, y1: number): Feature<Polygon, Props> {
  return {
    ...rect(code, x0, y0, x1, y1),
    properties: { zone_code: code },
  };
}

describe("normalizeZoneCode", () => {
  it("normalizes case, spaces and dash variants", () => {
    expect(normalizeZoneCode("  h --  12  ")).toBe("H-12");
    expect(normalizeZoneCode("a\u201312")).toBe("A-12");
    expect(normalizeZoneCode("mixte   centre")).toBe("MIXTE CENTRE");
  });
});

describe("assignLotZones", () => {
  it("assigns a lot fully covered by one zone with dominant fraction 1.0", () => {
    const [assignment] = assignLotZones(
      [rect("lot-1", 1000, 1000, 1100, 1100)],
      [zone("H-1", 900, 900, 1200, 1200)],
      (z) => String(z.properties?.["zone_code"]),
    );

    expect(assignment).toMatchObject({
      lotId: "lot-1",
      zoneCode: "H-1",
      multiZone: false,
      zoneCodes: ["H-1"],
      method: "area-majority",
    });
    expect(assignment?.dominantFraction).toBeCloseTo(1, 6);
  });

  it("flags a 50/50 straddling lot as multi-zone", () => {
    const [assignment] = assignLotZones(
      [rect("lot-2", 1000, 1000, 1100, 1100)],
      [zone("H-1", 1000, 1000, 1050, 1100), zone("C-2", 1050, 1000, 1100, 1100)],
      (z) => String(z.properties?.["zone_code"]),
    );

    expect(assignment?.zoneCode).toBe("C-2");
    expect(assignment?.dominantFraction).toBeCloseTo(0.5, 6);
    expect(assignment?.multiZone).toBe(true);
    expect(assignment?.zoneCodes.sort()).toEqual(["C-2", "H-1"]);
  });

  it("returns null zone_code when a lot has no overlap", () => {
    const [assignment] = assignLotZones(
      [rect("lot-3", 1000, 1000, 1100, 1100)],
      [zone("H-1", 2000, 2000, 2100, 2100)],
      (z) => String(z.properties?.["zone_code"]),
    );

    expect(assignment).toEqual({
      lotId: "lot-3",
      zoneCode: null,
      dominantFraction: 0,
      multiZone: false,
      zoneCodes: [],
      method: "unassigned",
    });
  });

  it("ignores sliver overlaps below the configured area epsilon", () => {
    const [assignment] = assignLotZones(
      [rect("lot-4", 1000, 1000, 1100, 1100)],
      [zone("H-1", 1099.99, 1000, 1200, 1100)],
      (z) => String(z.properties?.["zone_code"]),
      { sliverAreaEps: 2 },
    );

    expect(assignment?.zoneCode).toBeNull();
    expect(assignment?.method).toBe("unassigned");
  });

  it("rejects degree coordinates unless a metric target CRS is supplied", () => {
    expect(() =>
      assignLotZones(
        [rect("lot-5", -73.001, 45.001, -73, 45.002)],
        [zone("H-1", -73.002, 45, -72.999, 45.003)],
        (z) => String(z.properties?.["zone_code"]),
      ),
    ).toThrow(/metric coordinates/);
  });

  it("reprojects WGS84 coordinates when targetCrs is supplied", () => {
    const [assignment] = assignLotZones(
      [rect("lot-6", -73.001, 45.001, -73, 45.002)],
      [zone("H-1", -73.002, 45, -72.999, 45.003)],
      (z) => String(z.properties?.["zone_code"]),
      { targetCrs: "EPSG:3857" },
    );

    expect(assignment?.zoneCode).toBe("H-1");
    expect(assignment?.dominantFraction).toBeCloseTo(1, 6);
  });

  it("uses normalized zone codes to enrich assignments with norms", () => {
    const enriched = enrichWithNorms(
      [
        {
          lotId: "lot-7",
          zoneCode: "h - 7",
          dominantFraction: 1,
          multiZone: false,
          zoneCodes: ["h - 7"],
          method: "area-majority",
        },
      ],
      new Map([["H-7", { hauteur_max_value: 12 }]]),
    );

    expect(enriched[0]?.norms).toEqual({ hauteur_max_value: 12 });
  });
});
