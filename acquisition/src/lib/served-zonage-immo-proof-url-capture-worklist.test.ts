import { describe, expect, it } from "vitest";

import {
  arcgisGeometryQueryUrl,
  distinctProofUrlCaptures,
  excludeMeasuredProofUrls,
  probeArcgisGeometryQuery,
  resolveArcgisProofUrlRecaptureWorklist,
  selectProofUrlRecaptureWorklist,
} from "./served-zonage-immo-proof-url-capture-worklist.js";

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

  it("excludes an already measured ArcGIS URL in endpoint or query form", () => {
    const query = "https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson";
    const targets = [{
      slug: "alpha",
      source: "zones-v1-proof-url",
      urls: [query, "https://ville.example/zones"],
    }];
    expect(excludeMeasuredProofUrls(
      targets,
      new Set(["https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0"]),
    )).toEqual([{
      slug: "alpha",
      source: "zones-v1-proof-url",
      urls: ["https://ville.example/zones"],
    }]);
    expect(excludeMeasuredProofUrls(targets, new Set([query]))).toEqual([{
      slug: "alpha",
      source: "zones-v1-proof-url",
      urls: ["https://ville.example/zones"],
    }]);
  });

  it("keeps one deterministic representative capture per shared URL", () => {
    expect(distinctProofUrlCaptures([
      { slug: "alpha", source: "zones-v1-proof-url", urls: ["https://ville.example/shared", "https://ville.example/alpha"] },
      { slug: "bravo", source: "zones-v1-proof-url", urls: ["https://ville.example/shared"] },
    ])).toEqual([
      { slug: "alpha", source: "zones-v1-proof-url", urls: ["https://ville.example/shared"] },
      { slug: "alpha", source: "zones-v1-proof-url", urls: ["https://ville.example/alpha"] },
    ]);
  });

  it("replaces ArcGIS layer descriptions with the GeoJSON query URL", () => {
    expect(arcgisGeometryQueryUrl("https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0")).toBe(
      "https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
    );
    expect(arcgisGeometryQueryUrl("https://gis.example/arcgis/rest/services/Zonage/MapServer/17/", "json")).toBe(
      "https://gis.example/arcgis/rest/services/Zonage/MapServer/17/query?where=1%3D1&outFields=*&f=json",
    );
    expect(arcgisGeometryQueryUrl("https://gis.example/arcgis/rest/services/Zonage/FeatureServer")).toBeNull();
  });

  it("keeps the JSON fallback only when the GeoJSON query did not contain geometry", async () => {
    const resolved = await resolveArcgisProofUrlRecaptureWorklist([
      {
        slug: "arcgis",
        source: "zones-v1-proof-url",
        urls: ["https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson"],
      },
    ], async (endpoint) => ({
      endpoint,
      selected_url: "https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0/query?where=1%3D1&outFields=*&f=json",
      selected_format: "json",
      attempts: [
        { url: "https://example/geojson", http_status: 200, content_type: "application/json", classification: "AUTRE", detail: "json-without-features", coordinate_features: null, transport_error: null },
        { url: "https://example/json", http_status: 200, content_type: "application/json", classification: "GEOMETRIE", detail: "json-features-with-coordinates", coordinate_features: 1, transport_error: null },
      ],
    }));
    expect(resolved.worklist).toEqual([{
      slug: "arcgis",
      source: "zones-v1-proof-url",
      urls: ["https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0/query?where=1%3D1&outFields=*&f=json"],
    }]);
    expect(resolved.probes[0]?.selected_format).toBe("json");
  });

  it("probes f=json exactly once after a non-geometric GeoJSON response", async () => {
    const urls: string[] = [];
    const result = await probeArcgisGeometryQuery(
      "https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0",
      async (url) => {
        urls.push(url);
        return url.endsWith("f=geojson")
          ? new Response(JSON.stringify({ error: { message: "format unsupported" } }), { headers: { "content-type": "application/json" } })
          : new Response(JSON.stringify({ features: [{ geometry: { rings: [[[-72.5, 46.1], [-72.4, 46.1], [-72.5, 46.1]]] } }] }), { headers: { "content-type": "application/json" } });
      },
    );
    expect(urls).toEqual([
      "https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson",
      "https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0/query?where=1%3D1&outFields=*&f=json",
    ]);
    expect(result.selected_format).toBe("json");
    expect(result.attempts).toHaveLength(2);
  });

  it("removes an ArcGIS endpoint that refused both formats instead of retaining its HTML description", async () => {
    const resolved = await resolveArcgisProofUrlRecaptureWorklist([{
      slug: "arcgis",
      source: "zones-v1-proof-url",
      urls: ["https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson"],
    }], async (endpoint) => ({ endpoint, selected_url: null, selected_format: null, attempts: [] }));
    expect(resolved.worklist).toEqual([]);
    expect(resolved.probes).toEqual([{
      endpoint: "https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0",
      selected_url: null,
      selected_format: null,
      attempts: [],
    }]);
  });

  it("probes a shared ArcGIS endpoint only once", async () => {
    let calls = 0;
    const query = "https://services.arcgis.com/org/arcgis/rest/services/Zonage/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson";
    const resolved = await resolveArcgisProofUrlRecaptureWorklist([
      { slug: "alpha", source: "zones-v1-proof-url", urls: [query] },
      { slug: "bravo", source: "zones-v1-proof-url", urls: [query] },
    ], async (endpoint) => {
      calls++;
      return { endpoint, selected_url: query, selected_format: "geojson", attempts: [] };
    });
    expect(calls).toBe(1);
    expect(resolved.probes).toHaveLength(1);
    expect(resolved.worklist).toHaveLength(2);
  });
});
