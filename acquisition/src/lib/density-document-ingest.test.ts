import { describe, expect, it } from "vitest";

import {
  assertClosedDensityDiscoveryReport,
  exactDensitySigZoneCode,
  hasDensityCandidateValuePath,
} from "./density-document-ingest.js";

describe("assertClosedDensityDiscoveryReport", () => {
  it("accepts a completed short control campaign", () => {
    expect(() => assertClosedDensityDiscoveryReport({
      scopeCount: 3,
      completedCount: 3,
      rows: [{}, {}, {}],
    })).not.toThrow();
  });

  it("refuses a report with a pending or missing row", () => {
    expect(() => assertClosedDensityDiscoveryReport({
      scopeCount: 3,
      completedCount: 2,
      rows: [{}, {}],
    })).toThrow("rapport de découverte incomplet ou incohérent");
  });

  it("refuses an empty campaign", () => {
    expect(() => assertClosedDensityDiscoveryReport({
      scopeCount: 0,
      completedCount: 0,
      rows: [],
    })).toThrow("rapport de découverte incomplet ou incohérent");
  });
});

describe("exactDensitySigZoneCode", () => {
  const servedCodes = new Set(["Ca-707", "F-001", "H-16"]);

  it("accepts only the exact code printed by the document", () => {
    expect(exactDensitySigZoneCode("H-16", servedCodes)).toBe("H-16");
  });

  it("refuses punctuation normalization and component reordering", () => {
    expect(exactDensitySigZoneCode("Ca 707", servedCodes)).toBeNull();
    expect(exactDensitySigZoneCode("001-F", servedCodes)).toBeNull();
  });
});

describe("hasDensityCandidateValuePath", () => {
  it("accepts a generic native value hit", () => {
    expect(hasDensityCandidateValuePath([{}], false)).toBe(true);
  });

  it("allows an explicitly configured strict parser to supply the value proof", () => {
    expect(hasDensityCandidateValuePath([], true)).toBe(true);
  });

  it("remains fail-closed without either value path", () => {
    expect(hasDensityCandidateValuePath([], false)).toBe(false);
    expect(hasDensityCandidateValuePath(null, true)).toBe(false);
  });
});
