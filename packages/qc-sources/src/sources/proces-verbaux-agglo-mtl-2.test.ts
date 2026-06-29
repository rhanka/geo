/**
 * Lot « agglo-mtl-2 » (round 1) — 70 villes CONFIG-ONLY (S3-first).
 *
 * Aucune fixture : chaque ville = un PvCityConfig + une entrée { config } dans
 * ALL_PV_CITIES. URLs d'index vérifiées en live HTTP 200 le 2026-06-11 ; preuve
 * par ville (PV à couche texte + robots) dans la description de PR. Ce test
 * verrouille le câblage (présence + forme config-only).
 */

import { describe, expect, it } from "vitest";

import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";

const EXPECTED = ["saint-lambert", "longueuil", "saint-philippe", "saint-mathieu", "bois-des-filion", "beaconsfield", "lery", "saint-mathias-sur-richelieu", "saint-mathieu-de-beloeil", "saint-amable", "otterburn-park", "richelieu", "baie-durfe", "sainte-marthe-sur-le-lac", "saint-jean-sur-richelieu", "notre-dame-de-lile-perrot", "saint-michel", "blainville", "senneville", "lile-perrot", "vercheres", "saint-marc-sur-richelieu", "sainte-anne-des-plaines", "saint-urbain-premier", "terrasse-vaudreuil", "saint-joseph-du-lac", "saint-jean-baptiste", "calixa-lavallee", "lile-cadieux", "pointe-des-cascades", "saint-charles-sur-richelieu", "vaudreuil-sur-le-lac", "saint-blaise-sur-richelieu", "mont-saint-gregoire", "saint-patrice-de-sherrington", "saint-roch-de-lachigan", "sainte-angele-de-monnoir", "lepiphanie", "sainte-clotilde", "rougemont", "saint-roch-ouest", "saint-sulpice", "saint-lin-laurentides", "la-presentation", "sainte-brigide-diberville", "saint-esprit", "sainte-sophie", "hudson", "saint-chrysostome", "saint-cesaire", "saint-paul-de-lile-aux-noix", "saint-louis-de-gonzague--beauharnois-salaberry", "saint-alexis", "contrecoeur", "saint-jerome", "saint-jacques", "saint-colomban", "saint-hyacinthe", "lacolle", "saint-sebastien--le-haut-richelieu", "saint-paul", "saint-pie", "havelock", "sainte-sabine--brome-missisquoi", "saint-bernard-de-michaudville", "sainte-julienne", "farnham", "saint-paul-dabbotsford", "saint-roch-de-richelieu", "saint-jude"];

describe("Lot agglo-mtl-2 — câblage config-only (round 1)", () => {
  const bySlug = new Map(ALL_PV_CITIES.map((c) => [c.config.citySlug, c]));
  for (const slug of EXPECTED) {
    it(`${slug}: entrée config-only valide`, () => {
      const entry = bySlug.get(slug);
      expect(entry, `${slug} absent de ALL_PV_CITIES`).toBeDefined();
      if (!entry) return;
      expect(entry.config.sourceId).toBe(`proces-verbaux-${slug}`);
      expect(entry.config.pvIndexUrl).toMatch(/^https?:\/\/.+/);
      expect(entry.pvText).toBeUndefined();
    });
  }
  it("70 villes uniques", () => {
    expect(new Set(EXPECTED).size).toBe(70);
  });
});
