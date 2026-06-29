/**
 * Lot cities-round6 -- 21 villes CONFIG-ONLY (S3-first).
 * URLs d'index verifiees en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["courcelles-saint-evariste", "saint-sebastien--le-granit", "saint-patrice-de-beaurivage", "aumond", "sainte-clotilde-de-beauce", "lac-sergent", "east-broughton", "sacre-coeur-de-jesus", "blue-sea", "saint-narcisse-de-beaurivage", "sainte-anne-du-lac", "maniwaki", "messines", "la-guadeloupe", "saint-raymond", "ferme-neuve", "sainte-catherine-de-la-jacques-cartier", "alleyn-et-cawood", "saint-augustin-de-desmaures", "saint-augustin-de-woburn", "saint-ephrem-de-beauce"];
describe("Lot cities-round6 -- cablage config-only", () => {
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
  it("21 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(21); });
});
