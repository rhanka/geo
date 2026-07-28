import { describe, expect, it } from "vitest";

import {
  buildProofUrlSurvivalReport,
  observationFromProbe,
} from "./served-zonage-proof-url-survival.js";

describe("served zoning proof URL survival", () => {
  it("classifies a selected probe from the opened geometric attempt", () => {
    expect(observationFromProbe({
      endpoint: "https://example.test/arcgis/rest/services/Zones/FeatureServer/0",
      selected_url: "https://example.test/arcgis/rest/services/Zones/FeatureServer/0/query?f=geojson",
      attempts: [{
        url: "https://example.test/arcgis/rest/services/Zones/FeatureServer/0/query?f=geojson",
        http_status: 200,
        classification: "GEOMETRIE",
        detail: "json-features-with-coordinates",
      }],
    }, "probe-lot", "probe.json")).toMatchObject({
      classification: "GEOMETRIE",
      detail: "json-features-with-coordinates",
    });
  });

  it("builds a closed URL-level partition and counts a repeated receipt only once", () => {
    const candidates = [
      { slug: "alpha", source: "zones-v1-proof-url", urls: ["https://example.test/alpha"] },
      {
        slug: "bravo",
        source: "zones-v1-proof-url",
        urls: ["https://example.test/arcgis/rest/services/Zones/FeatureServer/0/query?f=geojson"],
      },
    ];
    const observations = [
      {
        candidate_url: "https://example.test/alpha",
        served_url: "https://example.test/alpha",
        classification: "PAGE HTML" as const,
        detail: "html-document",
        lot: "cluster-a",
        evidence: "manifest-a:1",
      },
      {
        candidate_url: "https://example.test/arcgis/rest/services/Zones/FeatureServer/0",
        served_url: "https://example.test/arcgis/rest/services/Zones/FeatureServer/0/query?f=geojson",
        classification: "404" as const,
        detail: "http-404",
        lot: "probe-a",
        evidence: "probe-a.json",
      },
      {
        candidate_url: "https://example.test/arcgis/rest/services/Zones/FeatureServer/0",
        served_url: "https://example.test/arcgis/rest/services/Zones/FeatureServer/0/query?f=geojson",
        classification: "404" as const,
        detail: "http-404",
        lot: "probe-b",
        evidence: "probe-b.json",
      },
    ];
    const report = buildProofUrlSurvivalReport(candidates, observations);
    expect(report.complete).toBe(true);
    expect(report.partition).toEqual({
      GEOMETRIE: 0,
      "PAGE HTML": 1,
      "404": 1,
      AUTRE: 0,
      total: 2,
      closed: true,
    });
    expect(report.measurements.duplicate_observations).toBe(1);
  });
});
