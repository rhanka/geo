/**
 * Tests unitaires : modèle GeoSourceInventory, dataset réel, helper prioritize.
 */

import { describe, it, expect } from "vitest";
import { GeoSourceInventory } from "./geo-source-inventory.js";
import {
  GEO_SOURCE_INVENTORIES,
  getGeoSourceInventory,
} from "./geo-source-inventory.data.js";
import { prioritizeForGeoVertical } from "./geo-vertical-priority.js";

// ─── Modèle Zod ──────────────────────────────────────────────────────────────

describe("GeoSourceInventory schema", () => {
  it("accepts a valid geojson lots + pdf zonage entry", () => {
    const result = GeoSourceInventory.safeParse({
      citySlug: "salaberry-de-valleyfield",
      zonage: { availability: "pdf", quality: "pdf" },
      lots: {
        availability: "donnees-quebec",
        quality: "geojson",
        url: "https://geo.environnement.gouv.qc.ca/arcgis/rest/services/Mern/Cadastre_allege/MapServer/0/query",
      },
      notes: "Exemple",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid none/unknown entry", () => {
    const result = GeoSourceInventory.safeParse({
      citySlug: "saint-damase",
      zonage: { availability: "unknown", quality: "none" },
      lots: { availability: "unknown", quality: "none" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an entry with an invalid availability value", () => {
    const result = GeoSourceInventory.safeParse({
      citySlug: "test",
      zonage: { availability: "invented-source", quality: "geojson" },
      lots: { availability: "none", quality: "none" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an entry with an invalid quality value", () => {
    const result = GeoSourceInventory.safeParse({
      citySlug: "test",
      zonage: { availability: "none", quality: "shapefile" },
      lots: { availability: "none", quality: "none" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an entry with a malformed URL", () => {
    const result = GeoSourceInventory.safeParse({
      citySlug: "test",
      zonage: { availability: "pdf", quality: "pdf", url: "not-a-url" },
      lots: { availability: "none", quality: "none" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts an entry without url (url is optional)", () => {
    const result = GeoSourceInventory.safeParse({
      citySlug: "test",
      zonage: { availability: "none", quality: "none" },
      lots: { availability: "none", quality: "none" },
    });
    expect(result.success).toBe(true);
  });

  it("requires a non-empty citySlug", () => {
    const result = GeoSourceInventory.safeParse({
      citySlug: "",
      zonage: { availability: "none", quality: "none" },
      lots: { availability: "none", quality: "none" },
    });
    expect(result.success).toBe(false);
  });
});

// ─── Intégrité du dataset réel ────────────────────────────────────────────────

describe("GEO_SOURCE_INVENTORIES dataset", () => {
  it("contains exactly the 6 investigated priority cities", () => {
    const slugs = GEO_SOURCE_INVENTORIES.map((inv) => inv.citySlug);
    expect(slugs).toEqual([
      "salaberry-de-valleyfield",
      "beauharnois",
      "sainte-catherine",
      "delson",
      "saint-constant",
      "saint-damase",
    ]);
  });

  it("passes Zod validation for every entry", () => {
    for (const inv of GEO_SOURCE_INVENTORIES) {
      const result = GeoSourceInventory.safeParse(inv);
      if (!result.success) {
        throw new Error(
          `Schema validation failed for ${inv.citySlug}: ${JSON.stringify(result.error.issues)}`,
        );
      }
    }
  });

  it("has no duplicate citySlug", () => {
    const slugs = GEO_SOURCE_INVENTORIES.map((inv) => inv.citySlug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  // ─── Anti-invention : vérifications spécifiques ───────────────────────────

  it("does NOT claim geojson zonage for Salaberry-de-Valleyfield (feuillets PDF only)", () => {
    const vf = getGeoSourceInventory("salaberry-de-valleyfield");
    expect(vf).toBeDefined();
    // Le plan de zonage de Valleyfield est scanné PDF — aucun vecteur open-data trouvé.
    expect(vf!.zonage.quality).not.toBe("geojson");
    expect(vf!.zonage.availability).toBe("pdf");
  });

  it("has geojson lots for Salaberry-de-Valleyfield via cadastre allégé MRNF", () => {
    const vf = getGeoSourceInventory("salaberry-de-valleyfield");
    expect(vf).toBeDefined();
    expect(vf!.lots.quality).toBe("geojson");
    expect(vf!.lots.availability).toBe("donnees-quebec");
    expect(vf!.lots.url).toContain("Cadastre_allege");
  });

  it("marks non-investigated cities as unknown for zonage", () => {
    const nonInvestigated = [
      "beauharnois",
      "sainte-catherine",
      "delson",
      "saint-constant",
      "saint-damase",
    ];
    for (const slug of nonInvestigated) {
      const inv = getGeoSourceInventory(slug);
      expect(inv, `missing entry for ${slug}`).toBeDefined();
      expect(
        inv!.zonage.availability,
        `${slug} zonage should be unknown`,
      ).toBe("unknown");
    }
  });

  it("grants geojson lots for all 6 cities via province-wide cadastre allégé", () => {
    for (const inv of GEO_SOURCE_INVENTORIES) {
      expect(
        inv.lots.quality,
        `${inv.citySlug} lots quality should be geojson`,
      ).toBe("geojson");
    }
  });
});

// ─── getGeoSourceInventory helper ─────────────────────────────────────────────

describe("getGeoSourceInventory()", () => {
  it("returns the inventory for a known city", () => {
    const inv = getGeoSourceInventory("salaberry-de-valleyfield");
    expect(inv).toBeDefined();
    expect(inv!.citySlug).toBe("salaberry-de-valleyfield");
  });

  it("returns undefined for an unknown city", () => {
    expect(getGeoSourceInventory("saint-inconnu")).toBeUndefined();
  });
});

// ─── prioritizeForGeoVertical helper ─────────────────────────────────────────

describe("prioritizeForGeoVertical()", () => {
  const refDate = "2026-06-10";

  it("returns same count as input inventories", () => {
    const result = prioritizeForGeoVertical(
      GEO_SOURCE_INVENTORIES,
      [],
      refDate,
    );
    expect(result).toHaveLength(GEO_SOURCE_INVENTORIES.length);
  });

  it("places geojson-lots cities ahead of no-lots cities", () => {
    const inventories = [
      {
        citySlug: "city-no-lots",
        zonage: { availability: "pdf" as const, quality: "pdf" as const },
        lots: { availability: "none" as const, quality: "none" as const },
      },
      {
        citySlug: "city-geojson-lots",
        zonage: { availability: "unknown" as const, quality: "none" as const },
        lots: {
          availability: "donnees-quebec" as const,
          quality: "geojson" as const,
        },
      },
    ];
    const result = prioritizeForGeoVertical(inventories, [], refDate);
    expect(result[0]!.inventory.citySlug).toBe("city-geojson-lots");
    expect(result[1]!.inventory.citySlug).toBe("city-no-lots");
  });

  it("uses recent signals (≤6 months) as a tie-breaker between equal lot quality", () => {
    const inventories = [
      {
        citySlug: "city-a",
        zonage: { availability: "unknown" as const, quality: "none" as const },
        lots: {
          availability: "donnees-quebec" as const,
          quality: "geojson" as const,
        },
      },
      {
        citySlug: "city-b",
        zonage: { availability: "unknown" as const, quality: "none" as const },
        lots: {
          availability: "donnees-quebec" as const,
          quality: "geojson" as const,
        },
      },
    ];
    const signals = [
      { citySlug: "city-a", detectedAt: "2026-05-01" }, // within 6 months
      { citySlug: "city-a", detectedAt: "2026-04-01" }, // within 6 months
      // city-b has no signals
    ];
    const result = prioritizeForGeoVertical(inventories, signals, refDate);
    expect(result[0]!.inventory.citySlug).toBe("city-a");
    expect(result[0]!.recentSignalCount).toBe(2);
    expect(result[1]!.recentSignalCount).toBe(0);
  });

  it("ignores signals older than 6 months", () => {
    const inventories = [
      {
        citySlug: "city-a",
        zonage: { availability: "unknown" as const, quality: "none" as const },
        lots: {
          availability: "donnees-quebec" as const,
          quality: "geojson" as const,
        },
      },
    ];
    const signals = [
      { citySlug: "city-a", detectedAt: "2025-01-01" }, // older than 6 months
    ];
    const result = prioritizeForGeoVertical(inventories, signals, refDate);
    expect(result[0]!.recentSignalCount).toBe(0);
  });

  it("breaks equal lot+signal tie with zonage quality", () => {
    const inventories = [
      {
        citySlug: "city-pdf-zonage",
        zonage: { availability: "pdf" as const, quality: "pdf" as const },
        lots: {
          availability: "donnees-quebec" as const,
          quality: "geojson" as const,
        },
      },
      {
        citySlug: "city-no-zonage",
        zonage: { availability: "none" as const, quality: "none" as const },
        lots: {
          availability: "donnees-quebec" as const,
          quality: "geojson" as const,
        },
      },
    ];
    const result = prioritizeForGeoVertical(inventories, [], refDate);
    // pdf (score 1) > none (score 0) → city-pdf-zonage wins
    expect(result[0]!.inventory.citySlug).toBe("city-pdf-zonage");
  });

  it("with real dataset, all 6 cities come back and Valleyfield ranks first (lots+zonage > unknown)", () => {
    const result = prioritizeForGeoVertical(
      GEO_SOURCE_INVENTORIES,
      [],
      refDate,
    );
    expect(result).toHaveLength(6);
    // Valleyfield has lots=geojson + zonage=pdf; Beauharnois has lots=geojson + zonage=unknown
    // → Valleyfield should rank before Beauharnois
    const vfIdx = result.findIndex(
      (e) => e.inventory.citySlug === "salaberry-de-valleyfield",
    );
    const beauIdx = result.findIndex(
      (e) => e.inventory.citySlug === "beauharnois",
    );
    expect(vfIdx).toBeLessThan(beauIdx);
  });
});
