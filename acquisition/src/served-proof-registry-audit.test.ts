import { describe, expect, it } from "vitest";
import {
  classifyFeature,
  collectionCategory,
  exactEvidence,
  resolveKeys,
  resolveReportPaths,
  visitFeatures,
} from "./served-proof-registry-audit.js";
import { proofFromFetched } from "./lib/zonage-proof.js";

const proof = proofFromFetched({
  url: "https://data.example.test/zoning.geojson",
  type: "geojson-officiel",
  method: "natif",
  reliability: "directe",
  bytes: "exact response",
  retrievedAt: "2026-07-22T12:00:00Z",
});

describe("served proof registry audit", () => {
  it("resolves explicit report paths from the command working directory", () => {
    expect(resolveReportPaths("../work/report.json", "../work/summary.json", "/repo/acquisition", "/repo")).toEqual({
      out: "/repo/work/report.json",
      summaryOut: "/repo/work/summary.json",
    });
  });

  it("audits both physical layouts while selecting flat serving precedence", () => {
    const resolved = resolveKeys([
      "qc-zonage-alpha",
      "qc-zonage-alpha/qc-zonage-alpha",
      "qc-zonage-beta/qc-zonage-beta",
      "qc-zonage-alpha.stats",
    ], "qc-zonage", "normalized/ca-qc-zonage/");
    expect(resolved.physical).toEqual({ flat: 1, nested: 2, ignored: 1, total: 3 });
    expect(resolved.physicalChoices).toHaveLength(3);
    expect(resolved.choices.map((choice) => [choice.slug, choice.layout])).toEqual([["alpha", "flat"], ["beta", "nested"]]);
  });

  it("requires the exact same valid v2 proof at collection and feature", () => {
    const feature = { properties: { proof: { schema_version: "2.0", geometry_source: proof } } };
    const fc = { type: "FeatureCollection", proof: { schema_version: "2.0", geometry_source: proof } };
    expect(classifyFeature(fc, feature)).toBe("exact_source_eligible");
    expect(classifyFeature(fc, { properties: { proof: { schema_version: "2.0", geometry_source: { ...proof, sha256: `sha256:${"b".repeat(64)}` } } } })).toBe("recoverable");
    expect(classifyFeature({ type: "FeatureCollection" }, feature)).toBe("recoverable");
  });

  it("uses only dedicated geometry evidence and never generic or regulation URLs", () => {
    const generic = { properties: { url: "https://example.test/home", source_url: "https://example.test/source", proof: { sources: { regulation: { upstream_uri: "https://example.test/bylaw.pdf" } } } } };
    expect(exactEvidence({ type: "FeatureCollection" }, generic)).toEqual([]);
    expect(classifyFeature({ type: "FeatureCollection" }, generic)).toBe("quarantine");
    const legacy = { properties: { proof: { sources: { geometry: { upstream_uri: "https://example.test/exact-zones" } } } } };
    expect(exactEvidence({ type: "FeatureCollection" }, legacy)).toEqual([{ url: "https://example.test/exact-zones", field: "feature.properties.proof.sources.geometry.upstream_uri" }]);
    expect(classifyFeature({ type: "FeatureCollection" }, legacy)).toBe("recoverable");
  });

  it("fails empty or partly opaque collections closed", () => {
    expect(collectionCategory(0, {})).toBe("quarantine");
    expect(collectionCategory(2, { exact_source_eligible: 1, recoverable: 1 })).toBe("recoverable");
    expect(collectionCategory(2, { exact_source_eligible: 1, quarantine: 1 })).toBe("quarantine");
  });

  it("visits large-shape features without decoding the full collection string", () => {
    const fc = Buffer.from(JSON.stringify({ type: "FeatureCollection", features: [{ properties: { a: "}" }, geometry: null }, { properties: { b: [1, 2] }, geometry: null }], proof: { schema_version: "2.0", geometry_source: proof } }));
    const seen: unknown[] = [];
    expect(visitFeatures(fc, "fixture", (feature) => seen.push(feature.properties))).toBe(2);
    expect(seen).toEqual([{ a: "}" }, { b: [1, 2] }]);
  });
});
