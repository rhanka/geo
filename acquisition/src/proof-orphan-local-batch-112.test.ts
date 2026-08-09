import { describe, expect, it } from "vitest";
import { chainMarkers, classifyFacts, hasArtifactBinding, mergeRows, selectOrphans, type InputCollection, type Row } from "./proof-orphan-local-batch-112.js";

const collection: InputCollection = {
  slug: "example", collection_key: "normalized/ca-qc-zonage/qc-zonage-example.geojson", layout: "flat", features: 3, classification: "orphan",
};

describe("proof-orphan-local-batch-112", () => {
  it("accepts only the reconciliation's exact orphan set", () => {
    const collections = Array.from({ length: 112 }, (_, index) => ({
      slug: `municipality-${String(index).padStart(3, "0")}`,
      collection_key: `normalized/ca-qc-zonage/qc-zonage-${index}.geojson`, layout: "flat", features: 1, classification: "orphan",
    }));
    expect(selectOrphans({ collections })).toHaveLength(112);
    expect(() => selectOrphans({ collections: collections.slice(1) })).toThrow("expected exactly 112 orphan collections");
  });

  it("does not promote a source candidate without its retained artifact chain", () => {
    const candidate = classifyFacts([{
      kind: "current-json", path: "work/run.json", sha256: "sha256:current", source_url: "https://city.example/zones.geojson",
      source_field: "geometry_source.url", json_pointer: "/0", identity: "exact-collection", has_successful_run: false, has_output_chain: false,
    }]);
    expect(candidate.classification).toBe("candidate-needs-human-confirmation");

    const legacy = classifyFacts([{
      kind: "current-json", path: "work/run.json", sha256: "sha256:current", source_url: "https://city.example/zones.geojson",
      source_field: "geometry_source.url", json_pointer: "/0", identity: "exact-collection", has_successful_run: true, has_output_chain: true,
    }]);
    expect(legacy.classification).toBe("legacy-traceable");

    const historical = classifyFacts([{
      kind: "current-json", path: "work/run.json", sha256: "sha256:current", source_url: "https://city.example/zones.geojson",
      source_field: "geometry_source.url", json_pointer: "/0", identity: "exact-collection", has_successful_run: true, has_output_chain: true,
      retained_artifact: { path: "work/example/zones.geojson", sha256: "sha256:artifact", tied_to_source_url: "https://city.example/zones.geojson" },
    }]);
    expect(historical.classification).toBe("historical-verified");

    const mismatchedArtifact = classifyFacts([{
      kind: "current-json", path: "work/run.json", sha256: "sha256:current", source_url: "https://city.example/zones.geojson",
      source_field: "geometry_source.url", json_pointer: "/0", identity: "exact-collection", has_successful_run: true, has_output_chain: true,
      retained_artifact: { path: "work/example/other.geojson", sha256: "sha256:other", tied_to_source_url: "https://city.example/other.geojson" },
    }]);
    expect(mismatchedArtifact.classification).toBe("legacy-traceable");
  });

  it("composes resumed batches only from the immutable input rows", () => {
    const another: InputCollection = { ...collection, slug: "another", collection_key: "normalized/ca-qc-zonage/qc-zonage-another.geojson" };
    const row = (input: InputCollection): Row => ({
      ...input, classification: "orphan", source_identity: null, source_identity_status: null, evidence: [], rationale: "none",
      recovery: { priority: "P3", action: "manual" },
    });
    expect(mergeRows([collection, another], [row(collection)], [row(another)]).map((item) => item.slug)).toEqual(["another", "example"]);
    expect(() => mergeRows([collection], [], [row(another)])).toThrow("outside the immutable orphan input");
  });

  it("requires explicit artifact URL binding and a distinct output-chain field", () => {
    const source = "https://city.example/zones.geojson";
    expect(hasArtifactBinding({ source_artifact_url: "https://city.example/other.geojson" }, source)).toBe(false);
    expect(hasArtifactBinding({ source_artifact_url: source }, source)).toBe(true);
    expect(chainMarkers({ status: "success", collection_key: collection.collection_key }, collection)).toEqual({ successful: true, output: false, markers: ["successful-run"] });
    expect(chainMarkers({ status: "success", output_collection: collection.collection_key }, collection)).toEqual({ successful: true, output: true, markers: ["successful-run", "output-chain"] });
  });

  it("leaves absent evidence orphaned", () => {
    expect(classifyFacts([]).classification).toBe("orphan");
    expect(collection.slug).toBe("example");
  });
});
