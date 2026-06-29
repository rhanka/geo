/**
 * Lot « agglo-mtl » — 14 villes les plus proches de Montréal (≤25 km).
 *
 * CONFIG-ONLY (contrat S3-first du principal) : aucune fixture, aucun pvText.
 * Chaque ville = un PvCityConfig + une entrée { config } dans ALL_PV_CITIES.
 * Le worker de production fetch la ville en live et écrit le raw sur S3 (CAS).
 *
 * Preuve anti-invention (rules/MASTER.md) : les URLs d'index ci-dessous ont été
 * vérifiées en live HTTP 200 le 2026-06-11 ; le détail par ville (lien PV à
 * couche texte confirmée via pdftotext, robots.txt) est dans la description de
 * la PR. Ce test verrouille uniquement le CÂBLAGE (présence + forme config-only).
 *
 * NB retraits honnêtes du repérage initial :
 *   - longueuil : le PV repéré était une Commission d'agglomération (CARPA), pas
 *     le conseil municipal → à refaire avec le vrai PV du conseil.
 *   - saint-lambert : pas d'URL d'index stable (pages d'événement datées) → à
 *     refaire une fois l'index de séances localisé.
 */

import { describe, expect, it } from "vitest";

import { ALL_PV_CITIES } from "./proces-verbaux-generic.js";

const EXPECTED = [
  "westmount", "mont-royal", "hampstead", "montreal-ouest", "cote-saint-luc",
  "montreal-est", "dorval", "dollard-des-ormeaux", "pointe-claire",
  "brossard", "saint-bruno-de-montarville",
  "carignan", "saint-basile-le-grand", "chambly",
];

describe("Lot agglo-mtl — câblage config-only dans ALL_PV_CITIES", () => {
  const bySlug = new Map(ALL_PV_CITIES.map((c) => [c.config.citySlug, c]));

  for (const slug of EXPECTED) {
    it(`${slug}: entrée config-only valide (sourceId + pvIndexUrl https, pas de pvText)`, () => {
      const entry = bySlug.get(slug);
      expect(entry, `${slug} absent de ALL_PV_CITIES`).toBeDefined();
      expect(entry!.config.sourceId).toBe(`proces-verbaux-${slug}`);
      expect(entry!.config.pvIndexUrl).toMatch(/^https:\/\/.+/);
      // CONFIG-ONLY : pas de fixture embarquée.
      expect(entry!.pvText).toBeUndefined();
      expect(entry!.sourceUrl).toBeUndefined();
    });
  }

  it("les 14 villes du lot sont uniques et présentes", () => {
    const slugs = new Set(EXPECTED);
    expect(slugs.size).toBe(14);
    const wired = EXPECTED.filter((s) => bySlug.has(s));
    expect(wired.length).toBe(14);
  });
});
