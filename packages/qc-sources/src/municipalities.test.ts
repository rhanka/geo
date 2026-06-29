import { describe, it, expect } from "vitest";
import { QC_MUNICIPALITIES, prioritizedCities } from "./municipalities.js";
import { Municipality } from "./domain.js";

describe("QC_MUNICIPALITIES dataset", () => {
  it("contains 1 106 municipalities", () => {
    expect(QC_MUNICIPALITIES).toHaveLength(1106);
  });

  it("has Montréal excluded", () => {
    const mtl = QC_MUNICIPALITIES.find((m) => m.slug === "montreal");
    expect(mtl).toBeDefined();
    expect(mtl!.excluded).toBe(true);
    expect(mtl!.excludedReason).toBe("pilot-city-montreal");
    expect(mtl!.priorityRank).toBeNull();
  });

  it("has Laval excluded", () => {
    const laval = QC_MUNICIPALITIES.find((m) => m.slug === "laval");
    expect(laval).toBeDefined();
    expect(laval!.excluded).toBe(true);
    expect(laval!.excludedReason).toBe("pilot-city-laval");
    expect(laval!.priorityRank).toBeNull();
  });

  it("has non-excluded entries sorted by distanceToMtlKm ascending", () => {
    const active = QC_MUNICIPALITIES.filter((m) => !m.excluded);
    for (let i = 1; i < active.length; i++) {
      expect(active[i]!.distanceToMtlKm).toBeGreaterThanOrEqual(
        active[i - 1]!.distanceToMtlKm
      );
    }
  });

  it("has priorityRank 1 assigned to Westmount (closest to MTL)", () => {
    const rank1 = QC_MUNICIPALITIES.find((m) => m.priorityRank === 1);
    expect(rank1).toBeDefined();
    expect(rank1!.slug).toBe("westmount");
  });

  it("marks Longueuil as deprioritized (pop > 100 000)", () => {
    const longueuil = QC_MUNICIPALITIES.find((m) => m.slug === "longueuil");
    expect(longueuil).toBeDefined();
    expect(longueuil!.deprioritized).toBe(true);
    expect(longueuil!.excluded).toBe(false);
    expect(longueuil!.priorityRank).not.toBeNull();
  });

  it("has no duplicate slugs", () => {
    const slugs = QC_MUNICIPALITIES.map((m) => m.slug);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });

  it("has all entries valid against Municipality schema", () => {
    for (const m of QC_MUNICIPALITIES) {
      const result = Municipality.safeParse(m);
      if (!result.success) {
        throw new Error(
          `Schema validation failed for ${m.slug}: ${JSON.stringify(result.error.issues)}`
        );
      }
    }
  });

  it("has Salaberry-de-Valleyfield with correct coordinates", () => {
    const vf = QC_MUNICIPALITIES.find(
      (m) => m.slug === "salaberry-de-valleyfield"
    );
    expect(vf).toBeDefined();
    // GeoNames centroid (id=8673897): 45.2651, -74.06482
    expect(vf!.lat).toBeCloseTo(45.2651, 2);
    expect(vf!.lon).toBeCloseTo(-74.06482, 2);
    expect(vf!.mrc).toBe("Beauharnois-Salaberry");
    expect(vf!.excluded).toBe(false);
    expect(vf!.deprioritized).toBe(false);
  });
});

describe("prioritizedCities()", () => {
  it("excludes Montréal and Laval from results", () => {
    const cities = prioritizedCities();
    expect(cities.find((m) => m.slug === "montreal")).toBeUndefined();
    expect(cities.find((m) => m.slug === "laval")).toBeUndefined();
  });

  it("excludes deprioritized cities by default", () => {
    const cities = prioritizedCities();
    const deprioCities = cities.filter((m) => m.deprioritized);
    expect(deprioCities).toHaveLength(0);
  });

  it("includes deprioritized cities when includeLargePop=true", () => {
    const cities = prioritizedCities({ includeLargePop: true });
    const longueuil = cities.find((m) => m.slug === "longueuil");
    expect(longueuil).toBeDefined();
    expect(longueuil!.deprioritized).toBe(true);
  });

  it("respects maxKm filter", () => {
    const cities = prioritizedCities({ maxKm: 20 });
    expect(cities.length).toBeGreaterThan(0);
    for (const c of cities) {
      expect(c.distanceToMtlKm).toBeLessThanOrEqual(20);
    }
  });

  it("returns results sorted by distanceToMtlKm ascending", () => {
    const cities = prioritizedCities({ maxKm: 100 });
    for (let i = 1; i < cities.length; i++) {
      expect(cities[i]!.distanceToMtlKm).toBeGreaterThanOrEqual(
        cities[i - 1]!.distanceToMtlKm
      );
    }
  });

  it("returns a proper subset of the full dataset", () => {
    const all = prioritizedCities({ maxKm: 500, includeLargePop: true });
    expect(all.length).toBeLessThan(QC_MUNICIPALITIES.length);
    // Should not include excluded municipalities
    expect(all.find((m) => m.excluded)).toBeUndefined();
  });

  it("includes Salaberry-de-Valleyfield in a 100 km radius", () => {
    const cities = prioritizedCities({ maxKm: 100 });
    expect(cities.find((m) => m.slug === "salaberry-de-valleyfield")).toBeDefined();
  });

  it("includes Salaberry-de-Valleyfield in a 50 km radius (GeoNames centroid ≈ 47 km)", () => {
    // GeoNames centroid distance = 46.93 km — within 50 km radius
    const cities = prioritizedCities({ maxKm: 50 });
    expect(cities.find((m) => m.slug === "salaberry-de-valleyfield")).toBeDefined();
  });

  it("does not include Salaberry-de-Valleyfield in a 40 km radius", () => {
    // GeoNames centroid distance = 46.93 km — outside 40 km radius
    const cities = prioritizedCities({ maxKm: 40 });
    expect(cities.find((m) => m.slug === "salaberry-de-valleyfield")).toBeUndefined();
  });
});
