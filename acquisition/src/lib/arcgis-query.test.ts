import { describe, expect, it } from "vitest";

import { buildArcGisGeoJsonQueryUrl, normalizeArcGisWhere } from "./arcgis-query.js";

const LAYER = "https://services.example.test/arcgis/rest/services/Zonage/FeatureServer/0";

describe("buildArcGisGeoJsonQueryUrl", () => {
  it("should retain the mono-muni query when no attribute filter is supplied", () => {
    expect(buildArcGisGeoJsonQueryUrl(LAYER, ["no_zone"])).toBe(
      `${LAYER}/query?where=1%3D1&outFields=no_zone&outSR=4326&geometryPrecision=6&f=geojson`,
    );
  });

  it("should encode an accented attribute value in the exact proof URL", () => {
    const where = "mun_nom='Saint-Léon-de-Standon'";
    const url = buildArcGisGeoJsonQueryUrl(LAYER, ["no_zone"], { where, resultOffset: 0, resultRecordCount: 1000 });

    expect(url).toContain("where=mun_nom%3D%27Saint-L%C3%A9on-de-Standon%27");
    expect(new URL(url).searchParams.get("where")).toBe(where);
  });

  it("should encode SQL-escaped apostrophes in the exact proof URL", () => {
    const where = "mun_nom='L''Ange-Gardien'";
    const url = buildArcGisGeoJsonQueryUrl(LAYER, ["no_zone"], { where });

    expect(url).toContain("where=mun_nom%3D%27L%27%27Ange-Gardien%27");
    expect(new URL(url).searchParams.get("where")).toBe(where);
  });

  it("should reject an empty attribute clause", () => {
    expect(() => normalizeArcGisWhere("  ")).toThrow("--where ne peut pas être vide");
    expect(() => buildArcGisGeoJsonQueryUrl(LAYER, ["no_zone"], { where: "" })).toThrow("--where ne peut pas être vide");
  });
});
