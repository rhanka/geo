/**
 * Lot cities-round4 -- 54 villes CONFIG-ONLY (S3-first).
 * URLs d'index verifiees en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["sainte-clotilde-de-horton", "cleveland", "sainte-seraphine", "lac-tremblant-nord", "saint-francois-xavier-de-brompton", "ogden", "cheneville", "saint-etienne-des-gres", "kingsey-falls", "saint-elie-de-caxton", "saint-wenceslas", "sainte-catherine-de-hatley", "windsor", "sainte-elizabeth-de-warwick", "sainte-eulalie", "ayers-cliff", "danville", "labelle", "val-joli", "sherbrooke", "saint-albert", "ripon", "stanstead--memphremagog--2", "saint-boniface", "saint-claude", "aston-jonction", "stanstead-est", "saint-sixte", "hatley-township-municipality", "val-des-sources", "becancour", "notre-dame-du-mont-carmel", "saint-valere", "thurso", "warwick", "saint-sylvere", "tingwick", "barnston-ouest", "hatley", "saint-maurice", "la-minerve", "shawinigan", "waterville", "lochaber-partie-ouest", "daveluyville", "maddington-falls", "mayo", "victoriaville", "stoke", "champlain", "saint-rosaire", "duhamel", "coaticook", "compton"];
describe("Lot cities-round4 -- cablage config-only", () => {
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
  it("54 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(54); });
});
