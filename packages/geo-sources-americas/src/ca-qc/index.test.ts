import type { FeatureCollection } from "@sentropic/geo-core";
import { getDataset, validateSourceManifest } from "@sentropic/geo-core";
import type { NormalizeContext } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import {
  DATASET_MRC,
  DATASET_MUNICIPALITES,
  DATASET_REGIONS,
  SDA_LAYERS,
  manifest,
  mrcNormalizer,
  municipalitesNormalizer,
  normalizers,
  regionsNormalizer,
  registerSource,
} from "./index.js";

function ctxFor(datasetId: string): NormalizeContext {
  const dataset = getDataset(manifest, datasetId);
  if (!dataset) throw new Error(`missing dataset ${datasetId}`);
  return { manifest, dataset };
}

/** A minimal fake SDA FeatureCollection for a single layer. */
function fc(properties: Record<string, unknown>): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-71.2, 46.8] },
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

  it("declares the SDA source under CC-BY 4.0 for Québec", () => {
    expect(manifest.id).toBe("ca-qc/sda");
    expect(manifest.kind).toBe("administrative");
    expect(manifest.jurisdiction).toEqual({ country: "CA", subdivision: "CA-QC" });
    expect(manifest.license).toBe("cc-by-4.0");
  });

  it("pins the three qc- datasets with correct layers and admin levels", () => {
    expect(getDataset(manifest, DATASET_REGIONS)?.layer).toBe(SDA_LAYERS.regions);
    expect(getDataset(manifest, DATASET_REGIONS)?.adminLevel).toBe("region");
    expect(getDataset(manifest, DATASET_MRC)?.layer).toBe(SDA_LAYERS.mrc);
    expect(getDataset(manifest, DATASET_MRC)?.adminLevel).toBe("mrc");
    expect(getDataset(manifest, DATASET_MUNICIPALITES)?.layer).toBe(SDA_LAYERS.municipalites);
    expect(getDataset(manifest, DATASET_MUNICIPALITES)?.adminLevel).toBe("municipality");
    expect(manifest.datasets.every((d) => d.format === "gpkg")).toBe(true);
    expect(manifest.datasets.every((d) => d.url.endsWith("SDA.gpkg.zip"))).toBe(true);
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
      [DATASET_REGIONS, DATASET_MRC, DATASET_MUNICIPALITES].sort(),
    );
  });
});

describe("regionsNormalizer", () => {
  it("maps SDA région fields to AdminProperties", () => {
    const out = regionsNormalizer(
      fc({ RES_CO_REG: "11", RES_NM_REG: "Gaspésie–Îles-de-la-Madeleine" }),
      ctxFor(DATASET_REGIONS),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Gaspésie–Îles-de-la-Madeleine");
    expect(props?.code).toBe("11");
    expect(props?.level).toBe("region");
    expect(props?.country).toBe("CA");
    expect(props?.iso).toBe("CA-QC");
    expect(props?.geoId).toBe("ca/qc/region/11");
    expect(props?.parentGeoId).toBeUndefined();
    // Original SDA props preserved.
    expect(props?.RES_NM_REG).toBe("Gaspésie–Îles-de-la-Madeleine");
  });
});

describe("mrcNormalizer", () => {
  it("maps SDA MRC fields and derives the parent région geoId", () => {
    const out = mrcNormalizer(
      fc({ MRS_CO_MRC: "371", MRS_NM_MRC: "Trois-Rivières", MRS_CO_REG: "04" }),
      ctxFor(DATASET_MRC),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Trois-Rivières");
    expect(props?.code).toBe("371");
    expect(props?.level).toBe("mrc");
    expect(props?.geoId).toBe("ca/qc/mrc/371");
    expect(props?.parentGeoId).toBe("ca/qc/region/04");
  });
});

describe("municipalitesNormalizer", () => {
  it("maps SDA municipalité fields and derives the parent MRC geoId", () => {
    const out = municipalitesNormalizer(
      fc({ MUS_CO_GEO: "97035", MUS_NM_MUN: "Fermont", MUS_CO_MRC: "972", MUS_CO_REG: "09" }),
      ctxFor(DATASET_MUNICIPALITES),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Fermont");
    expect(props?.code).toBe("97035");
    expect(props?.level).toBe("municipality");
    expect(props?.country).toBe("CA");
    expect(props?.iso).toBeUndefined();
    expect(props?.geoId).toBe("ca/qc/municipality/97035");
    expect(props?.parentGeoId).toBe("ca/qc/mrc/972");
  });

  it("rejects a non-FeatureCollection payload", () => {
    expect(() => municipalitesNormalizer({ nope: true }, ctxFor(DATASET_MUNICIPALITES))).toThrow();
  });
});
