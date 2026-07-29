import { describe, expect, it } from "vitest";

import {
  firstPvCaptureLotForRange,
  planPvProbableTargets,
  partitionPvCaptureTargetsByMunicipality,
  pvIndexListingSha256,
  selectPvProbableTargetsForUncoveredMunicipalities,
  splitPvCaptureTargets,
  stablePvIndexListing,
} from "./pv-probable-capture-plan.js";

describe("PV probable capture plan", () => {
  it("keeps only observable PVs and captures a duplicate URL once", () => {
    const targets = planPvProbableTargets([
      { slug: "alpha", index_url: "https://alpha.example/pv", entries: [
        { url: "https://docs.example/minutes.pdf", title: "Minutes of council" },
        { url: "https://alpha.example/agenda.pdf", title: "Ordre du jour" },
      ] },
      { slug: "beta", index_url: null, entries: [{ url: "https://docs.example/minutes.pdf", title: "PV" }] },
    ]);
    expect(targets).toEqual([{ slug: "alpha", source: "pv-index", urls: ["https://docs.example/minutes.pdf"] }]);
  });

  it("produces contiguous deterministic lots", () => {
    const targets = ["a", "b", "c"].map((slug) => ({ slug, source: "pv-index" as const, urls: [`https://${slug}.example/pv.pdf`] as const }));
    expect(splitPvCaptureTargets(targets, 2).map((lot) => lot.length)).toEqual([2, 1]);
  });

  it("preserves global lot numbering when resuming an aligned range", () => {
    expect(firstPvCaptureLotForRange(5_150, 50)).toBe(104);
    expect(() => firstPvCaptureLotForRange(5_151, 50)).toThrow("non aligné");
  });

  it("replans from a fresh index when the classification snapshot is stale", () => {
    const classifiedListing = [["registry/qc-pv/alpha/index.json", "etag-old", "2026-07-28T00:00:00.000Z"]] as const;
    const freshListing = [["registry/qc-pv/alpha/index.json", "etag-new", "2026-07-28T01:00:00.000Z"]] as const;

    const snapshot = stablePvIndexListing(pvIndexListingSha256(classifiedListing), freshListing, freshListing);

    expect(snapshot).toMatchObject({
      sha256: pvIndexListingSha256(freshListing),
      listing: freshListing,
      classificationWasStale: true,
    });
  });

  it("rejects a same-key index version changed during planning", () => {
    const firstListing = [["registry/qc-pv/alpha/index.json", "etag-one", "2026-07-28T00:00:00.000Z"]] as const;
    const finalListing = [["registry/qc-pv/alpha/index.json", "etag-two", "2026-07-28T00:01:00.000Z"]] as const;

    expect(() => stablePvIndexListing(pvIndexListingSha256(firstListing), firstListing, finalListing))
      .toThrow("versions divergentes pour registry/qc-pv/alpha/index.json");
  });

  it("opens uncovered municipalities before taking a second document", () => {
    const targets = [
      { slug: "alpha", source: "pv-index" as const, urls: ["https://alpha.example/one.pdf"] as const },
      { slug: "alpha", source: "pv-index" as const, urls: ["https://alpha.example/two.pdf"] as const },
      { slug: "beta", source: "pv-index" as const, urls: ["https://beta.example/one.pdf"] as const },
      { slug: "covered", source: "pv-index" as const, urls: ["https://covered.example/one.pdf"] as const },
    ];

    expect(selectPvProbableTargetsForUncoveredMunicipalities({
      targets,
      municipalitySlugs: new Set(["alpha", "beta", "covered"]),
      coveredMunicipalitySlugs: new Set(["covered"]),
      count: 3,
    }).map((target) => target.urls[0])).toEqual([
      "https://alpha.example/one.pdf",
      "https://beta.example/one.pdf",
      "https://alpha.example/two.pdf",
    ]);
  });

  it("does not guess a reference municipality for an operational index slug", () => {
    const targets = [
      { slug: "canonical", source: "pv-index" as const, urls: ["https://canonical.example/pv.pdf"] as const },
      { slug: "operational-name", source: "pv-index" as const, urls: ["https://operational.example/pv.pdf"] as const },
    ];

    expect(partitionPvCaptureTargetsByMunicipality(targets, new Set(["canonical"]))).toEqual({
      recognized: [targets[0]],
      unrecognized: [targets[1]],
    });
  });
});
