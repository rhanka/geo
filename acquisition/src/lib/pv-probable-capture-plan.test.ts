import { describe, expect, it } from "vitest";

import { planPvProbableTargets, splitPvCaptureTargets } from "./pv-probable-capture-plan.js";

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
});
