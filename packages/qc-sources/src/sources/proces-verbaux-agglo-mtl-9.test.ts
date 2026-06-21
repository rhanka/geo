/**
 * Lot cities-round9 -- 34 villes CONFIG-ONLY (S3-first).
 * URLs d'index verifiees en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["saint-henri", "litchfield", "campbells-bay", "saint-robert-bellarmin", "frampton", "lac-beauport", "sainte-petronille", "portage-du-fort", "sainte-claire", "boischatel", "saint-odilon-de-cranbourne", "lile-du-grand-calumet", "saint-philibert", "saint-come-liniere", "stoneham-et-tewkesbury", "saint-charles-de-bellechasse", "saint-benjamin", "lange-gardien--la-cote-de-beaupre", "saint-laurent-de-lile-dorleans", "saint-theophile", "sainte-brigitte-de-laval", "saint-lazare-de-bellechasse", "saint-leon-de-standon", "saint-nazaire-de-dorchester", "lac-edouard", "la-durantaye", "chateau-richer", "lac-etchemin", "saint-damien-de-buckland", "saint-neree-de-bellechasse", "saint-zacharie", "sainte-rose-de-watford", "sainte-aurelie", "saint-raphael"];
describe("Lot cities-round9 -- cablage config-only", () => {
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
  it("34 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(34); });
});
