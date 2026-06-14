import type { FeatureCollection } from "@sentropic/geo-core";
import { getDataset, validateSourceManifest } from "@sentropic/geo-core";
import type { NormalizeContext } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import {
  ADE_LAYERS,
  DATASET_COMMUNES,
  DATASET_DEPARTEMENTS,
  DATASET_REGIONS,
  REGION_INSEE_TO_ISO,
  communesNormalizer,
  departementsNormalizer,
  manifest,
  normalizers,
  regionsNormalizer,
  registerSource,
} from "./index.js";

function ctxFor(datasetId: string): NormalizeContext {
  const dataset = getDataset(manifest, datasetId);
  if (!dataset) throw new Error(`missing dataset ${datasetId}`);
  return { manifest, dataset };
}

/** A minimal fake ADMIN EXPRESS FeatureCollection for a single layer. */
function fc(properties: Record<string, unknown>): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [2.35, 48.85] },
        properties,
      },
    ],
  };
}

describe("manifest", () => {
  it("is a valid SourceManifest", () => {
    const result = validateSourceManifest(manifest);
    expect(result.ok).toBe(true);
  });

  it("declares the ADMIN EXPRESS source under Licence Ouverte 2.0 for France", () => {
    expect(manifest.id).toBe("fr/admin-express");
    expect(manifest.kind).toBe("administrative");
    expect(manifest.jurisdiction).toEqual({ country: "FR" });
    expect(manifest.license).toBe("licence-ouverte-2.0");
  });

  it("pins the three fr- datasets with correct layers and admin levels", () => {
    expect(getDataset(manifest, DATASET_REGIONS)?.layer).toBe(ADE_LAYERS.regions);
    expect(getDataset(manifest, DATASET_REGIONS)?.adminLevel).toBe("region");
    expect(getDataset(manifest, DATASET_DEPARTEMENTS)?.layer).toBe(ADE_LAYERS.departements);
    expect(getDataset(manifest, DATASET_DEPARTEMENTS)?.adminLevel).toBe("department");
    expect(getDataset(manifest, DATASET_COMMUNES)?.layer).toBe(ADE_LAYERS.communes);
    expect(getDataset(manifest, DATASET_COMMUNES)?.adminLevel).toBe("municipality");
    expect(manifest.datasets.every((d) => d.format === "gpkg")).toBe(true);
    expect(manifest.datasets.every((d) => d.crs === "EPSG:4326")).toBe(true);
    expect(manifest.datasets.every((d) => d.url.endsWith(".7z"))).toBe(true);
  });
});

describe("registerSource", () => {
  it("returns the manifest and a normalizer for every dataset", () => {
    const reg = registerSource();
    expect(reg.manifest).toBe(manifest);
    for (const dataset of manifest.datasets) {
      expect(typeof reg.normalizers[dataset.id]).toBe("function");
    }
    expect(Object.keys(normalizers).sort()).toEqual(
      [DATASET_REGIONS, DATASET_DEPARTEMENTS, DATASET_COMMUNES].sort(),
    );
  });
});

describe("regionsNormalizer", () => {
  it("maps ADMIN EXPRESS région fields to AdminProperties with ISO 3166-2", () => {
    const out = regionsNormalizer(
      fc({ code_insee: "11", nom_officiel: "Île-de-France" }),
      ctxFor(DATASET_REGIONS),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Île-de-France");
    expect(props?.code).toBe("11");
    expect(props?.level).toBe("region");
    expect(props?.country).toBe("FR");
    expect(props?.iso).toBe("FR-IDF");
    expect(props?.geoId).toBe("fr/region/11");
    expect(props?.parentGeoId).toBeUndefined();
    // Original ADMIN EXPRESS props preserved.
    expect(props?.nom_officiel).toBe("Île-de-France");
  });

  it("maps an overseas région to its two-letter ISO code", () => {
    const out = regionsNormalizer(
      fc({ code_insee: "04", nom_officiel: "La Réunion" }),
      ctxFor(DATASET_REGIONS),
    );
    expect(out.features[0]?.properties.iso).toBe("FR-RE");
    expect(out.features[0]?.properties.geoId).toBe("fr/region/04");
  });
});

describe("departementsNormalizer", () => {
  it("maps ADMIN EXPRESS département fields and derives the parent région geoId", () => {
    const out = departementsNormalizer(
      fc({ code_insee: "75", nom_officiel: "Paris", code_insee_de_la_region: "11" }),
      ctxFor(DATASET_DEPARTEMENTS),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Paris");
    expect(props?.code).toBe("75");
    expect(props?.level).toBe("department");
    expect(props?.country).toBe("FR");
    expect(props?.iso).toBeUndefined();
    expect(props?.geoId).toBe("fr/department/75");
    expect(props?.parentGeoId).toBe("fr/region/11");
  });
});

describe("communesNormalizer", () => {
  it("maps ADMIN EXPRESS commune fields and derives the parent département geoId", () => {
    const out = communesNormalizer(
      fc({
        code_insee: "75056",
        nom_officiel: "Paris",
        code_insee_du_departement: "75",
        code_insee_de_la_region: "11",
      }),
      ctxFor(DATASET_COMMUNES),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Paris");
    expect(props?.code).toBe("75056");
    expect(props?.level).toBe("municipality");
    expect(props?.country).toBe("FR");
    expect(props?.iso).toBeUndefined();
    expect(props?.geoId).toBe("fr/municipality/75056");
    expect(props?.parentGeoId).toBe("fr/department/75");
  });

  it("rejects a non-FeatureCollection payload", () => {
    expect(() => communesNormalizer({ nope: true }, ctxFor(DATASET_COMMUNES))).toThrow();
  });
});

describe("REGION_INSEE_TO_ISO", () => {
  it("covers all 18 régions", () => {
    expect(Object.keys(REGION_INSEE_TO_ISO)).toHaveLength(18);
    expect(REGION_INSEE_TO_ISO["84"]).toBe("FR-ARA");
    expect(REGION_INSEE_TO_ISO["94"]).toBe("FR-COR");
  });
});
