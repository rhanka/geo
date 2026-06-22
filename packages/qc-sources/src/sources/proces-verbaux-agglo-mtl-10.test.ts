/**
 * Lot cities-round10 -- 20 villes CONFIG-ONLY (S3-first).
 * URLs d'index verifiees en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["waltham", "armagh", "berthier-sur-mer", "sainte-sabine--les-etchemins", "saint-ferreol-les-neiges", "montmagny", "saint-tite-des-caps", "notre-dame-du-rosaire", "saint-antoine-de-lisle-aux-grues", "saint-just-de-bretenieres", "saint-fabien-de-panet", "cap-saint-ignace", "petite-riviere-saint-francois", "sainte-lucie-de-beauregard", "lislet", "baie-saint-paul", "saint-jean-port-joli", "saint-aubert", "lisle-aux-coudres", "sainte-felicite--lislet"];
describe("Lot cities-round10 -- cablage config-only", () => {
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
  it("20 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(20); });
});
