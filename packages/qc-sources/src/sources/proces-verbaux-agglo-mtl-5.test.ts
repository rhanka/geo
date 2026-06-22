/**
 * Lot cities-round5 -- 76 villes CONFIG-ONLY (S3-first).
 * URLs d'index verifiees en live HTTP 200 le 2026-06-11 ; preuve par ville en PR.
 */
import { describe, expect, it } from "vitest";
import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";
const EXPECTED = ["mont-tremblant", "montebello", "saint-lucien", "melbourne", "amherst", "kingsbury", "saint-felix-de-kingsey", "saint-alexis-des-monts", "grand-saint-esprit", "richmond", "saint-barnabe", "magog", "lac-superieur", "notre-dame-de-la-paix", "saint-leonard-daston", "stanstead--memphremagog", "charette", "saint-denis-de-brompton", "saint-christophe-darthabaska", "saint-camille", "chesterville", "lange-gardien--les-collines-de-loutaouais", "westbury", "cookshire-eaton", "east-angus", "martinville", "herouxville", "sainte-genevieve-de-batiscan", "princeville", "dixville", "sainte-edwidge-de-clifton", "notre-dame-de-ham", "lascension", "sainte-cecile-de-levrard", "nominingue", "saint-stanislas--des-chenaux", "saint-severin--mekinac", "dudswell", "riviere-rouge", "ham-nord", "sainte-helene-de-chester", "ham-sud", "notre-dame-de-la-salette", "val-des-bois", "saint-prosper-de-champlain", "plessisville", "sainte-sophie-dhalifax", "saint-fortunat", "sainte-anne-de-la-perade", "deschaillons-sur-saint-laurent", "fortierville", "parisville", "sainte-francoise--becancour", "saint-adelphe", "saints-martyrs-canadiens", "gatineau", "bury", "saint-isidore-de-clifton", "saint-malo", "val-des-monts", "newport", "east-hereford", "weedon", "lac-saguay", "saint-julien", "saint-venant-de-paquette", "saint-jacques-le-majeur-de-wolfestown", "sainte-thecle", "saint-casimir", "kiamika", "leclercville", "cantley", "denholm", "val-alain", "lac-du-cerf", "saint-mathieu-du-parc"];
describe("Lot cities-round5 -- cablage config-only", () => {
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
  it("76 villes uniques", () => { expect(new Set(EXPECTED).size).toBe(76); });
});
