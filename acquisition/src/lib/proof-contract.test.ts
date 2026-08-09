import { describe, expect, it } from "vitest";
import { lotProof, zoneProof } from "./proof-contract.js";

describe("served feature proof contract", () => {
  it("keeps an unavailable assignment explicit instead of inventing one", () => {
    const proof = lotProof({ geometryArtifact: "s3://sentropic-geo/normalized/qc-lots/q.geojson", zoneCollection: null, zoneCode: null, zoneFeatureRef: null, assignmentMethod: null, regulationArtifact: null, regulationUpstream: null });
    expect(proof.status).toBe("partial");
    expect(proof.zone).toEqual({ collection: null, zone_code: null, feature_ref: null, assignment_method: null });
    expect(proof.gaps).toEqual(expect.arrayContaining(["zone_assignment_unavailable", "assignment_method_unavailable", "regulation_source_unavailable"]));
  });
  it("makes a fully evidenced zone complete", () => {
    const proof = zoneProof({ geometryArtifact: "s3://sentropic-geo/normalized/ca-qc-zonage/q.geojson", geometryUpstream: "https://sig.example/zones", regulationArtifact: "s3://sentropic-geo/registry/reglement/q.json", regulationUpstream: "https://city.example/reglement.pdf" });
    expect(proof.status).toBe("complete");
    expect(proof.sources.regulation.upstream_uri).toContain("reglement.pdf");
  });
});
