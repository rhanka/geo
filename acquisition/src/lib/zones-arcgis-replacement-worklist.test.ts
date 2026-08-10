import { describe, expect, it } from "vitest";

import {
  captureUrlForReplacementTarget,
  parseZonesArcgisReplacementWorklist,
  serializeZonesArcgisReplacementWorklist,
  whereForReplacementTarget,
  zonesArcgisReplacementWorklistSha256,
} from "./zones-arcgis-replacement-worklist.js";

const valid = {
  contract: "zones-arcgis-replacement/v1",
  targets: [{
    slug: "saint-leon-de-standon",
    source: "zones-arcgis",
    layer: "https://services.example/arcgis/rest/services/Zonage/FeatureServer/7/",
    municipality_filter: { field: "MUN_NOM", value: "Saint-Léon-d'Autray" },
    zone_field: "NO_ZONE",
    zone_prefix_field: "PREFIXE",
    max_distance_km: 8,
    allow_deprecated: ["A-16"],
  }],
};

describe("zones ArcGIS replacement worklist", () => {
  it("binds one municipal filter to one deterministic capture URL", () => {
    const worklist = parseZonesArcgisReplacementWorklist(valid);
    const target = worklist.targets[0];

    expect(target.layer).toBe("https://services.example/arcgis/rest/services/Zonage/FeatureServer/7");
    expect(whereForReplacementTarget(target)).toBe("MUN_NOM = 'Saint-Léon-d''Autray'");
    expect(captureUrlForReplacementTarget(target)).toBe(
      "https://services.example/arcgis/rest/services/Zonage/FeatureServer/7/query?where=MUN_NOM%20%3D%20%27Saint-L%C3%A9on-d%27%27Autray%27&outFields=NO_ZONE%2CPREFIXE&outSR=4326&geometryPrecision=6&resultOffset=0&resultRecordCount=20000&f=geojson",
    );
  });

  it("serializes the immutable worklist canonically before hashing it", () => {
    const worklist = parseZonesArcgisReplacementWorklist(valid);
    expect(serializeZonesArcgisReplacementWorklist(worklist)).toBe(`${JSON.stringify({
      contract: "zones-arcgis-replacement/v1",
      targets: [{
        slug: "saint-leon-de-standon",
        source: "zones-arcgis",
        layer: "https://services.example/arcgis/rest/services/Zonage/FeatureServer/7",
        municipality_filter: { field: "MUN_NOM", value: "Saint-Léon-d'Autray" },
        zone_field: "NO_ZONE",
        zone_prefix_field: "PREFIXE",
        max_distance_km: 8,
        allow_deprecated: ["A-16"],
      }],
    }, null, 2)}\n`);
    expect(zonesArcgisReplacementWorklistSha256(worklist)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects a generic worklist, a multi-city run, and an unpinned query URL", () => {
    expect(() => parseZonesArcgisReplacementWorklist([{ slug: "x", source: "zones-arcgis", urls: ["https://example.test"] }]))
      .toThrow();
    expect(() => parseZonesArcgisReplacementWorklist({ ...valid, targets: [valid.targets[0], valid.targets[0]] }))
      .toThrow();
    expect(() => parseZonesArcgisReplacementWorklist({
      ...valid,
      targets: [{ ...valid.targets[0], layer: "https://services.example/FeatureServer/7?token=secret" }],
    })).toThrow(/sans identifiant, query ni fragment/);
  });

  it("rejects ambiguous zone fields and duplicate deprecations", () => {
    expect(() => parseZonesArcgisReplacementWorklist({
      ...valid,
      targets: [{ ...valid.targets[0], zone_field: "NO ZONE" }],
    })).toThrow();
    expect(() => parseZonesArcgisReplacementWorklist({
      ...valid,
      targets: [{ ...valid.targets[0], allow_deprecated: ["A-16", "a 16"] }],
    })).toThrow(/dupliqués/);
  });
});
