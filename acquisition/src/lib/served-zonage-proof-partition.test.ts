import { describe, expect, it } from "vitest";

import { classifyProofPartitionCollection, manifestTuple } from "./served-zonage-proof-partition.js";

const url = "https://data.example.test/zonage.geojson";
const sha256 = `sha256:${"a".repeat(64)}`;
const retrievedAt = "2026-07-28T12:00:00.000Z";

function row(proof: unknown) {
  return {
    slug: "alpha",
    proof_values: 1,
    proof_envelope_samples: [{ location: "feature.properties.proof" as const, proof }],
  };
}

describe("served zonage proof partition", () => {
  it("credits a v2 URL only when its complete tuple is attached to a capture manifest", () => {
    const proof = { schema_version: "2.0", geometry_source: { url, sha256, retrieved_at: retrievedAt } };
    expect(classifyProofPartitionCollection(row(proof), new Set([manifestTuple(url, retrievedAt, sha256)])).category)
      .toBe("PREUVE_V2_EXACTE");
    expect(classifyProofPartitionCollection(row(proof), new Set()).category).toBe("URL_SHA_SANS_CAPTURE");
  });

  it("keeps a legacy HTTPS artifact with a valid hash consultable but non-v2", () => {
    const proof = { sources: { geometry: { artifact_uri: url, sha256 } } };
    expect(classifyProofPartitionCollection(row(proof), new Set()).category).toBe("URL_SHA_SANS_CAPTURE");
  });

  it("assigns mixed feature forms to their weakest category", () => {
    const proof = {
      sources: { geometry: { artifact_uri: "s3://sentropic-geo/normalized/zones.geojson", sha256 } },
      geometry_source: { url, sha256: "sha256:not-valid", retrieved_at: retrievedAt },
    };
    const classified = classifyProofPartitionCollection(row(proof), new Set());
    expect(classified.category).toBe("SHA_ABSENT");
    expect(classified.mixed_forms).toBe(true);
  });

  it("does not treat an absent proof envelope as usable evidence", () => {
    expect(classifyProofPartitionCollection({ slug: "alpha", proof_values: 0, proof_envelope_samples: [] }, new Set()).category)
      .toBe("PAS_DE_PREUVE");
  });
});
