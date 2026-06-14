import { getDataset, makeGeoId, validateSourceManifest } from "@sentropic/geo-core";
import type { NormalizeContext } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import {
  CP_COLUMNS,
  DATASET_CODES_POSTAUX,
  codesPostauxNormalizer,
  csvNormalizer,
  manifest,
  normalizers,
  postalGeoId,
  registerSource,
} from "./index.js";

function ctx(): NormalizeContext {
  const dataset = getDataset(manifest, DATASET_CODES_POSTAUX);
  if (!dataset) throw new Error(`missing dataset ${DATASET_CODES_POSTAUX}`);
  return { manifest, dataset };
}

describe("manifest", () => {
  it("is a valid SourceManifest", () => {
    const result = validateSourceManifest(manifest);
    expect(result.ok).toBe(true);
  });

  it("declares the La Poste postal source under Licence Ouverte 2.0 for France", () => {
    expect(manifest.id).toBe("fr/laposte-codes-postaux");
    expect(manifest.kind).toBe("postal");
    expect(manifest.jurisdiction).toEqual({ country: "FR" });
    expect(manifest.license).toBe("licence-ouverte-2.0");
  });

  it("pins one csv dataset with a ';' delimiter", () => {
    expect(manifest.datasets).toHaveLength(1);
    const dataset = getDataset(manifest, DATASET_CODES_POSTAUX);
    expect(dataset?.format).toBe("csv");
    expect(dataset?.query?.["delimiter"]).toBe(";");
    expect(dataset?.url).toContain("laposte-hexasmal");
  });
});

describe("registerSource", () => {
  it("returns the manifest and a normalizer for every dataset", () => {
    const reg = registerSource();
    expect(reg.manifest).toBe(manifest);
    for (const dataset of manifest.datasets) {
      expect(typeof reg.normalizers[dataset.id]).toBe("function");
    }
    expect(Object.keys(normalizers)).toEqual([DATASET_CODES_POSTAUX]);
    expect(csvNormalizer).toBe(reg.normalizers[DATASET_CODES_POSTAUX]);
  });
});

describe("codesPostauxNormalizer", () => {
  it("maps a row to ReferentialProperties with a composite geoId", () => {
    const out = codesPostauxNormalizer(
      [
        {
          [CP_COLUMNS.inseeCode]: "01001",
          [CP_COLUMNS.communeName]: "L ABERGEMENT CLEMENCIAT",
          [CP_COLUMNS.postalCode]: "01400",
          [CP_COLUMNS.libelle]: "L ABERGEMENT CLEMENCIAT",
          [CP_COLUMNS.ligne5]: "",
        },
      ],
      ctx(),
    );
    expect(out.type).toBe("FeatureCollection");
    expect(out.features).toHaveLength(1);
    const feature = out.features[0];
    expect(feature?.geometry).toBeNull();
    const props = feature?.properties;
    expect(props?.country).toBe("FR");
    expect(props?.postalCode).toBe("01400");
    expect(props?.inseeCode).toBe("01001");
    expect(props?.communeName).toBe("L ABERGEMENT CLEMENCIAT");
    expect(props?.libelle).toBe("L ABERGEMENT CLEMENCIAT");
    expect(props?.geoId).toBe(makeGeoId("fr", "cp", "01400", "01001"));
    expect(props?.geoId).toBe("fr/cp/01400/01001");
    expect(feature?.id).toBe(props?.geoId);
    // ligne5 is empty → not stamped as a normalized key.
    expect(props?.ligne5).toBeUndefined();
    // Original column preserved.
    expect(props?.[CP_COLUMNS.inseeCode]).toBe("01001");
  });

  it("reads the upstream '#'-prefixed INSEE header column", () => {
    const out = codesPostauxNormalizer(
      [
        {
          [CP_COLUMNS.inseeCodeHash]: "75056",
          [CP_COLUMNS.communeName]: "PARIS",
          [CP_COLUMNS.postalCode]: "75001",
          [CP_COLUMNS.libelle]: "PARIS",
          [CP_COLUMNS.ligne5]: "",
        },
      ],
      ctx(),
    );
    const props = out.features[0]?.properties;
    expect(props?.inseeCode).toBe("75056");
    expect(props?.postalCode).toBe("75001");
    expect(props?.geoId).toBe("fr/cp/75001/75056");
  });

  it("keeps a non-empty Ligne_5", () => {
    const out = codesPostauxNormalizer(
      [
        {
          [CP_COLUMNS.inseeCode]: "13055",
          [CP_COLUMNS.communeName]: "MARSEILLE",
          [CP_COLUMNS.postalCode]: "13001",
          [CP_COLUMNS.libelle]: "MARSEILLE",
          [CP_COLUMNS.ligne5]: "MARSEILLE 01",
        },
      ],
      ctx(),
    );
    expect(out.features[0]?.properties.ligne5).toBe("MARSEILLE 01");
  });

  it("skips a structurally blank row", () => {
    const out = codesPostauxNormalizer(
      [
        { [CP_COLUMNS.inseeCode]: "", [CP_COLUMNS.postalCode]: "" },
        {
          [CP_COLUMNS.inseeCode]: "01002",
          [CP_COLUMNS.postalCode]: "01640",
          [CP_COLUMNS.communeName]: "L ABERGEMENT DE VAREY",
        },
      ],
      ctx(),
    );
    expect(out.features).toHaveLength(1);
    expect(out.features[0]?.properties.geoId).toBe("fr/cp/01640/01002");
  });

  it("produces a unique geoId per (postal code × commune) pair", () => {
    const out = codesPostauxNormalizer(
      [
        { [CP_COLUMNS.inseeCode]: "13055", [CP_COLUMNS.postalCode]: "13001" },
        { [CP_COLUMNS.inseeCode]: "13055", [CP_COLUMNS.postalCode]: "13002" },
        { [CP_COLUMNS.inseeCode]: "75056", [CP_COLUMNS.postalCode]: "13001" },
      ],
      ctx(),
    );
    const ids = out.features.map((f) => f.properties.geoId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("postalGeoId", () => {
  it("builds a stable fr/cp/<postal>/<insee> id", () => {
    expect(postalGeoId("75001", "75056")).toBe("fr/cp/75001/75056");
  });
});
