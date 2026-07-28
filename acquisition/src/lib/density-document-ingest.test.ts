import { describe, expect, it } from "vitest";

import { assertClosedDensityDiscoveryReport } from "./density-document-ingest.js";

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
