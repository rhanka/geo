import { describe, expect, it } from "vitest";

import {
  formatSourceDetail,
  formatSourceList,
  listSources,
  showSource,
} from "./sources.js";
import { buildInventory } from "../../catalog/index.js";
import { FIXTURE_REGISTRY, FIXTURE_SOURCE_IDS } from "../../catalog/fixtures.js";

// The CLI `sources` commands read from an injected inventory (ADR-0017). Engine
// tests inject the hermetic fixture; the real catalog is exercised in the
// continent libraries' tests.
const INVENTORY = buildInventory([FIXTURE_REGISTRY]);

describe("listSources", () => {
  it("lists every catalog source from the injected inventory", () => {
    const sources = listSources(INVENTORY);
    expect(sources).toHaveLength(FIXTURE_SOURCE_IDS.length);
  });

  it("lists the ca-qc/sda source with its inventory metadata", () => {
    const sources = listSources(INVENTORY);
    const sda = sources.find((s) => s.id === "ca-qc/sda");
    expect(sda).toBeDefined();
    expect(sda?.license).toBe("cc-by-4.0");
    expect(sda?.redistributable).toBe(true);
    expect(sda?.jurisdiction).toBe("CA-QC");
    expect(sda?.attribution).toBeTruthy();
    expect(sda?.datasetIds).toEqual(["qc-regions", "qc-mrc", "qc-municipalites"]);
  });

  it("filters by --country (case-insensitive)", () => {
    const fr = listSources(INVENTORY, { country: "fr" });
    expect(fr.length).toBeGreaterThan(0);
    expect(fr.every((s) => s.id.startsWith("fr/"))).toBe(true);
    expect(fr.length).toBeLessThan(listSources(INVENTORY).length);
  });

  it("filters by --kind", () => {
    const postal = listSources(INVENTORY, { kind: "postal" });
    expect(postal.length).toBeGreaterThan(0);
    expect(postal.every((s) => s.kind === "postal")).toBe(true);
  });

  it("combines --country and --kind filters", () => {
    const frPostal = listSources(INVENTORY, { country: "FR", kind: "postal" });
    expect(frPostal.length).toBeGreaterThan(0);
    expect(frPostal.every((s) => s.id.startsWith("fr/") && s.kind === "postal")).toBe(true);
  });

  it("formats a human-readable list with attribution", () => {
    const text = formatSourceList(listSources(INVENTORY));
    expect(text).toContain("ca-qc/sda");
    expect(text).toContain("qc-municipalites");
    expect(text).toContain("attribution:");
  });
});

describe("showSource", () => {
  it("inspects a known source from the inventory", () => {
    const detail = showSource(INVENTORY, "ca-qc/sda");
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
    expect(() => showSource(INVENTORY, "nope")).toThrow(/unknown source/);
  });
});
