/**
 * Lot cities-round8 -- 27 villes CONFIG-ONLY (S3-first).
 * URLs d'index verifiees en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["egan-sud", "lac-drolet", "fossambault-sur-le-lac", "saint-bernard", "frontenac", "lac-saint-joseph", "saint-elzear--la-nouvelle-beauce", "bois-franc", "saint-victor", "saint-frederic", "cayamant", "shannon", "saint-honore-de-shenley", "scott", "lancienne-lorette", "sainte-marie", "saint-benoit-labre", "saint-ludger", "montcerf-lytton", "saint-gabriel-de-valcartier", "clarendon", "sainte-henedine", "saint-joseph-de-beauce", "saints-anges", "beauceville", "sainte-marguerite", "saint-georges"];
describe("Lot cities-round8 -- cablage config-only", () => {
  const bySlug = new Map(ALL_PV_CITIES.map((c) => [c.config.citySlug, c]));
  for (const slug of EXPECTED) {
    it(`${slug}: entree config-only valide`, () => {
      const entry = bySlug.get(slug);
      expect(entry, `${slug} absent`).toBeDefined();
      if (!entry) return;
      expect(entry.config.sourceId).toBe(`proces-verbaux-${slug}`);
      expect(entry.config.pvIndexUrl).toMatch(/^https?:\/\/.+/);
      expect(entry.pvText).toBeUndefined();
    });
  }
  it("27 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(27); });
});
