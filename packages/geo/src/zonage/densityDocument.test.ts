import { describe, expect, it } from "vitest";

import {
  parseChamplainDensityDocument,
  parseLacDesEcorcesDensityDocument,
  parseMontLaurierZonesHDensityDocument,
} from "./densityDocument.js";

const header = [
  "VILLE DE MONT-LAURIER",
  "GRILLE DES USAGES ET NORMES PAR ZONE",
  "ANNEXÉE AU RÈGLEMENT DE ZONAGE NUMÉRO: 134",
].join("\n");

describe("parseMontLaurierZonesHDensityDocument", () => {
  it("publishes a zone maximum when every printed use column agrees", () => {
    const parsed = parseMontLaurierZonesHDensityDocument([
      header,
      "ZONE: H-453",
      "Logement / Hectare maximum       25   25   25   25   25",
    ].join("\n"));

    expect(parsed).toMatchObject({
      documentAnchored: true,
      projectExcluded: false,
      refusals: [],
      norms: [{
        zoneCode: "H-453",
        value: 25,
        unit: "log/ha",
        raw: "25 | 25 | 25 | 25 | 25",
        page: 1,
      }],
    });
    expect(parsed.norms[0]?.proof).toContain("Logement / Hectare maximum");
  });

  it("refuses to choose among divergent use-class columns", () => {
    const parsed = parseMontLaurierZonesHDensityDocument([
      header,
      "ZONE: H-453",
      "Logement / Hectare maximum       25   30",
    ].join("\n"));

    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals).toEqual([expect.objectContaining({
      zoneCode: "H-453",
      reason: "valeurs-divergentes-entre-colonnes-usages",
    })]);
  });

  it("refuses a density row that has no zone on its page", () => {
    const parsed = parseMontLaurierZonesHDensityDocument([
      header,
      "Logement / Hectare maximum       25",
    ].join("\n"));

    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason).toBe("zone-absente-sur-la-page");
  });

  it("excludes a project document even when its cells look complete", () => {
    const parsed = parseMontLaurierZonesHDensityDocument([
      header,
      "PREMIER PROJET DE RÈGLEMENT",
      "ZONE: H-453",
      "Logement / Hectare maximum       25",
    ].join("\n"));

    expect(parsed.projectExcluded).toBe(true);
    expect(parsed.norms).toEqual([]);
  });
});

describe("parseChamplainDensityDocument", () => {
  it("keeps only the printed maximum and not the following façade width", () => {
    const parsed = parseChamplainDensityDocument([
      "MUNICIPALITÉ DE CHAMPLAIN",
      "RÈGLEMENT DE ZONAGE",
      "GRILLE DE SPÉCIFICATIONS ZONE : 120 COMMERCIALE ET RÉSIDENTIELLE",
      "Nombre maximum de logements 4 Largeur minimale de la façade 6m",
    ].join("\n"));

    expect(parsed.norms).toEqual([expect.objectContaining({
      zoneCode: "120",
      value: 4,
      unit: "logements/batiment",
      raw: "4",
    })]);
  });

  it("does not publish an empty maximum row", () => {
    const parsed = parseChamplainDensityDocument([
      "MUNICIPALITÉ DE CHAMPLAIN",
      "RÈGLEMENT DE ZONAGE",
      "GRILLE DE SPÉCIFICATIONS ZONE : 102 RÉSIDENTIELLE",
      "Nombre maximum de logements Largeur minimale de la façade 6m",
    ].join("\n"));
    expect(parsed.norms).toEqual([]);
  });
});

describe("parseLacDesEcorcesDensityDocument", () => {
  it("maps each native text column to its printed zone and ignores footnotes", () => {
    const parsed = parseLacDesEcorcesDensityDocument([
      "MUNICIPALITÉ DE LAC-DES-ÉCORCES",
      "Grille des spécifications",
      "                                                     ZONES",
      "                                      A-01    A-02    A-03    A-04",
      "Nombre de logements maximum             1       --      20      3 (7)",
    ].join("\n"));

    expect(parsed.norms).toEqual([
      expect.objectContaining({ zoneCode: "A-01", value: 1 }),
      expect.objectContaining({ zoneCode: "A-03", value: 20 }),
      expect.objectContaining({ zoneCode: "A-04", value: 3 }),
    ]);
  });

  it("refuses the entire document when its title says project", () => {
    const parsed = parseLacDesEcorcesDensityDocument([
      "MUNICIPALITÉ DE LAC-DES-ÉCORCES",
      "PREMIER PROJET DE RÈGLEMENT",
      "Grille des spécifications",
      "ZONES",
      "A-01",
      "Nombre de logements maximum 1",
    ].join("\n"));
    expect(parsed.projectExcluded).toBe(true);
    expect(parsed.norms).toEqual([]);
  });
});
