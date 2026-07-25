import { resolveLicense } from "@sentropic/geo-core";
import { describe, expect, it } from "vitest";

import {
  allSources,
  buildInventory,
  byCountry,
  byKind,
  bySourceId,
  datasetsFor,
  redistributableSources,
  type InventoryEntry,
} from "./index.js";
import { FIXTURE_REGISTRY, FIXTURE_SOURCE_IDS } from "./fixtures.js";

// Engine-level catalog tests run against the hermetic fixture registry
// (ADR-0017): the engine never statically imports source packages, so the
// inventory is built and injected. The real-data assertions (the full 13-source
// catalog) live in the continent libraries' own tests.
const INVENTORY = buildInventory([FIXTURE_REGISTRY]);

describe("buildInventory", () => {
  it("projects every manifest of the supplied registries", () => {
    expect(INVENTORY.length).toBe(FIXTURE_REGISTRY.manifests.length);
    expect(INVENTORY.length).toBe(FIXTURE_SOURCE_IDS.length);
  });

  it("contains every expected source id", () => {
    const ids = new Set(INVENTORY.map((entry) => entry.sourceId));
    for (const expected of FIXTURE_SOURCE_IDS) {
      expect(ids.has(expected)).toBe(true);
    }
  });

  it("has unique source ids", () => {
    const ids = INVENTORY.map((entry) => entry.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is sorted by sourceId for stable ordering", () => {
    const ids = INVENTORY.map((entry) => entry.sourceId);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sorted);
  });

  it("aggregates across multiple registries", () => {
    const merged = buildInventory([FIXTURE_REGISTRY, FIXTURE_REGISTRY]);
    expect(merged.length).toBe(FIXTURE_REGISTRY.manifests.length * 2);
  });

  it("projects a complete, well-formed entry per source", () => {
    for (const entry of INVENTORY) {
      expect(entry.sourceId).toBeTruthy();
      expect(entry.title).toBeTruthy();
      expect(["administrative", "statistical", "postal"]).toContain(entry.kind);
      expect(entry.jurisdiction.country).toMatch(/^[A-Z]{2}$/);
      expect(entry.license.id).toBeTruthy();
      expect(typeof entry.redistributable).toBe("boolean");
      expect(entry.attribution).toBeTruthy();
      expect(entry.datasets.length).toBeGreaterThan(0);
      for (const dataset of entry.datasets) {
        expect(dataset.id).toBeTruthy();
        expect(dataset.title).toBeTruthy();
        expect(dataset.format).toBeTruthy();
      }
    }
  });
});

describe("redistributable", () => {
  it("matches resolveLicense for every entry", () => {
    for (const entry of INVENTORY) {
      const expected = resolveLicense(entry.license).redistributable;
      expect(entry.redistributable).toBe(expected);
      // license is already resolved, so it equals its own redistribution flag
      expect(entry.redistributable).toBe(entry.license.redistributable);
    }
  });

  it("redistributableSources() returns exactly the redistributable entries", () => {
    const got = redistributableSources(INVENTORY);
    const want = INVENTORY.filter((entry) => entry.redistributable);
    expect(got).toEqual(want);
    expect(got.every((entry) => entry.license.redistributable)).toBe(true);
  });
});

describe("allSources", () => {
  it("returns the whole inventory", () => {
    expect(allSources(INVENTORY)).toBe(INVENTORY);
    expect(allSources(INVENTORY).length).toBe(INVENTORY.length);
  });
});

describe("byCountry", () => {
  it("filters CA sources", () => {
    const ca = byCountry(INVENTORY, "CA");
    expect(ca.length).toBeGreaterThan(0);
    expect(ca.every((entry) => entry.jurisdiction.country === "CA")).toBe(true);
    const ids = ca.map((entry) => entry.sourceId);
    expect(ids).toContain("ca-qc/sda");
    expect(ids).toContain("ca/provinces");
    expect(ids).not.toContain("fr/admin-express");
  });

  it("filters FR sources and is case-insensitive", () => {
    const fr = byCountry(INVENTORY, "fr");
    expect(fr.length).toBeGreaterThan(0);
    expect(fr.every((entry) => entry.jurisdiction.country === "FR")).toBe(true);
    const ids = fr.map((entry) => entry.sourceId);
    expect(ids).toContain("fr/admin-express");
    expect(ids).toContain("fr/insee-cog");
  });

  it("partitions the inventory by country", () => {
    expect(byCountry(INVENTORY, "CA").length + byCountry(INVENTORY, "FR").length).toBe(
      INVENTORY.length,
    );
  });
});

describe("byKind", () => {
  it("filters postal sources", () => {
    const postal = byKind(INVENTORY, "postal");
    expect(postal.every((entry) => entry.kind === "postal")).toBe(true);
    const ids = postal.map((entry) => entry.sourceId);
    expect(ids).toContain("ca/statcan-fsa");
    expect(ids).toContain("fr/laposte-codes-postaux");
    expect(ids).not.toContain("ca-qc/sda");
  });

  it("filters statistical sources", () => {
    const statistical = byKind(INVENTORY, "statistical");
    expect(statistical.map((entry) => entry.sourceId)).toContain("fr/insee-cog");
  });

  it("partitions the inventory by kind", () => {
    const total =
      byKind(INVENTORY, "administrative").length +
      byKind(INVENTORY, "statistical").length +
      byKind(INVENTORY, "postal").length;
    expect(total).toBe(INVENTORY.length);
  });
});

describe("bySourceId", () => {
  it("finds a known source", () => {
    const sda = bySourceId(INVENTORY, "ca-qc/sda") as InventoryEntry;
    expect(sda).toBeDefined();
    expect(sda.sourceId).toBe("ca-qc/sda");
    expect(sda.jurisdiction.subdivision).toBe("CA-QC");
    expect(sda.license.id).toBe("cc-by-4.0");
  });

  it("returns undefined for an unknown source", () => {
    expect(bySourceId(INVENTORY, "xx/nope")).toBeUndefined();
  });
});

describe("datasetsFor", () => {
  it("returns the datasets of a known source", () => {
    const datasets = datasetsFor(INVENTORY, "ca-qc/sda");
    const ids = datasets.map((dataset) => dataset.id);
    expect(ids).toContain("qc-regions");
    expect(ids).toContain("qc-mrc");
    expect(ids).toContain("qc-municipalites");
  });

  it("returns an empty array for an unknown source", () => {
    expect(datasetsFor(INVENTORY, "xx/nope")).toEqual([]);
  });
});
