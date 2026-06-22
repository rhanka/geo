/**
 * Lot « cities-round3 » — 78 villes CONFIG-ONLY (S3-first).
 * URLs d'index vérifiées en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["wentworth-nord", "val-david", "frelighsburg", "saint-nazaire-dacton", "saint-adolphe-dhoward", "saint-gerard-majella", "acton-vale", "shefford", "saint-cuthbert", "saint-theodore-dacton", "saint-joachim-de-shefford", "saint-cleophas-de-brandon", "roxton", "lac-des-seize-iles", "saint-jean-de-matha", "saint-francois-du-lac", "saint-barthelemy", "waterloo", "warden", "lac-brome", "saint-germain-de-grantham", "saint-pie-de-guire", "sainte-agathe-des-monts", "brome", "saint-come", "abercorn", "dundee", "grenville-sur-la-rouge", "wickham", "saint-gabriel-de-brandon", "pierreville", "montcalm", "maskinonge", "sutton", "notre-dame-de-la-merci", "sainte-christine", "sainte-anne-de-la-rochelle", "saint-gabriel", "stukely-sud", "lefebvre", "harrington", "bolton-ouest", "sainte-emelie-de-lenergie", "barkmere", "mont-blanc", "valcourt--le-val-saint-francois", "saint-didace", "lawrenceville", "saint-zephirin-de-courval", "sainte-ursule", "arundel", "louiseville", "saint-etienne-de-bolton", "saint-edouard-de-maskinonge", "baie-du-febvre", "valcourt--le-val-saint-francois--2", "maricourt", "drummondville", "eastman", "saint-cyrille-de-wendover", "bolton-est", "val-des-lacs", "lavenir", "sainte-brigitte-des-saults", "saint-leon-le-grand--maskinonge", "sainte-angele-de-premont", "saint-donat--matawinie", "potton", "ulverton", "racine", "brebeuf", "notre-dame-du-bon-conseil--drummond--2", "yamachiche", "austin", "sainte-perpetue--nicolet-yamaska", "orford", "sainte-monique--nicolet-yamaska", "nicolet"];
describe("Lot cities-round3 — câblage config-only", () => {
  const bySlug = new Map(ALL_PV_CITIES.map((c) => [c.config.citySlug, c]));
  for (const slug of EXPECTED) {
    it(`${slug}: entrée config-only valide`, () => {
      const entry = bySlug.get(slug);
      expect(entry, `${slug} absent`).toBeDefined();
      if (!entry) return;
      expect(entry.config.sourceId).toBe(`proces-verbaux-${slug}`);
      expect(entry.config.pvIndexUrl).toMatch(/^https?:\/\/.+/);
      expect(entry.pvText).toBeUndefined();
    });
  }
  it("78 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(78); });
});
