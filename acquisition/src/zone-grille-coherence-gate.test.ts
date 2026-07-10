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
});
