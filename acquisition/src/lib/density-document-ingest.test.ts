import { describe, expect, it } from "vitest";

import {
  assertClosedDensityDiscoveryReport,
  exactDensitySigZoneCode,
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
