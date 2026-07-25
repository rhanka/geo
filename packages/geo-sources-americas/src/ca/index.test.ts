import type { FeatureCollection } from "@sentropic/geo-core";
import { getDataset, validateSourceManifest } from "@sentropic/geo-core";
import type { NormalizeContext } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import {
  DATASET_CENSUS_DIVISIONS,
  DATASET_PROVINCES,
  STATCAN_LAYERS,
  censusDivisionsNormalizer,
  isoForPruid,
  levelForPruid,
  manifest,
  normalizers,
  provincesNormalizer,
  registerSource,
} from "./index.js";

function ctxFor(datasetId: string): NormalizeContext {
  const dataset = getDataset(manifest, datasetId);
  if (!dataset) throw new Error(`missing dataset ${datasetId}`);
  return { manifest, dataset };
}

/** A minimal fake StatCan FeatureCollection with the given properties. */
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

  it("declares the StatCan boundary source under OGL-Canada for Canada", () => {
    expect(manifest.id).toBe("ca/statcan-boundaries");
    expect(manifest.kind).toBe("administrative");
    expect(manifest.jurisdiction).toEqual({ country: "CA" });
    expect(manifest.license).toBe("ogl-ca");
  });

  it("pins the ca-provinces dataset as a shapefile in EPSG:3347", () => {
    const pr = getDataset(manifest, DATASET_PROVINCES);
    expect(pr?.layer).toBe(STATCAN_LAYERS.provinces);
    expect(pr?.adminLevel).toBe("province");
    expect(pr?.format).toBe("shp");
    expect(pr?.crs).toBe("EPSG:3347");
    expect(pr?.url.endsWith("lpr_000b21a_e.zip")).toBe(true);
  });

  it("declares the ca-census-divisions dataset for follow-up", () => {
    const cd = getDataset(manifest, DATASET_CENSUS_DIVISIONS);
    expect(cd?.layer).toBe(STATCAN_LAYERS.censusDivisions);
    expect(cd?.format).toBe("shp");
    expect(cd?.url.endsWith("lcd_000b21a_e.zip")).toBe(true);
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
      [DATASET_PROVINCES, DATASET_CENSUS_DIVISIONS].sort(),
    );
  });
});

describe("PRUID mapping helpers", () => {
  it("maps every Canadian PRUID to its ISO 3166-2 code", () => {
    expect(isoForPruid("10")).toBe("CA-NL");
    expect(isoForPruid("11")).toBe("CA-PE");
    expect(isoForPruid("12")).toBe("CA-NS");
    expect(isoForPruid("13")).toBe("CA-NB");
    expect(isoForPruid("24")).toBe("CA-QC");
    expect(isoForPruid("35")).toBe("CA-ON");
    expect(isoForPruid("46")).toBe("CA-MB");
    expect(isoForPruid("47")).toBe("CA-SK");
    expect(isoForPruid("48")).toBe("CA-AB");
    expect(isoForPruid("59")).toBe("CA-BC");
    expect(isoForPruid("60")).toBe("CA-YT");
    expect(isoForPruid("61")).toBe("CA-NT");
    expect(isoForPruid("62")).toBe("CA-NU");
    expect(isoForPruid("99")).toBeUndefined();
  });

  it("classifies the three territories vs provinces", () => {
    expect(levelForPruid("60")).toBe("territory");
    expect(levelForPruid("61")).toBe("territory");
    expect(levelForPruid("62")).toBe("territory");
    expect(levelForPruid("24")).toBe("province");
    expect(levelForPruid("35")).toBe("province");
  });
});

describe("provincesNormalizer", () => {
  it("maps PR fields for a province (Québec) to AdminProperties", () => {
    const out = provincesNormalizer(
      fc({
        PRUID: "24",
        DGUID: "2021A000224",
        PRNAME: "Quebec / Québec",
        PRENAME: "Quebec",
        PRFNAME: "Québec",
        PREABBR: "Que.",
        PRFABBR: "Qc",
      }),
      ctxFor(DATASET_PROVINCES),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Quebec");
    expect(props?.names).toEqual({ en: "Quebec", fr: "Québec" });
    expect(props?.code).toBe("24");
    expect(props?.level).toBe("province");
    expect(props?.country).toBe("CA");
    expect(props?.iso).toBe("CA-QC");
    expect(props?.geoId).toBe("ca/province/24");
    expect(props?.parentGeoId).toBeUndefined();
    // Original PR props preserved.
    expect(props?.DGUID).toBe("2021A000224");
    expect(props?.PRNAME).toBe("Quebec / Québec");
  });

  it("classifies a territory (Nunavut) as level=territory", () => {
    const out = provincesNormalizer(
      fc({ PRUID: "62", PRENAME: "Nunavut", PRFNAME: "Nunavut" }),
      ctxFor(DATASET_PROVINCES),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Nunavut");
    expect(props?.code).toBe("62");
    expect(props?.level).toBe("territory");
    expect(props?.iso).toBe("CA-NU");
    expect(props?.geoId).toBe("ca/province/62");
  });

  it("rejects a non-FeatureCollection payload", () => {
    expect(() => provincesNormalizer({ nope: true }, ctxFor(DATASET_PROVINCES))).toThrow();
  });
});

describe("censusDivisionsNormalizer", () => {
  it("maps CD fields and derives the parent province geoId", () => {
    const out = censusDivisionsNormalizer(
      fc({ CDUID: "2466", CDNAME: "Montréal", CDNAMEE: "Montréal", PRUID: "24" }),
      ctxFor(DATASET_CENSUS_DIVISIONS),
    );
    const props = out.features[0]?.properties;
    expect(props?.name).toBe("Montréal");
    expect(props?.code).toBe("2466");
    expect(props?.level).toBe("county");
    expect(props?.country).toBe("CA");
    expect(props?.geoId).toBe("ca/county/2466");
    expect(props?.parentGeoId).toBe("ca/province/24");
    expect(props?.iso).toBe("CA-QC");
  });
});
