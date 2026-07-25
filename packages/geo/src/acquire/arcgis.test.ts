import { describe, expect, it } from "vitest";

import { arcgisQueryUrl } from "./arcgis.js";

describe("arcgisQueryUrl", () => {
  it("builds the query URL with WGS84 GeoJSON defaults", () => {
    const url = arcgisQueryUrl("https://services.arcgis.com/abc/FeatureServer", 3);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/abc/FeatureServer/3/query");
    expect(parsed.searchParams.get("where")).toBe("1=1");
    expect(parsed.searchParams.get("outFields")).toBe("*");
    expect(parsed.searchParams.get("outSR")).toBe("4326");
    expect(parsed.searchParams.get("f")).toBe("geojson");
  });

  it("tolerates a trailing slash and string layer names", () => {
    const url = arcgisQueryUrl("https://host/svc/FeatureServer/", "regions");
    expect(url.startsWith("https://host/svc/FeatureServer/regions/query?")).toBe(true);
  });

  it("merges and overrides defaults with params", () => {
    const url = arcgisQueryUrl("https://host/svc", 0, {
      where: "REGION='06'",
      resultRecordCount: 100,
      returnGeometry: true,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("where")).toBe("REGION='06'");
    expect(parsed.searchParams.get("resultRecordCount")).toBe("100");
    expect(parsed.searchParams.get("returnGeometry")).toBe("true");
    // Untouched defaults remain.
    expect(parsed.searchParams.get("outSR")).toBe("4326");
    expect(parsed.searchParams.get("f")).toBe("geojson");
  });
});
