import type { Feature, MultiPolygon, Polygon } from "geojson";
import { describe, expect, it } from "vitest";

import {
  __test,
  assignLotZones,
  canonicalizeZoneCodeForJoin,
  enrichWithNorms,
  normalizeZoneCode,
  zoneNumberOf,
} from "./lotZoneJoin.js";

type Assignment = Parameters<typeof enrichWithNorms>[0][number];

/** Minimal area-majority assignment carrying just a zone code (for enrich tests). */
function lotAssignment(lotId: string, zoneCode: string | null): Assignment {
  return {
    lotId,
    zoneCode,
    dominantFraction: 1,
    multiZone: false,
    zoneCodes: zoneCode === null ? [] : [zoneCode],
    method: zoneCode === null ? "unassigned" : "area-majority",
  };
}

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

describe("canonicalizeZoneCodeForJoin", () => {
  it("folds leading-zero / dash / space format variants of one code onto H-1", () => {
    const canonical = canonicalizeZoneCodeForJoin("H-1");
    expect(canonical).toBe("H-1");
    for (const variant of ["H01", "H-01", "H 1", "H1", "h01", "  H-01 ", "H\u201301"]) {
      expect(canonicalizeZoneCodeForJoin(variant)).toBe(canonical);
    }
  });

  it("folds C408 and C-408 onto the same key", () => {
    expect(canonicalizeZoneCodeForJoin("C408")).toBe("C-408");
    expect(canonicalizeZoneCodeForJoin("C-408")).toBe("C-408");
    expect(canonicalizeZoneCodeForJoin("C408")).toBe(canonicalizeZoneCodeForJoin("C-408"));
  });

  it("never merges distinct codes (H-1 != H-10, only leading zeros drop)", () => {
    expect(canonicalizeZoneCodeForJoin("H-10")).toBe("H-10");
    expect(canonicalizeZoneCodeForJoin("H-1")).not.toBe(canonicalizeZoneCodeForJoin("H-10"));
    expect(canonicalizeZoneCodeForJoin("H-01")).toBe(canonicalizeZoneCodeForJoin("H-1"));
    expect(canonicalizeZoneCodeForJoin("C-40")).not.toBe(canonicalizeZoneCodeForJoin("C-408"));
  });

  it("leaves multiword / prefix-only codes untouched", () => {
    expect(canonicalizeZoneCodeForJoin("mixte centre")).toBe("MIXTECENTRE");
    expect(canonicalizeZoneCodeForJoin("100")).toBe("100");
  });

  it("LOCKSTEP fix #2: folds a trailing arrondissement annotation onto the bare code (Longueuil)", () => {
    // The SIG stores "A12-024 (STH)"; the grille emits "A12-024". Same physical zone.
    expect(canonicalizeZoneCodeForJoin("A12-024 (STH)")).toBe(canonicalizeZoneCodeForJoin("A12-024"));
    expect(canonicalizeZoneCodeForJoin("H34-327 (VLO)")).toBe(canonicalizeZoneCodeForJoin("H34-327"));
    expect(canonicalizeZoneCodeForJoin("C31-003 (GP)")).toBe(canonicalizeZoneCodeForJoin("C31-003"));
    expect(canonicalizeZoneCodeForJoin("C31-003 (GPK)")).toBe(canonicalizeZoneCodeForJoin("C31-003"));
  });

  it("does not strip an unproven parenthetical that may distinguish zones", () => {
    expect(canonicalizeZoneCodeForJoin("H-1 (A)")).not.toBe(canonicalizeZoneCodeForJoin("H-1 (B)"));
    expect(canonicalizeZoneCodeForJoin("H-1 (RESIDENTIEL)")).not.toBe(
      canonicalizeZoneCodeForJoin("H-1 (COMMERCIAL)"),
    );
  });

  it("ANTI-FUSION: the annotation strip never touches the core, dash secteurs stay distinct", () => {
    // Different core under the same annotation → distinct.
    expect(canonicalizeZoneCodeForJoin("A12-024 (STH)")).not.toBe(
      canonicalizeZoneCodeForJoin("A12-025 (STH)"),
    );
    // A DASH secteur suffix is NOT a parenthetical annotation (mont-royal).
    expect(canonicalizeZoneCodeForJoin("H-531-F")).not.toBe(canonicalizeZoneCodeForJoin("H-531-G"));
    expect(canonicalizeZoneCodeForJoin("H-531-F")).not.toBe(canonicalizeZoneCodeForJoin("H-531"));
  });

  describe("digit-first reorder (Matapédia/Mitis '20 Ha' ⇄ 'Ha-20' famille)", () => {
    it("folds every order/format of one letter+digit code onto the SAME key", () => {
      const canonical = "HA-20";
      for (const v of ["HA-20", "HA20", "20HA", "20-HA", "20 Ha", "ha-020", "020-HA"]) {
        expect(canonicalizeZoneCodeForJoin(v)).toBe(canonical);
      }
      // digit-first and letter-first spellings of the same zone now meet exactly.
      expect(canonicalizeZoneCodeForJoin("20 Ha")).toBe(canonicalizeZoneCodeForJoin("Ha-20"));
      expect(canonicalizeZoneCodeForJoin("22A")).toBe("A-22");
    });

    it("ANTI-FUSION: digit-first reorder never merges distinct numbers or letters", () => {
      expect(canonicalizeZoneCodeForJoin("20HA")).not.toBe(canonicalizeZoneCodeForJoin("21HA"));
      expect(canonicalizeZoneCodeForJoin("20HA")).not.toBe(canonicalizeZoneCodeForJoin("20HB"));
      // A digit-first MULTI-segment code is anchored-out → never reordered/fused.
      expect(canonicalizeZoneCodeForJoin("20-A-1")).toBe("20-A-1");
      expect(new Set(["20HA", "21HA", "20HB", "20-A-1"].map(canonicalizeZoneCodeForJoin)).size).toBe(4);
    });
  });
});

describe("zoneNumberOf", () => {
  it("extracts the one zone number across vintage spellings", () => {
    expect(zoneNumberOf("CV-RF-106")).toBe("106");
    expect(zoneNumberOf("RA-106")).toBe("106");
    expect(zoneNumberOf("106")).toBe("106");
    expect(zoneNumberOf("H-01")).toBe("1");
  });

  it("is null for ambiguous (no number / ≥2 numbers) codes", () => {
    expect(zoneNumberOf("URB")).toBeNull();
    expect(zoneNumberOf("A12-024")).toBeNull();
  });
});

describe("enrichWithNorms — numeric-vintage bridge", () => {
  it("fails closed on conflicting norms that collapse to one canonical code regardless of order", () => {
    const assignment = [lotAssignment("lot-collision", "H-1")];
    const entries: Array<[string, Record<string, unknown>]> = [
      ["H01", { hauteur_max_value: 10 }],
      ["H-1", { hauteur_max_value: 99 }],
      ["RA-1", { hauteur_max_value: 77 }],
    ];

    expect(enrichWithNorms(assignment, new Map(entries))[0]?.norms).toBeNull();
    expect(enrichWithNorms(assignment, new Map(entries.toReversed()))[0]?.norms).toBeNull();
    expect(enrichWithNorms([lotAssignment("lot-vintage", "X-1")], new Map(entries))[0]?.norms).toBeNull();
  });

  it("BRIDGE: a lot in SIG zone CV-RF-106 gets the grille RA-106 norms (same n° 106)", () => {
    const enriched = enrichWithNorms(
      [lotAssignment("lot-mt", "CV-RF-106")],
      new Map([["RA-106", { hauteur_max_value: 11 }]]),
    );
    expect(enriched[0]?.norms).toEqual({ hauteur_max_value: 11 });
  });

  it("BRIDGE: a bare-number SIG lot meets a letter-prefixed grille", () => {
    const enriched = enrichWithNorms(
      [lotAssignment("lot-r", "12")],
      new Map([["RB-12", { densite_value: 25 }]]),
    );
    expect(enriched[0]?.norms).toEqual({ densite_value: 25 });
  });

  it("exact match always wins over the numeric bridge", () => {
    const enriched = enrichWithNorms(
      [lotAssignment("lot-x", "H-106")],
      new Map([
        ["H-106", { hauteur_max_value: 1 }],
        ["RA-106", { hauteur_max_value: 999 }],
      ]),
    );
    expect(enriched[0]?.norms).toEqual({ hauteur_max_value: 1 });
  });

  it("ANTI-FUSION: different numbers never bridge (lot H-1 ≠ grille X-10)", () => {
    const enriched = enrichWithNorms(
      [lotAssignment("lot-1", "H-1")],
      new Map([["X-10", { hauteur_max_value: 5 }]]),
    );
    expect(enriched[0]?.norms).toBeNull();
  });

  it("ANTI-FUSION: a number non-unique among LOTS is not bridged (two SIG zones share 106)", () => {
    // Two distinct lot zones both numbered 106 → 106 does not identify one SIG zone.
    const enriched = enrichWithNorms(
      [lotAssignment("lot-a", "CV-106"), lotAssignment("lot-b", "CA-106")],
      new Map([["RA-106", { hauteur_max_value: 7 }]]),
    );
    expect(enriched[0]?.norms).toBeNull();
    expect(enriched[1]?.norms).toBeNull();
  });

  it("ANTI-FUSION: a number non-unique among NORMS is not bridged", () => {
    const enriched = enrichWithNorms(
      [lotAssignment("lot-c", "X-106")],
      new Map([
        ["RA-106", { hauteur_max_value: 7 }],
        ["RB-106", { hauteur_max_value: 8 }],
      ]),
    );
    expect(enriched[0]?.norms).toBeNull();
  });

  it("ANTI-FUSION: a multi-number code (A12-024) is ineligible for the numeric bridge", () => {
    const enriched = enrichWithNorms(
      [lotAssignment("lot-d", "A12-024")],
      new Map([["B12-024", { hauteur_max_value: 9 }]]),
    );
    expect(enriched[0]?.norms).toBeNull();
  });

  it("DIGIT-FIRST EXACT match attaches norms even when the zone number is NON-unique", () => {
    // Matapédia SIG lots "20 Ha"/"20 Hb" both carry number 20 → the uniqueness-gated
    // numeric bridge would REFUSE (ambiguous number). The digit-first canon instead
    // makes each an EXACT key match to its grille spelling "Ha-20"/"Hb-20", so both
    // lots are correctly enriched — the gate/join gap the reorder closes.
    const enriched = enrichWithNorms(
      [lotAssignment("lot-20a", "20 Ha"), lotAssignment("lot-20b", "20 Hb")],
      new Map([
        ["Ha-20", { hauteur_max_value: 7 }],
        ["Hb-20", { hauteur_max_value: 9 }],
      ]),
    );
    expect(enriched[0]?.norms).toEqual({ hauteur_max_value: 7 });
    expect(enriched[1]?.norms).toEqual({ hauteur_max_value: 9 });
  });
});

describe("assignLotZones", () => {
  it("accepts standard GeoJSON features with null properties", () => {
    const lot: Feature<Polygon> = { ...rect("unused", 0, 0, 10, 10), properties: null };
    const zonedArea: Feature<Polygon> = { ...zone("unused", -5, -5, 15, 15), properties: null };

    const [assignment] = assignLotZones([lot], [zonedArea], () => "H-1", { sourceCrs: "EPSG:3857" });

    expect(assignment).toMatchObject({ lotId: "0", zoneCode: "H-1", dominantFraction: 1 });
  });

  it("finds an interior representative point for centroid fallback", () => {
    expect(__test.representativePoint(rect("lot-scanline", 1000, 1000, 1100, 1100).geometry)).toEqual([
      1050,
      1050,
    ]);
  });

  it("refuses to assign a zero-area invalid geometry", () => {
    const bowTie: Feature<Polygon, Props> = {
      type: "Feature",
      properties: { lot_id: "lot-bow-tie" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [1000, 1000],
            [1100, 1100],
            [1000, 1100],
            [1100, 1000],
            [1000, 1000],
          ],
        ],
      },
    };

    const [assignment] = assignLotZones(
      [bowTie],
      [zone("H-1", 900, 900, 1200, 1200)],
      (z) => String(z.properties?.["zone_code"]),
    );

    expect(assignment).toMatchObject({ zoneCode: null, method: "unassigned" });
  });

  it("refuses to assign a polygon whose exterior ring is not closed", () => {
    const unclosed = rect("lot-unclosed", 1000, 1000, 1100, 1100);
    unclosed.geometry.coordinates[0]!.pop();

    const [assignment] = assignLotZones(
      [unclosed],
      [zone("H-1", 900, 900, 1200, 1200)],
      (z) => String(z.properties?.["zone_code"]),
    );

    expect(assignment).toMatchObject({ zoneCode: null, method: "unassigned" });
  });

  it("isolates an invalid lot without unassigning valid lots in the same batch", () => {
    const invalidLot = rect("lot-invalid", 2000, 2000, 2100, 2100);
    invalidLot.geometry.coordinates[0]!.pop();

    const assignments = assignLotZones(
      [rect("lot-valid", 1000, 1000, 1100, 1100), invalidLot],
      [zone("H-1", 900, 900, 1200, 1200)],
      (z) => String(z.properties?.["zone_code"]),
    );

    expect(assignments[0]).toMatchObject({ lotId: "lot-valid", zoneCode: "H-1", method: "area-majority" });
    expect(assignments[1]).toMatchObject({ lotId: "lot-invalid", zoneCode: null, method: "unassigned" });
  });

  it("isolates a non-finite lot when the valid batch members need reprojection", () => {
    const invalidLot = rect("lot-non-finite", -73.2, 45.4, -73.19, 45.41);
    invalidLot.geometry.coordinates[0]![1]![0] = Number.NaN;

    const assignments = assignLotZones(
      [rect("lot-valid-projected", -73.1, 45.5, -73.09, 45.51), invalidLot],
      [zone("H-1", -73.2, 45.4, -73, 45.6)],
      (z) => String(z.properties?.["zone_code"]),
      { sourceCrs: "EPSG:4326", targetCrs: "EPSG:3857" },
    );

    expect(assignments[0]).toMatchObject({ lotId: "lot-valid-projected", zoneCode: "H-1" });
    expect(assignments[1]).toMatchObject({ lotId: "lot-non-finite", zoneCode: null, method: "unassigned" });
  });

  it("refuses an invalid zone before it can re-enter through centroid fallback", () => {
    const invalidZone = zone("H-1", 900, 900, 1200, 1200);
    invalidZone.geometry.coordinates[0]!.pop();

    const [assignment] = assignLotZones(
      [rect("lot-invalid-zone", 1000, 1000, 1100, 1100)],
      [invalidZone],
      (z) => String(z.properties?.["zone_code"]),
    );

    expect(assignment).toMatchObject({ zoneCode: null, method: "unassigned" });
  });

  it("refuses a zone containing a non-finite position", () => {
    const invalidZone = zone("H-1", 900, 900, 1200, 1200);
    invalidZone.geometry.coordinates[0]![1]![0] = Number.NaN;

    const [assignment] = assignLotZones(
      [rect("lot-nan-zone", 1000, 1000, 1100, 1100)],
      [invalidZone],
      (z) => String(z.properties?.["zone_code"]),
    );

    expect(assignment).toMatchObject({ zoneCode: null, method: "unassigned" });
  });

  it("refuses a closed but self-intersecting polygon with non-zero algebraic area", () => {
    const selfIntersecting = rect("lot-self-intersecting", 1000, 1000, 1100, 1100);
    selfIntersecting.geometry.coordinates = [[
      [1000, 1000],
      [1100, 1100],
      [1000, 1100],
      [1080, 1000],
      [1000, 1000],
    ]];

    const [assignment] = assignLotZones(
      [selfIntersecting],
      [zone("H-1", 900, 900, 1200, 1200)],
      (z) => String(z.properties?.["zone_code"]),
    );

    expect(assignment).toMatchObject({ zoneCode: null, method: "unassigned" });
  });

  it("refuses a non-adjacent vertex lying inside another ring segment", () => {
    const selfTouching = rect("lot-self-touching", 0, 0, 4, 3);
    selfTouching.geometry.coordinates = [[
      [2, 2],
      [0, 3],
      [0, 1],
      [0, 2],
      [3, 0],
      [4, 0],
      [2, 1],
      [2, 2],
    ]];

    const [assignment] = assignLotZones(
      [selfTouching],
      [zone("H-1", -1, -1, 5, 4)],
      (feature) => String(feature.properties?.["zone_code"]),
      { sourceCrs: "EPSG:3857" },
    );

    expect(assignment).toMatchObject({ zoneCode: null, method: "unassigned" });
  });

  it("refuses a polygon whose hole crosses its exterior ring", () => {
    const invalidZone: Feature<Polygon, Props> = {
      type: "Feature",
      properties: { zone_code: "H-1" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
          [[8, 2], [12, 2], [12, 8], [8, 8], [8, 2]],
        ],
      },
    };

    const [assignment] = assignLotZones(
      [rect("lot-hole-crossing", 1, 1, 4, 9)],
      [invalidZone],
      (z) => String(z.properties?.["zone_code"]),
      { sourceCrs: "EPSG:3857" },
    );

    expect(assignment).toMatchObject({ zoneCode: null, method: "unassigned" });
  });

  it("refuses a polygon whose holes overlap", () => {
    const invalidZone: Feature<Polygon, Props> = {
      type: "Feature",
      properties: { zone_code: "H-1" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]],
          [[2, 2], [10, 2], [10, 10], [2, 10], [2, 2]],
          [[8, 8], [16, 8], [16, 16], [8, 16], [8, 8]],
        ],
      },
    };

    const [assignment] = assignLotZones(
      [rect("lot-overlapping-holes", 1, 1, 19, 19)],
      [invalidZone],
      (z) => String(z.properties?.["zone_code"]),
      { sourceCrs: "EPSG:3857" },
    );

    expect(assignment).toMatchObject({ zoneCode: null, method: "unassigned" });
  });

  it("refuses overlapping members of a MultiPolygon", () => {
    const invalidZone: Feature<MultiPolygon, Props> = {
      type: "Feature",
      properties: { zone_code: "H-1" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
          [[[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]]],
        ],
      },
    };

    const [assignment] = assignLotZones(
      [rect("lot-overlapping-members", 1, 1, 14, 14)],
      [invalidZone],
      (z) => String(z.properties?.["zone_code"]),
      { sourceCrs: "EPSG:3857" },
    );

    expect(assignment).toMatchObject({ zoneCode: null, method: "unassigned" });
  });

  it("accepts MultiPolygon members whose boundaries touch at one point", () => {
    const pointTouchingZone: Feature<MultiPolygon, Props> = {
      type: "Feature",
      properties: { zone_code: "H-1" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
          [[[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]],
        ],
      },
    };

    const [assignment] = assignLotZones(
      [rect("lot-point-touch", 1, 1, 9, 9)],
      [pointTouchingZone],
      (z) => String(z.properties?.["zone_code"]),
      { sourceCrs: "EPSG:3857" },
    );

    expect(assignment).toMatchObject({ zoneCode: "H-1", method: "area-majority" });
  });

  it("revalidates geometry after reprojection", () => {
    const invalidAfterProjection: Feature<Polygon, Props> = {
      type: "Feature",
      properties: { zone_code: "H-1" },
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [10, 0], [10, 100], [0, 10], [0, 0]]],
      },
    };

    const [assignment] = assignLotZones(
      [rect("lot-projection-domain", 1, 1, 2, 2)],
      [invalidAfterProjection],
      (z) => String(z.properties?.["zone_code"]),
      { sourceCrs: "EPSG:4326", targetCrs: "EPSG:3857" },
    );

    expect(assignment).toMatchObject({ zoneCode: null, method: "unassigned" });
  });

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

  it("computes the real overlap when a concave zone contains every lot vertex", () => {
    const concaveZone: Feature<Polygon, Props> = {
      type: "Feature",
      properties: { zone_code: "U-1" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [1000, 1000],
            [1060, 1000],
            [1060, 1060],
            [1050, 1060],
            [1050, 1010],
            [1010, 1010],
            [1010, 1060],
            [1000, 1060],
            [1000, 1000],
          ],
        ],
      },
    };

    const [assignment] = assignLotZones(
      [rect("lot-concave", 1000, 1000, 1060, 1060)],
      [concaveZone],
      (z) => String(z.properties?.["zone_code"]),
    );

    expect(assignment?.dominantFraction).toBeCloseTo(1600 / 3600, 6);
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

  it("fails closed when one candidate intersection is invalid after exact overlaps", () => {
    const invalidZone: Feature<Polygon, Props> = {
      type: "Feature",
      properties: { zone_code: "INVALID" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [1000, 1000],
            [null as unknown as number, 1100],
            [1100, 1100],
            [1000, 1000],
          ],
        ],
      },
    };
    const [assignment] = assignLotZones(
      [rect("lot-partial-failure", 1000, 1000, 1100, 1100)],
      [
        zone("A", 1000, 1000, 1060, 1100),
        zone("B", 1060, 1000, 1100, 1100),
        invalidZone,
      ],
      (z) => String(z.properties?.["zone_code"]),
    );

    expect(assignment).toEqual({
      lotId: "lot-partial-failure",
      zoneCode: null,
      dominantFraction: 0,
      multiZone: false,
      zoneCodes: [],
      method: "unassigned",
    });
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

  it("trusts an explicit metric source CRS even when local coordinates are near the origin", () => {
    const [assignment] = assignLotZones(
      [rect("lot-local", 0, 0, 10, 10)],
      [zone("H-1", -5, -5, 15, 15)],
      (z) => String(z.properties?.["zone_code"]),
      { sourceCrs: "EPSG:3857" },
    );

    expect(assignment).toMatchObject({ zoneCode: "H-1", dominantFraction: 1 });
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

  it("rejects every geographic target CRS before computing planar areas", () => {
    const lots = [rect("lot-geographic", -73.001, 45.001, -73, 45.002)];
    const zones = [zone("H-1", -73.002, 45, -72.999, 45.003)];

    for (const targetCrs of ["EPSG:4269", "+proj=longlat +ellps=GRS80 +no_defs"]) {
      expect(() =>
        assignLotZones(lots, zones, (z) => String(z.properties?.["zone_code"]), { targetCrs }),
      ).toThrow(/targetCrs must be metric/);
    }
  });

  it("accepts a projected source CRS definition that contains towgs84", () => {
    const [assignment] = assignLotZones(
      [rect("lot-utm", 609000, 5039000, 609100, 5039100)],
      [zone("H-1", 608900, 5038900, 609200, 5039200)],
      (z) => String(z.properties?.["zone_code"]),
      { sourceCrs: "+proj=utm +zone=18 +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs" },
    );

    expect(assignment).toMatchObject({ zoneCode: "H-1", dominantFraction: 1 });
  });

  it("validates a detailed simple zone without quadratic segment scans", () => {
    const vertexCount = 30_000;
    const ring: Polygon["coordinates"][number] = Array.from({ length: vertexCount }, (_, index) => {
      const angle = (2 * Math.PI * index) / vertexCount;
      return [1_000 * Math.cos(angle), 1_000 * Math.sin(angle)];
    });
    ring.push(ring[0]!);
    const detailedZone: Feature<Polygon, Props> = {
      type: "Feature",
      properties: { zone_code: "H-1" },
      geometry: { type: "Polygon", coordinates: [ring] },
    };

    expect(
      assignLotZones([], [detailedZone], (feature) => String(feature.properties?.["zone_code"])),
    ).toEqual([]);
  });

  it("uses deterministic code-point order to break equal-area ties", () => {
    const [assignment] = assignLotZones(
      [rect("lot-tie", 0, 0, 20, 10)],
      [zone("Z", 0, 0, 10, 10), zone("é", 10, 0, 20, 10)],
      (z) => String(z.properties?.["zone_code"]),
      { sourceCrs: "EPSG:3857" },
    );

    expect(assignment).toMatchObject({ zoneCode: "Z", zoneCodes: ["Z", "é"], multiZone: true });
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

  it("joins a zones-layer H-1 to a grille keyed H01 (leading-zero mismatch fix)", () => {
    const enriched = enrichWithNorms(
      [
        {
          lotId: "lot-8",
          zoneCode: "H-1",
          dominantFraction: 1,
          multiZone: false,
          zoneCodes: ["H-1"],
          method: "area-majority",
        },
      ],
      new Map([["H01", { hauteur_max_value: 20 }]]),
    );

    expect(enriched[0]?.norms).toEqual({ hauteur_max_value: 20 });
  });
});
