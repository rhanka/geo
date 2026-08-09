import { describe, expect, it } from "vitest";
import { aggregateObservations, type CoverageObservation } from "./pv-couverture-municipale";

const municipalities = new Map([
  ["alpha", "Alpha"],
  ["beta", "Beta"],
  ["gamma", "Gamma"],
]);

function observation(overrides: Partial<CoverageObservation> = {}): CoverageObservation {
  return {
    storageKey: "raw/pv-index/cas/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf",
    outcome: "INDEXED",
    slug: "alpha",
    source: "fixture.json",
    sourceKind: "fixture",
    generatedAt: null,
    ...overrides,
  };
}

describe("aggregateObservations", () => {
  it("deduplicates a CAS key and keeps INDEXED over a previous extraction failure", () => {
    const result = aggregateObservations([
      observation({ outcome: "DOCUMENT_READ_OR_TEXT_EXTRACTION_FAILED" }),
      observation({ outcome: "INDEXED" }),
    ], municipalities);

    expect(result.finalByCas.get(observation().storageKey)).toBe("INDEXED");
    expect([...result.coveredSlugs]).toEqual(["alpha"]);
    expect(result.outcomeCounts.get("INDEXED")).toBe(1);
  });

  it("does not count a captured or refused document", () => {
    const result = aggregateObservations([
      observation({ outcome: "OWNER_NOT_CONFIRMED", slug: "beta" }),
      observation({
        storageKey: "raw/pv-index/cas/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.pdf",
        outcome: "NON_INDEXED_OTHER",
        slug: "gamma",
      }),
    ], municipalities);

    expect(result.coveredSlugs.size).toBe(0);
    expect(result.outcomeCounts.get("OWNER_NOT_CONFIRMED")).toBe(1);
    expect(result.outcomeCounts.get("NON_INDEXED_OTHER")).toBe(1);
  });

  it("does not project an INDEXED CAS when INDEXED observations disagree on the slug", () => {
    const result = aggregateObservations([
      observation({ slug: "alpha" }),
      observation({ slug: "beta" }),
    ], municipalities);

    expect(result.coveredSlugs.size).toBe(0);
    expect(result.conflictingCasKeys).toBe(1);
    expect(result.indexedWithConflictingMunicipalities).toEqual([{
      storageKey: observation().storageKey,
      slugs: ["alpha", "beta"],
    }]);
  });
});
