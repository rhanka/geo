import { describe, expect, it } from "vitest";
import {
  getDataset,
  isRedistributable,
  validateSourceManifest,
  type SourceManifest,
} from "./source-manifest.js";

const validManifest: SourceManifest = {
  id: "ca-qc/decoupages-administratifs",
  title: "Découpages administratifs du Québec",
  jurisdiction: { country: "CA", subdivision: "CA-QC", level: "region" },
  provider: { name: "Gouvernement du Québec — MRNF", url: "https://www.donneesquebec.ca" },
  license: "cc-by-4.0",
  datasets: [
    {
      id: "regions",
      title: "Régions administratives",
      format: "arcgis-rest",
      url: "https://servicescarto.mern.gouv.qc.ca/pes/rest/services/Territoire/SDA_WMS/MapServer",
      adminLevel: "region",
      layer: 0,
    },
  ],
};

describe("validateSourceManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateSourceManifest(validManifest);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("ca-qc/decoupages-administratifs");
  });

  it("rejects a non-object", () => {
    expect(validateSourceManifest(null).ok).toBe(false);
    expect(validateSourceManifest("nope").ok).toBe(false);
  });

  it("collects errors for missing required fields", () => {
    const result = validateSourceManifest({ datasets: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining("id"),
          expect.stringContaining("title"),
          expect.stringContaining("jurisdiction"),
          expect.stringContaining("provider"),
          expect.stringContaining("license"),
          expect.stringContaining("datasets"),
        ]),
      );
    }
  });

  it("rejects unknown dataset formats and duplicate dataset ids", () => {
    const bad = validateSourceManifest({
      ...validManifest,
      datasets: [
        { id: "x", title: "X", format: "rar", url: "http://e" },
        { id: "x", title: "X2", format: "geojson", url: "http://e" },
      ],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.includes("format"))).toBe(true);
      expect(bad.errors.some((e) => e.includes("unique"))).toBe(true);
    }
  });
});

describe("license helpers", () => {
  it("reports redistributability from the manifest license", () => {
    expect(isRedistributable(validManifest)).toBe(true);
    expect(isRedistributable({ ...validManifest, license: "proprietary" })).toBe(false);
  });
});

describe("getDataset", () => {
  it("finds a dataset by id", () => {
    expect(getDataset(validManifest, "regions")?.layer).toBe(0);
    expect(getDataset(validManifest, "nope")).toBeUndefined();
  });
});
