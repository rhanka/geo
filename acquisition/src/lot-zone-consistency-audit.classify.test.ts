import { describe, expect, it } from "vitest";

import { classifyCol2, COHERENCE_TOLERANCE_M, HARD_RESIDUE_M } from "./lot-zone-consistency-audit.js";

// Verrouille les bandes ratifiées SPEC_COL2_COHERENCE_AUDIT.
describe("classifyCol2 — bandes distance (T=10m, résidu>50m)", () => {
  it("strictement contenu → cohérent, résidu faux", () => {
    expect(classifyCol2({ insideAssigned: true, distanceToAssignedM: 0, outsideAllServedZones: false, evaluationUnitGrain: false }))
      .toEqual({ band: "coherent", residueHard: false });
  });

  it("d=8m (≤10m) → cohérent (absorbe le bruit de bord)", () => {
    expect(classifyCol2({ insideAssigned: false, distanceToAssignedM: 8, outsideAllServedZones: false, evaluationUnitGrain: false }))
      .toEqual({ band: "coherent", residueHard: false });
  });

  it("d=10m exactement → cohérent (borne incluse)", () => {
    expect(classifyCol2({ insideAssigned: false, distanceToAssignedM: COHERENCE_TOLERANCE_M, outsideAllServedZones: false, evaluationUnitGrain: false }))
      .toEqual({ band: "coherent", residueHard: false });
  });

  it("d=15m (>10m, ≤50m) → mismatch, PAS résidu dur", () => {
    expect(classifyCol2({ insideAssigned: false, distanceToAssignedM: 15, outsideAllServedZones: false, evaluationUnitGrain: false }))
      .toEqual({ band: "mismatch", residueHard: false });
  });

  it("d=50m exactement → mismatch, PAS encore résidu (>50 strict)", () => {
    expect(classifyCol2({ insideAssigned: false, distanceToAssignedM: HARD_RESIDUE_M, outsideAllServedZones: false, evaluationUnitGrain: false }))
      .toEqual({ band: "mismatch", residueHard: false });
  });

  it("d=60m (>50m) → mismatch ET résidu dur (breakout, jamais soustrait)", () => {
    expect(classifyCol2({ insideAssigned: false, distanceToAssignedM: 60, outsideAllServedZones: true, evaluationUnitGrain: false }))
      .toEqual({ band: "mismatch", residueHard: true });
  });

  it("outside_all sur zone-polygon → VRAI mismatch (pas d'UNKNOWN)", () => {
    expect(classifyCol2({ insideAssigned: false, distanceToAssignedM: 120, outsideAllServedZones: true, evaluationUnitGrain: false }))
      .toEqual({ band: "mismatch", residueHard: true });
  });

  it("outside_all sur evaluation-unit → UNKNOWN (exclu num+dénom)", () => {
    expect(classifyCol2({ insideAssigned: false, distanceToAssignedM: 120, outsideAllServedZones: true, evaluationUnitGrain: true }))
      .toEqual({ band: "unknown_eval_unit", residueHard: false });
  });

  it("evaluation-unit mais DANS une zone voisine (misassigned, pas outside_all) → mismatch, jamais UNKNOWN", () => {
    expect(classifyCol2({ insideAssigned: false, distanceToAssignedM: 30, outsideAllServedZones: false, evaluationUnitGrain: true }))
      .toEqual({ band: "mismatch", residueHard: false });
  });

  it("UNKNOWN prioritaire sur la tolérance : outside_all UEV à d=5m reste UNKNOWN (hors trame, pas de cohérence fabriquée)", () => {
    expect(classifyCol2({ insideAssigned: false, distanceToAssignedM: 5, outsideAllServedZones: true, evaluationUnitGrain: true }))
      .toEqual({ band: "unknown_eval_unit", residueHard: false });
  });
});
