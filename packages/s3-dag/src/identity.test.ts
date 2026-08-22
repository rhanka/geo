import { describe, expect, it } from "vitest";

import { laneIdentity, laneServiceAccountName } from "./identity.js";

const DNS1123 = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

describe("laneServiceAccountName — stable per-lane SA (exact gateway registration)", () => {
  it("derives s3dag-<lane>-sa, DNS-1123 safe, never default", () => {
    const sa = laneServiceAccountName("pv");
    expect(sa).toBe("s3dag-pv-sa");
    expect(sa).toMatch(DNS1123);
    expect(sa).not.toBe("default");
  });

  it("is STABLE across runs (no run segment — the run lives in labels)", () => {
    expect(laneServiceAccountName("zones")).toBe(laneServiceAccountName("zones"));
    expect(laneServiceAccountName("zones")).toBe("s3dag-zones-sa");
  });

  it("preserves hyphenated lane names verbatim (exact match ⇒ no hyphen concern)", () => {
    for (const lane of ["usage-dominant", "effet-densifiant", "cadastre-role", "immo-lots"]) {
      const sa = laneServiceAccountName(lane);
      expect(sa).toBe(`s3dag-${lane}-sa`);
      expect(sa).toMatch(DNS1123);
      expect(sa.length).toBeLessThanOrEqual(63);
    }
  });

  it("collapses a pathological over-long lane to a deterministic hash (still ≤63, valid)", () => {
    const lane = "x".repeat(80);
    const a = laneServiceAccountName(lane);
    expect(a).toBe(laneServiceAccountName(lane)); // deterministic
    expect(a.length).toBeLessThanOrEqual(63);
    expect(a).toMatch(DNS1123);
    expect(a.endsWith("-sa")).toBe(true);
  });

  it("sanitizes garbage input to a valid label", () => {
    expect(laneServiceAccountName("PV Zones!")).toMatch(DNS1123);
  });
});

describe("laneIdentity", () => {
  it("pairs the stable per-lane SA with the node's gateway audiences (verbatim, not lane-scoped)", () => {
    const id = laneIdentity({ lane: "pv", baseAudiences: ["llm-gateway"] });
    expect(id.serviceAccountName).toBe("s3dag-pv-sa");
    expect(id.tokenAudiences).toEqual(["llm-gateway"]);
  });

  it("mounts no projected token for a node with no gateway audiences", () => {
    expect(laneIdentity({ lane: "pv", baseAudiences: [] }).tokenAudiences).toEqual([]);
  });
});
