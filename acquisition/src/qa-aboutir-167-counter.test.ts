import { describe, expect, it } from "vitest";

import { classifyBucket, cond1FromRecale, cond2FromBucket, cond3FromLotZone } from "./qa-aboutir-167-counter.js";

describe("aboutir-167 classifyBucket (précédence)", () => {
  it("cond1 non-PASS domine => recalage-manquant", () => {
    expect(classifyBucket("FAIL", "PASS", "PASS", "INDET")).toBe("recalage-manquant");
    expect(classifyBucket("INDET", "PASS", "PASS", "PASS")).toBe("recalage-manquant");
  });
  it("cond2 FAIL après cond1 PASS => preuve-morte", () => {
    expect(classifyBucket("PASS", "FAIL", "PASS", "INDET")).toBe("preuve-morte");
  });
  it("cond2 INDET => indetermine-amont", () => {
    expect(classifyBucket("PASS", "INDET", "PASS", "INDET")).toBe("indetermine-amont");
  });
  it("cond3 FAIL => non-reconcilie ; cond3 INDET => indetermine-amont", () => {
    expect(classifyBucket("PASS", "PASS", "FAIL", "INDET")).toBe("non-reconcilie");
    expect(classifyBucket("PASS", "PASS", "INDET", "INDET")).toBe("indetermine-amont");
  });
  it("cond4 INDET (recette non rejouée) => recette-indetermine, jamais abouti", () => {
    expect(classifyBucket("PASS", "PASS", "PASS", "INDET")).toBe("recette-indetermine");
  });
  it("les 4 PASS => abouti", () => {
    expect(classifyBucket("PASS", "PASS", "PASS", "PASS")).toBe("abouti");
  });
});

describe("mappers de conditions", () => {
  it("cond1 : recale_ok/deja_v2_servi = PASS, sinon FAIL", () => {
    expect(cond1FromRecale("recale_ok")).toBe("PASS");
    expect(cond1FromRecale("deja_v2_servi")).toBe("PASS");
    expect(cond1FromRecale("recale_missing")).toBe("FAIL");
    expect(cond1FromRecale("unresolved")).toBe("FAIL");
  });
  it("cond2 : bucket overlap", () => {
    expect(cond2FromBucket("proof_live_verifiable")).toBe("PASS");
    expect(cond2FromBucket("proof_v1_live")).toBe("PASS");
    expect(cond2FromBucket("proof_v1_dead")).toBe("FAIL");
    expect(cond2FromBucket("no_proof_url_signal")).toBe("INDET");
  });
  it("cond3 : measured & <5% = PASS ; measured & >=5% = FAIL ; sinon INDET", () => {
    expect(cond3FromLotZone({ status: "measured", mismatch_pct: 2.5 })).toBe("PASS");
    expect(cond3FromLotZone({ status: "measured", mismatch_pct: 5 })).toBe("FAIL");
    expect(cond3FromLotZone({ status: "measured", mismatch_pct: 100 })).toBe("FAIL");
    expect(cond3FromLotZone(undefined)).toBe("INDET");
    expect(cond3FromLotZone({ status: "inconclusive" })).toBe("INDET");
  });
});
