import { describe, expect, it } from "vitest";

import { analyzeZoneGridCoherence } from "./zone-grille-coherence-gate.js";

describe("zone-grille-coherence-gate", () => {
  it("decides on strict overlap and keeps the numeric bridge diagnostic-only", () => {
    const row = analyzeZoneGridCoherence({
      zoneCodes: ["CV-RF-106", "CO-939"],
      gridCodes: ["RA-106", "RA-200"],
      threshold: 0.5,
    });

    expect(row.recouvrement_strict).toBe(0);
    expect(row.numeric_bridged).toBe(1);
    expect(row.recouvrement_bridged).toBe(0.5);
    expect(row.flags).toContain("millesime-mismatch");
    expect(row.real_zoning).toBe(false);
  });

  it("ancien-zonage overrides a high strict overlap", () => {
    const row = analyzeZoneGridCoherence({
      zoneCodes: ["H-1"],
      gridCodes: ["H1"],
      provenance: { title: "Ancien zonage municipal" },
      threshold: 0.5,
    });

    expect(row.recouvrement_strict).toBe(1);
    expect(row.flags).toContain("ancien-zonage");
    expect(row.real_zoning).toBe(false);
  });

  it("detects affectation fields independently of overlap", () => {
    const row = analyzeZoneGridCoherence({
      zoneCodes: ["A", "B"],
      gridCodes: ["A", "B"],
      propertyKeys: ["CODE_AFFEC"],
      threshold: 0.5,
    });

    expect(row.flags).toContain("affectation");
    expect(row.real_zoning).toBe(false);
  });

  it("ORDER-MISMATCH: canonically matched but the SERVED strings never match → not real_zoning (champlain)", () => {
    // champlain: served zonage 103-R / 102-ZR, served grille R-103 / ZR-102.
    const row = analyzeZoneGridCoherence({
      zoneCodes: ["103-R", "102-ZR"],
      gridCodes: ["R-103", "ZR-102"],
      zoneCodesRaw: ["103-R", "102-ZR"],
      gridCodesRaw: ["R-103", "ZR-102"],
      servedGrillePresent: true,
      threshold: 0.5,
    });

    expect(row.recouvrement_strict).toBe(1); // canonically identical
    expect(row.recouvrement_raw).toBe(0); // but the served strings never match
    expect(row.order_mismatch).toBe(true);
    expect(row.flags).toContain("order-mismatch");
    expect(row.real_zoning).toBe(false); // the gate no longer MASKS the served/fold gap
  });

  it("ORDER-MISMATCH clears once both served layers carry the SAME LETTER-NUMBER form", () => {
    const row = analyzeZoneGridCoherence({
      zoneCodes: ["103-R", "102-ZR"],
      gridCodes: ["R-103", "ZR-102"],
      zoneCodesRaw: ["R-103", "ZR-102"], // rewritten to the canonical serve form
      gridCodesRaw: ["R-103", "ZR-102"],
      servedGrillePresent: true,
      threshold: 0.5,
    });

    expect(row.recouvrement_strict).toBe(1);
    expect(row.recouvrement_raw).toBe(1); // raw rejoins the canonical overlap
    expect(row.order_mismatch).toBe(false);
    expect(row.real_zoning).toBe(true);
  });

  it("no order-mismatch when the grille is NOT served (serving gap, not a surface mismatch)", () => {
    const row = analyzeZoneGridCoherence({
      zoneCodes: ["103-R"],
      gridCodes: ["R-103"],
      zoneCodesRaw: ["103-R"],
      gridCodesRaw: ["R-103"],
      servedGrillePresent: false, // grille deposited (parquet) but not served as geojson
      threshold: 0.5,
    });

    expect(row.order_mismatch).toBe(false);
    expect(row.flags).not.toContain("order-mismatch");
  });

  it("back-compat: with no raw inputs, raw overlap equals strict and never flags order-mismatch", () => {
    const row = analyzeZoneGridCoherence({
      zoneCodes: ["H-1", "H-2"],
      gridCodes: ["H1", "H2"],
      threshold: 0.5,
    });

    expect(row.recouvrement_raw).toBe(row.recouvrement_strict);
    expect(row.order_mismatch).toBe(false);
    expect(row.real_zoning).toBe(true);
  });
});
