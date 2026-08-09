import { describe, expect, it } from "vitest";

import { lotSummaryFromStats, summarizeServedCollection } from "./zones-bprime-proof-audit.js";

describe("B' zone proof audit", () => {
  it("selects a uniformly orphan collection even when its URL stamp is null", () => {
    expect(summarizeServedCollection({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { zone_code: "H-1", zone_source_url: null, zone_source_level: "orphan" } },
        { type: "Feature", properties: { zone_code: "H-2", zone_source_url: null, zone_source_level: "orphan" } },
      ],
    })).toMatchObject({ needs_reacquisition: true, provenance: "orphan+stamped-null", http_source_urls: [] });
  });

  it("selects a stamped-null collection without inventing a provenance level", () => {
    expect(summarizeServedCollection({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { zone_code: "R-1", zone_source_url: null } },
      ],
    })).toMatchObject({ needs_reacquisition: true, provenance: "stamped-null", source_levels: [] });
  });

  it("does not treat a non-http string as a real source URL", () => {
    const result = summarizeServedCollection({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { zone_code: "C-1", zone_source_url: "s3://sentropic-geo/source", zone_source_level: "orphan" } },
      ],
    });
    expect(result).toMatchObject({ needs_reacquisition: true, provenance: "orphan", http_source_urls: [] });
    expect(result.invalid_source_url_values).toEqual(["s3://sentropic-geo/source"]);
  });

  it("keeps a collection with a real source URL out of the no-source worklist", () => {
    expect(summarizeServedCollection({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { zone_code: "I-1", zone_source_url: "https://data.example.test/zones.geojson", zone_source_level: "documented", regl: "12" } },
      ],
    })).toMatchObject({ needs_reacquisition: false, provenance: "source-http", property_key_count: 4, property_value_count: 4 });
  });

  it("uses the qc-lots stats counters instead of treating the stats document as GeoJSON", () => {
    expect(lotSummaryFromStats({ num_lots: 12_400, num_with_zone_code: 12_018 })).toEqual({
      lot_count: 12_400,
      assigned_lot_count: 12_018,
    });
  });
});
