import { describe, expect, it } from "vitest";

import {
  formatSourceDetail,
  formatSourceList,
  listSources,
  showSource,
} from "./sources.js";

describe("listSources", () => {
  it("lists all 13 catalog sources", () => {
    const sources = listSources();
    expect(sources).toHaveLength(13);
  });

  it("lists the ca-qc/sda source with its inventory metadata", () => {
    const sources = listSources();
    const sda = sources.find((s) => s.id === "ca-qc/sda");
    expect(sda).toBeDefined();
    expect(sda?.license).toBe("cc-by-4.0");
    expect(sda?.redistributable).toBe(true);
    expect(sda?.jurisdiction).toBe("CA-QC");
    expect(sda?.attribution).toBeTruthy();
    expect(sda?.datasetIds).toEqual(["qc-regions", "qc-mrc", "qc-municipalites"]);
  });

  it("filters by --country (case-insensitive)", () => {
    const fr = listSources({ country: "fr" });
    expect(fr.length).toBeGreaterThan(0);
    expect(fr.every((s) => s.id.startsWith("fr/"))).toBe(true);
    expect(fr.length).toBeLessThan(listSources().length);
  });

  it("filters by --kind", () => {
    const postal = listSources({ kind: "postal" });
    expect(postal.length).toBeGreaterThan(0);
    expect(postal.every((s) => s.kind === "postal")).toBe(true);
  });

  it("combines --country and --kind filters", () => {
    const frPostal = listSources({ country: "FR", kind: "postal" });
    expect(frPostal.length).toBeGreaterThan(0);
    expect(frPostal.every((s) => s.id.startsWith("fr/") && s.kind === "postal")).toBe(true);
  });

  it("formats a human-readable list with attribution", () => {
    const text = formatSourceList(listSources());
    expect(text).toContain("ca-qc/sda");
    expect(text).toContain("qc-municipalites");
    expect(text).toContain("attribution:");
  });
});

describe("showSource", () => {
  it("inspects a known source from the inventory", () => {
    const detail = showSource("ca-qc/sda");
    expect(detail.title).toBeTruthy();
    expect(detail.kind).toBe("administrative");
    expect(detail.country).toBe("CA");
    expect(detail.subdivision).toBe("CA-QC");
    expect(detail.attribution).toBeTruthy();
    expect(detail.datasets).toHaveLength(3);
    const muni = detail.datasets.find((d) => d.id === "qc-municipalites");
    expect(muni?.adminLevel).toBe("municipality");
    expect(formatSourceDetail(detail)).toContain("ca-qc/sda");
  });

  it("throws for an unknown source", () => {
    expect(() => showSource("nope")).toThrow(/unknown source/);
  });
});
