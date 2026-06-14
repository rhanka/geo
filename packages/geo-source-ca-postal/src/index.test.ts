import type { FeatureCollection, Geometry } from "@sentropic/geo-core";
import { getDataset, makeGeoId, validateSourceManifest } from "@sentropic/geo-core";
import type { NormalizeContext } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import {
  DATASET_FSA,
  FSA_INNER,
  FSA_LAYER,
  fsaGeoId,
  fsaReferentialNormalizer,
  isoForPruid,
  manifest,
  referentialNormalizer,
  referentialNormalizers,
  registerSource,
} from "./index.js";

function ctx(): NormalizeContext {
  const dataset = getDataset(manifest, DATASET_FSA);
  if (!dataset) throw new Error(`missing dataset ${DATASET_FSA}`);
  return { manifest, dataset };
}

/** A minimal fake StatCan FSA FeatureCollection (one polygon) with the given props. */
function fsaFc(properties: Record<string, unknown>): FeatureCollection {
  const geometry: Geometry = {
    type: "Polygon",
    coordinates: [
      [
        [-73.6, 45.5],
        [-73.5, 45.5],
        [-73.5, 45.6],
        [-73.6, 45.6],
        [-73.6, 45.5],
      ],
    ],
  };
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry, properties }],
  };
}

describe("manifest", () => {
  it("is a valid SourceManifest", () => {
    const result = validateSourceManifest(manifest);
    expect(result.ok).toBe(true);
  });

  it("declares the StatCan FSA postal source under OGL-Canada for Canada", () => {
    expect(manifest.id).toBe("ca/statcan-fsa");
    expect(manifest.kind).toBe("postal");
    expect(manifest.jurisdiction).toEqual({ country: "CA" });
    expect(manifest.license).toBe("ogl-ca");
  });

  it("pins the ca-fsa dataset as a nested shapefile in EPSG:3347", () => {
    const fsa = getDataset(manifest, DATASET_FSA);
    expect(fsa?.format).toBe("shp");
    expect(fsa?.crs).toBe("EPSG:3347");
    expect(fsa?.layer).toBe(FSA_LAYER);
    expect(fsa?.layer).toBe("lfsa000b21a_e");
    expect(fsa?.url.endsWith("lfsa000b21a_e.zip")).toBe(true);
    expect(fsa?.query?.["simplify"]).toBe(100);
    // The shapefile is nested in a subdir; GDAL needs the inner .shp path.
    expect(fsa?.query?.["inner"]).toBe(FSA_INNER);
    expect(fsa?.query?.["inner"]).toBe("lfsa000b21a_e/lfsa000b21a_e.shp");
  });
});

describe("registerSource", () => {
  it("returns the manifest and a referential normalizer for every dataset", () => {
    const reg = registerSource();
    expect(reg.manifest).toBe(manifest);
    for (const dataset of manifest.datasets) {
      expect(typeof reg.referentialNormalizers[dataset.id]).toBe("function");
    }
    expect(Object.keys(referentialNormalizers)).toEqual([DATASET_FSA]);
    expect(referentialNormalizer).toBe(reg.referentialNormalizers[DATASET_FSA]);
  });
});

describe("isoForPruid", () => {
  it("maps a Canadian PRUID to its ISO 3166-2 code, else undefined", () => {
    expect(isoForPruid("24")).toBe("CA-QC");
    expect(isoForPruid("10")).toBe("CA-NL");
    expect(isoForPruid("35")).toBe("CA-ON");
    expect(isoForPruid("62")).toBe("CA-NU");
    expect(isoForPruid("99")).toBeUndefined();
  });
});

describe("fsaGeoId", () => {
  it("builds a stable ca/fsa/<CFSAUID> id", () => {
    expect(fsaGeoId("H2X")).toBe("ca/fsa/h2x");
    expect(fsaGeoId("A0A")).toBe(makeGeoId("ca", "fsa", "A0A"));
  });
});

describe("fsaReferentialNormalizer", () => {
  it("maps an FSA to ReferentialProperties with geometry preserved", () => {
    const out = fsaReferentialNormalizer(
      fsaFc({
        CFSAUID: "H2X",
        DGUID: "2021A0011H2X",
        PRUID: "24",
        PRNAME: "Quebec / Québec",
        LANDAREA: 1.2345,
      }),
      ctx(),
    );
    expect(out.type).toBe("FeatureCollection");
    expect(out.features).toHaveLength(1);

    const feature = out.features[0];
    // Geometry is KEPT (referential-with-geometry), not nulled.
    expect(feature?.geometry?.type).toBe("Polygon");

    const props = feature?.properties;
    expect(props?.geoId).toBe("ca/fsa/h2x");
    expect(props?.country).toBe("CA");
    expect(props?.fsa).toBe("H2X");
    expect(props?.province).toBe("24");
    expect(props?.iso).toBe("CA-QC");
    expect(feature?.id).toBe("ca/fsa/h2x");
    // Original FSA attributes preserved.
    expect(props?.DGUID).toBe("2021A0011H2X");
    expect(props?.PRNAME).toBe("Quebec / Québec");
    expect(props?.LANDAREA).toBe(1.2345);
  });

  it("maps an FSA in a province without an ISO mapping (no iso stamped)", () => {
    const out = fsaReferentialNormalizer(
      fsaFc({ CFSAUID: "A0A", PRUID: "10" }),
      ctx(),
    );
    const props = out.features[0]?.properties;
    expect(props?.fsa).toBe("A0A");
    expect(props?.province).toBe("10");
    expect(props?.iso).toBe("CA-NL");
    expect(props?.geoId).toBe("ca/fsa/a0a");
  });

  it("produces a unique geoId per FSA", () => {
    const out = fsaReferentialNormalizer(
      {
        type: "FeatureCollection",
        features: [
          fsaFc({ CFSAUID: "H2X", PRUID: "24" }).features[0]!,
          fsaFc({ CFSAUID: "H3A", PRUID: "24" }).features[0]!,
          fsaFc({ CFSAUID: "M5V", PRUID: "35" }).features[0]!,
        ],
      },
      ctx(),
    );
    const ids = out.features.map((f) => f.properties.geoId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["ca/fsa/h2x", "ca/fsa/h3a", "ca/fsa/m5v"]);
  });

  it("rejects a non-FeatureCollection payload", () => {
    expect(() => fsaReferentialNormalizer({ nope: true }, ctx())).toThrow();
  });
});
