import { describe, expect, it } from "vitest";

import {
  buildGetFeatureUrl,
  featuresBboxCenter,
  haversineKm,
  normalizeWfsFeatures,
  parsePairs,
  positionsOf,
  validateWfsZoneCodes,
  type GeoFeature,
  type WfsConfig,
} from "./zones-wfs-run.js";

const CFG: WfsConfig = {
  base: "https://geoserver.geocentralis.com/geoserver/ows",
  layer: "evb:zonage_municipal",
  zoneField: "no_zonage_municipal",
  muniField: "id_municipalite",
};

describe("zones-wfs-run helpers", () => {
  it("parses slug=code pairs and rejects malformed codes", () => {
    expect(parsePairs("amqui=07047, montmagny=18050 ,bad=,=99,nope")).toEqual([
      { slug: "amqui", code: "07047" },
      { slug: "montmagny", code: "18050" },
    ]);
  });

  it("builds a WFS 2.0 GetFeature URL with a per-muni cql_filter (GeoJSON, WGS84, paged)", () => {
    const url = buildGetFeatureUrl(CFG, "07047", 0, 1000);
    const u = new URL(url);
    expect(u.searchParams.get("service")).toBe("WFS");
    expect(u.searchParams.get("version")).toBe("2.0.0");
    expect(u.searchParams.get("request")).toBe("GetFeature");
    expect(u.searchParams.get("typeNames")).toBe("evb:zonage_municipal");
    expect(u.searchParams.get("outputFormat")).toBe("application/json");
    expect(u.searchParams.get("srsName")).toBe("EPSG:4326");
    expect(u.searchParams.get("count")).toBe("1000");
    expect(u.searchParams.get("startIndex")).toBe("0");
    expect(u.searchParams.get("cql_filter")).toBe("id_municipalite='07047'");
  });

  it("escapes single quotes in the muni code to avoid CQL injection", () => {
    const url = buildGetFeatureUrl(CFG, "0'7", 1000, 1000);
    expect(new URL(url).searchParams.get("cql_filter")).toBe("id_municipalite='0''7'");
  });

  it("normalizes real zone codes and nulls blank ones (anti-invention)", () => {
    const raw: GeoFeature[] = [
      { type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: { no_zonage_municipal: "155 Ha", description: "x" } },
      { type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: { no_zonage_municipal: "  " } },
      { type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: { no_zonage_municipal: null } },
    ];
    const norm = normalizeWfsFeatures(raw, "no_zonage_municipal", "src#layer");
    expect(norm.map((f) => f.properties.zone_code)).toEqual(["155 Ha", null, null]);
    expect(norm[0]!.properties.confidence).toBe("obscura-wfs-geoserver");
    expect(norm[0]!.properties.source).toBe("src#layer");
  });

  it("accepts an explicit WFS regulatory zone field with three distinct real codes", () => {
    const raw: GeoFeature[] = ["AFV-1", "PUm-3", "REC-19"].map((code) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [] },
      properties: { etiquette_1: code },
    }));
    const verdict = validateWfsZoneCodes(raw, "etiquette_1");
    expect(verdict.ok).toBe(true);
    expect(verdict.stats.distinct).toBe(3);
    expect(verdict.stats.sample).toEqual(["AFV-1", "PUm-3", "REC-19"]);
  });

  it("rejects OBJECTID even when values are present and distinct", () => {
    const raw: GeoFeature[] = [101, 205, 309].map((id) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [] },
      properties: { OBJECTID: id },
    }));
    const verdict = validateWfsZoneCodes(raw, "OBJECTID");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("champ zone interdit");
  });

  it("rejects fewer than three distinct zone codes", () => {
    const raw: GeoFeature[] = ["H-1", "H-1", "P-2"].map((code) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [] },
      properties: { CODE_ZONE: code },
    }));
    const verdict = validateWfsZoneCodes(raw, "CODE_ZONE");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("<3 codes distincts");
  });

  it("rejects sequential integer identifiers even under a zone-like field name", () => {
    const raw: GeoFeature[] = [1, 2, 3, 4, 5].map((code) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [] },
      properties: { NO_ZONE: code },
    }));
    const verdict = validateWfsZoneCodes(raw, "NO_ZONE");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("séquentielles");
  });

  it("rejects generic Zone fields that contain usage labels instead of zone codes", () => {
    const raw: GeoFeature[] = ["Rurale", "Urbaine", "Industrielle"].map((label) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [] },
      properties: { Zone: label },
    }));
    const verdict = validateWfsZoneCodes(raw, "Zone");
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("champ générique");
  });

  it("walks every position of a nested MultiPolygon and finds the bbox centre", () => {
    const f: GeoFeature = {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: [[[[-67.4, 48.4], [-67.2, 48.4], [-67.2, 48.6], [-67.4, 48.6], [-67.4, 48.4]]]] },
      properties: { zone_code: "A" },
    };
    expect([...positionsOf(f.geometry!.coordinates)].length).toBe(5);
    const c = featuresBboxCenter([f]);
    expect(c.lon).toBeCloseTo(-67.3, 5);
    expect(c.lat).toBeCloseTo(48.5, 5);
  });

  it("computes haversine distance (montmagny WFS centre ≈ registry centroid)", () => {
    // montmagny registry ≈ 46.98,-70.55 ; a feature centre nearby must be small
    expect(haversineKm(46.98, -70.55, 46.97, -70.56)).toBeLessThan(5);
    // a Côte-Nord centre vs a Montérégie centroid must be huge (spatial gate trips)
    expect(haversineKm(45.3, -73.2, 50.2, -66.3)).toBeGreaterThan(35);
  });
});
