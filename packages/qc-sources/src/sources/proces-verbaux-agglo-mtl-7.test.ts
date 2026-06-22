/**
 * Lot cities-round7 -- 49 villes CONFIG-ONLY (S3-first).
 * URLs d'index verifiees en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["salaberry-de-valleyfield", "saint-marc-des-carrieres", "disraeli--les-appalaches", "trois-rives", "scotstown", "lac-des-ecorces", "stratford", "saint-jean-de-brebeuf", "chute-saint-philippe", "inverness", "saint-gilbert", "saint-aime-du-lac-des-iles", "chartierville", "lac-sainte-marie", "portneuf", "sainte-croix", "low", "laurier-station", "thetford-mines", "kinnears-mills", "dosquet", "notre-dame-du-sacre-coeur-dissoudun", "cap-sante", "donnacona", "saint-jacques-de-leeds", "val-racine", "saint-romain", "la-peche", "saint-basile", "mont-laurier", "notre-dame-des-bois", "gracefield", "lambton", "sainte-therese-de-la-gatineau", "mont-saint-michel", "bouchette", "adstock", "saint-leonard-de-portneuf", "nantes", "riviere-a-pierre", "deleage", "kazabazua", "saint-agapit", "saint-apollinaire", "saint-pierre-de-broughton", "neuville", "saint-gilles", "pont-rouge", "marston"];
describe("Lot cities-round7 -- cablage config-only", () => {
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
  it("49 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(49); });
});
