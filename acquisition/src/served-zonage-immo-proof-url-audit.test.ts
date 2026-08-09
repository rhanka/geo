import { describe, expect, it } from "vitest";

import { atomicTemporaryPath, selectAuditChoices } from "./served-zonage-immo-proof-url-audit.js";

const choices = [
  { slug: "alpha", key: "normalized/ca-qc-zonage/qc-zonage-alpha.geojson", layout: "flat" as const, alternatives: [] },
  { slug: "beta", key: "normalized/ca-qc-zonage/qc-zonage-beta/qc-zonage-beta.geojson", layout: "nested" as const, alternatives: [] },
];

describe("served zonage immo proof URL audit", () => {
  it("selects every served collection when no refusal selection is supplied", () => {
    expect(selectAuditChoices(choices, {
      restamp_plan_path: null,
      refusal_reason: null,
      slugs: [],
    })).toEqual(choices);
  });

  it("rejects a requested slug absent from the served universe", () => {
    expect(() => selectAuditChoices(choices, {
      restamp_plan_path: "work/coverage/plan.json",
      refusal_reason: "reason",
      slugs: ["alpha", "missing"],
    })).toThrow("selected served collections not found: missing");
  });

  it("uses a unique temporary path for each atomic checkpoint write", () => {
    const path = "/repo/work/audit.state.json";
    expect(new Set([atomicTemporaryPath(path), atomicTemporaryPath(path)]).size).toBe(2);
  });
});
