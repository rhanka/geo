import { describe, expect, it } from "vitest";

import { sourceStampFromServed } from "./zones-arcgis-replace-resume.js";

describe("ArcGIS replacement resume", () => {
  it("uses only the already served v2 geometry proof as the source stamp", () => {
    expect(sourceStampFromServed({
      proof: {
        schema_version: "2.0",
        geometry_source: {
          url: "https://services3.arcgis.com/example/FeatureServer/0/query?where=1%3D1&f=geojson",
          retrieved_at: "2026-07-26T07:17:53.343Z",
          sha256: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          type: "arcgis", method: "natif", reliability: "directe",
        },
      },
    })).toEqual({
      url: "https://services3.arcgis.com/example/FeatureServer/0/query?where=1%3D1&f=geojson",
      level: "documented",
    });
  });

  it("refuses a collection whose stored proof is not a complete v2 source", () => {
    expect(() => sourceStampFromServed({ proof: { schema_version: "2.0", geometry_source: { url: null } } }))
      .toThrow(/preuve géométrique v2/);
  });
});
