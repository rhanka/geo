import { getDataset, validateSourceManifest } from "@sentropic/geo-core";
import type { NormalizeContext } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import {
  COG_COMMUNES_URL,
  DATASET_COMMUNES,
  communesNormalizer,
  csvNormalizers,
  manifest,
  registerSource,
} from "./index.js";

function ctx(): NormalizeContext {
  const dataset = getDataset(manifest, DATASET_COMMUNES);
  if (!dataset) throw new Error(`missing dataset ${DATASET_COMMUNES}`);
  return { manifest, dataset };
}

/** A fake COG row keyed by the pinned column names. */
function row(over: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    TYPECOM: "COM",
    COM: "01001",
    REG: "84",
    DEP: "01",
    CTCD: "01D",
    ARR: "012",
    TNCC: "5",
    NCC: "ABERGEMENT CLEMENCIAT",
    NCCENR: "Abergement-Clémenciat",
    LIBELLE: "L'Abergement-Clémenciat",
    CAN: "0108",
    COMPARENT: "",
    ...over,
  };
}

describe("manifest", () => {
  it("is a valid SourceManifest", () => {
    expect(validateSourceManifest(manifest).ok).toBe(true);
  });

  it("declares the INSEE COG statistical source under Licence Ouverte for FR", () => {
    expect(manifest.id).toBe("fr/insee-cog");
    expect(manifest.kind).toBe("statistical");
    expect(manifest.jurisdiction).toEqual({ country: "FR" });
    expect(manifest.license).toBe("licence-ouverte-2.0");
  });

  it("pins the fr-cog-communes CSV dataset with a comma delimiter", () => {
    const ds = getDataset(manifest, DATASET_COMMUNES);
    expect(ds?.format).toBe("csv");
    expect(ds?.url).toBe(COG_COMMUNES_URL);
    expect(ds?.query?.["delimiter"]).toBe(",");
  });
});

describe("registerSource", () => {
  it("returns the manifest and a CSV normalizer for every dataset", () => {
    const reg = registerSource();
    expect(reg.manifest).toBe(manifest);
    for (const dataset of manifest.datasets) {
      expect(typeof reg.csvNormalizers[dataset.id]).toBe("function");
    }
    expect(Object.keys(csvNormalizers)).toEqual([DATASET_COMMUNES]);
  });
});

describe("communesNormalizer", () => {
  it("maps a COM row to code/name/geoId/parentGeoId and preserves columns", () => {
    const out = communesNormalizer([row()], ctx());
    expect(out.features).toHaveLength(1);
    const f = out.features[0];
    expect(f?.geometry).toBeNull();
    expect(f?.id).toBe("fr/commune/01001");
    const p = f?.properties;
    expect(p?.country).toBe("FR");
    expect(p?.code).toBe("01001");
    expect(p?.name).toBe("L'Abergement-Clémenciat");
    expect(p?.departement).toBe("01");
    expect(p?.region).toBe("84");
    expect(p?.geoId).toBe("fr/commune/01001");
    expect(p?.parentGeoId).toBe("fr/department/01");
    // Original COG columns preserved.
    expect(p?.TYPECOM).toBe("COM");
    expect(p?.NCCENR).toBe("Abergement-Clémenciat");
    expect(p?.CAN).toBe("0108");
  });

  it("handles overseas departments (3-digit DEP)", () => {
    const out = communesNormalizer(
      [row({ COM: "97101", REG: "01", DEP: "971", LIBELLE: "Les Abymes" })],
      ctx(),
    );
    const p = out.features[0]?.properties;
    expect(p?.code).toBe("97101");
    expect(p?.geoId).toBe("fr/commune/97101");
    expect(p?.parentGeoId).toBe("fr/department/971");
  });

  it("filters out non-COM rows (ARM / COMA / COMD)", () => {
    const out = communesNormalizer(
      [
        row({ TYPECOM: "COM", COM: "01001" }),
        row({ TYPECOM: "COMD", COM: "01015", REG: "", DEP: "", COMPARENT: "01015" }),
        row({ TYPECOM: "COMA", COM: "01099", REG: "", DEP: "" }),
        row({ TYPECOM: "ARM", COM: "75101", REG: "", DEP: "" }),
      ],
      ctx(),
    );
    expect(out.features).toHaveLength(1);
    expect(out.features[0]?.properties?.code).toBe("01001");
  });

  it("skips rows without a commune code", () => {
    const out = communesNormalizer([row({ COM: "" })], ctx());
    expect(out.features).toHaveLength(0);
  });
});
