import { describe, expect, it } from "vitest";

import { servedProofEndpoint } from "./served-zonage-proof-refetch-control.js";

const sha256 = `sha256:${"a".repeat(64)}`;

describe("served zonage proof refetch control", () => {
  it("reads the actual v2 endpoint and hash from a public feature", () => {
    const feature = { properties: { proof: { geometry_source: { url: "https://data.example.test/v2.geojson", sha256 } } } };
    expect(servedProofEndpoint(feature, "PREUVE_V2_EXACTE")).toEqual({
      field: "proof.geometry_source.url",
      url: "https://data.example.test/v2.geojson",
      sha256,
    });
  });

  it("does not substitute a v2 field for a legacy artifact endpoint", () => {
    const feature = { properties: { proof: { geometry_source: { url: "https://data.example.test/v2.geojson", sha256 } } } };
    expect(() => servedProofEndpoint(feature, "URL_SHA_SANS_CAPTURE")).toThrow("proof.sources.geometry.artifact_uri");
  });
});
