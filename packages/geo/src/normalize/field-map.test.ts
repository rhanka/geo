import type { FeatureCollection, NormalizeContext, SourceManifest } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import { makeFieldMapNormalizer } from "./field-map.js";

const manifest: SourceManifest = {
  id: "ca-qc/sda",
  title: "SDA",
  jurisdiction: { country: "CA", subdivision: "CA-QC" },
  provider: { name: "MRNF" },
  license: "cc-by-4.0",
  datasets: [
    {
      id: "qc-regions",
      title: "Régions",
      format: "geojson",
      url: "https://example.test/regions.geojson",
      adminLevel: "region",
    },
  ],
};

const ctx: NormalizeContext = { manifest, dataset: manifest.datasets[0]! };

const raw: FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "r03",
      geometry: { type: "Point", coordinates: [-71.2, 46.8] },
      properties: { RES_NM_REG: "Capitale-Nationale", RES_CO_REG: "03", ISO: "CA-QC" },
    },
  ],
};

describe("makeFieldMapNormalizer", () => {
  it("maps named raw properties onto standard AdminProperties", () => {
    const normalize = makeFieldMapNormalizer({
      name: "RES_NM_REG",
      code: "RES_CO_REG",
      iso: "ISO",
    });
    const fc = normalize(raw, ctx);
    const props = fc.features[0]!.properties;
    expect(props.name).toBe("Capitale-Nationale");
    expect(props.code).toBe("03");
    expect(props.iso).toBe("CA-QC");
    expect(props.level).toBe("region");
    expect(props.country).toBe("CA");
  });

  it("derives a canonical geoId from country/dataset/level/code", () => {
    const normalize = makeFieldMapNormalizer({ name: "RES_NM_REG", code: "RES_CO_REG" });
    const fc = normalize(raw, ctx);
    expect(fc.features[0]!.properties.geoId).toBe("ca/qc-regions/region/03");
  });

  it("accepts a list of candidate keys (first non-empty wins)", () => {
    const normalize = makeFieldMapNormalizer({ name: ["NOM", "RES_NM_REG"] });
    const fc = normalize(raw, ctx);
    expect(fc.features[0]!.properties.name).toBe("Capitale-Nationale");
  });

  it("preserves the original properties and feature id", () => {
    const normalize = makeFieldMapNormalizer({ name: "RES_NM_REG" });
    const fc = normalize(raw, ctx);
    const f = fc.features[0]!;
    expect(f.id).toBe("r03");
    expect((f.properties as Record<string, unknown>)["RES_CO_REG"]).toBe("03");
  });

  it("throws on a non-FeatureCollection payload", () => {
    const normalize = makeFieldMapNormalizer({ name: "RES_NM_REG" });
    expect(() => normalize({ type: "nonsense" }, ctx)).toThrow(/FeatureCollection/);
  });
});
