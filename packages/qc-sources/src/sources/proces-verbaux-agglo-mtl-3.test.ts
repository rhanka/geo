/**
 * Lot « agglo-mtl-3 » (round 2) — 71 villes CONFIG-ONLY (S3-first).
 * URLs d'index vérifiées en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["saint-ours", "prevost", "saint-stanislas-de-kostka", "saint-barnabe-sud", "franklin", "saint-hippolyte", "venise-en-quebec", "clarenceville", "joliette", "saint-dominique", "pike-river", "rigaud", "lanoraie", "sainte-anne-des-lacs", "saint-andre-dargenteuil", "lachute", "saint-louis", "saint-simon", "saint-thomas", "gore", "saint-charles-borromee", "piedmont", "saint-zotique", "bedford--brome-missisquoi", "notre-dame-des-prairies", "pointe-fortune", "saint-polycarpe", "rawdon", "tres-saint-redempteur", "saint-sauveur", "sainte-cecile-de-milton", "saint-ambroise-de-kildare", "granby", "saint-hugues", "hinchinbrooke", "saint-marcel-de-richelieu", "brigham", "huntingdon", "saint-valerien-de-milton", "stanbridge-east", "saint-armand", "riviere-beaudette", "notre-dame-de-lourdes--joliette", "sainte-adele", "saint-aime", "sainte-justine-de-newton", "sainte-marcelline-de-kildare", "saint-telesphore", "wentworth", "esterel", "cowansville", "godmanchester", "upton", "brownsburg-chatham", "berthierville", "sainte-anne-de-sorel", "sainte-melanie", "bromont", "roxton-pond", "sainte-marguerite-du-lac-masson", "chertsey", "val-morin", "saint-guillaume", "saint-david", "elgin", "saint-anicet", "saint-eugene", "saint-felix-de-valois", "yamaska", "saint-alphonse-rodriguez", "saint-norbert"];
describe("Lot agglo-mtl-3 — câblage config-only (round 2)", () => {
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
  it("71 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(71); });
});
