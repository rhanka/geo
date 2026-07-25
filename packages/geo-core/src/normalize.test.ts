import { describe, expect, it } from "vitest";

import { featuresToCollection } from "./normalize.js";
import type {
  CsvNormalizer,
  FieldMap,
  Normalizer,
  NormalizerFn,
  ReferentialNormalizer,
  SourceRegistry,
} from "./normalize.js";
import type { AdminFeature } from "./feature.js";

const feature: AdminFeature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-71.2, 46.8] },
  properties: { geoId: "ca/qc/region/03", name: "Capitale-Nationale", level: "region", country: "CA" },
};

describe("featuresToCollection", () => {
  it("wraps features into a FeatureCollection", () => {
    const fc = featuresToCollection([feature]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.properties.geoId).toBe("ca/qc/region/03");
  });

  it("wraps an empty list", () => {
    expect(featuresToCollection([])).toEqual({ type: "FeatureCollection", features: [] });
  });
});

describe("registry & normalizer types", () => {
  it("a SourceRegistry carries manifests and recipes; NormalizerFn unifies the three shapes", () => {
    const admin: Normalizer = () => featuresToCollection([]);
    const csv: CsvNormalizer = () => ({ type: "FeatureCollection", features: [] });
    const ref: ReferentialNormalizer = () => ({ type: "FeatureCollection", features: [] });
    const recipes: Record<string, NormalizerFn> = { admin, csv, ref };

    const registry: SourceRegistry = {
      manifests: [
        {
          id: "xx/test",
          title: "Test",
          jurisdiction: { country: "CA" },
          provider: { name: "Test" },
          license: "cc-by-4.0",
          datasets: [{ id: "d", title: "D", format: "geojson", url: "http://e", recipe: "admin" }],
        },
      ],
      recipes,
    };

    expect(registry.manifests).toHaveLength(1);
    expect(Object.keys(registry.recipes)).toEqual(["admin", "csv", "ref"]);
    expect(registry.manifests[0]?.datasets[0]?.recipe).toBe("admin");
  });

  it("a FieldMap accepts string or string[] selectors", () => {
    const fm: FieldMap = { name: ["NOM", "nom"], code: "CODE", iso: "ISO" };
    expect(fm.name).toEqual(["NOM", "nom"]);
    expect(fm.code).toBe("CODE");
  });
});
