import { describe, expect, it } from "vitest";

import { selectProofUrlRecaptureWorklist } from "./served-zonage-immo-proof-url-capture-worklist.js";

describe("selectProofUrlRecaptureWorklist", () => {
  it("selects only untested v1 proofs with simple HTTPS envelope origins", () => {
    const selected = selectProofUrlRecaptureWorklist([
      { slug: "simple", s3_cases: [{ envelope_public_urls: [{ url: "https://ville.example/zones" }] }] },
      { slug: "tested", s3_cases: [{ envelope_public_urls: [{ url: "https://ville.example/tested" }] }] },
      { slug: "fragment", s3_cases: [{ envelope_public_urls: [{ url: "https://ville.example/zones#layer" }] }] },
      { slug: "no-v1", s3_cases: [] },
      {
        slug: "arcgis-query",
        s3_cases: [{ envelope_public_urls: [{ url: "https://ville.example/zones" }] }],
        query_cases: [{ url: "https://services.arcgis.com/x/FeatureServer/0/query?f=geojson" }],
      },
    ], new Set(["tested"]), 0, 100);

    expect(selected).toEqual([{ slug: "simple", source: "zones-v1-proof-url", urls: ["https://ville.example/zones"] }]);
  });

  it("sorts deterministically and supports split production paliers", () => {
    const rows = ["charlie", "alpha", "bravo"].map((slug) => ({
      slug,
      s3_cases: [{ envelope_public_urls: [{ url: `https://ville.example/${slug}` }] }],
    }));
    expect(selectProofUrlRecaptureWorklist(rows, new Set(), 1, 1)).toEqual([
      { slug: "bravo", source: "zones-v1-proof-url", urls: ["https://ville.example/bravo"] },
    ]);
  });
});
