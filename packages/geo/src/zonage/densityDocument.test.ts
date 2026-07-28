import { describe, expect, it } from "vitest";

import {
  parseChamplainDensityDocument,
  parseChestervilleDensityDocument,
  parseDrummondvilleDensityDocument,
  parseHuberdeauDensityDocument,
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

  it("rejoins split zone prefixes and numbers without turning dashes into zero", () => {
    const parsed = parseLacDesEcorcesDensityDocument([
      "MUNICIPALITÉ DE LAC-DES-ÉCORCES",
      "Grille des spécifications",
      "                                                                 ZONES",
      "                                  COM-    COM-    COM-    COM-    COM-    COM-",
      "                                   01      02      03      04      05      06",
      "Nombre de logements maximum        --      20      --      20      3       20",
    ].join("\n"));

    expect(parsed.norms.map(({ zoneCode, value }) => ({ zoneCode, value }))).toEqual([
      { zoneCode: "COM-02", value: 20 },
      { zoneCode: "COM-04", value: 20 },
      { zoneCode: "COM-05", value: 3 },
      { zoneCode: "COM-06", value: 20 },
    ]);
  });

  it("collects an accented zone header split across two rows", () => {
    const parsed = parseLacDesEcorcesDensityDocument([
      "MUNICIPALITÉ DE LAC-DES-ÉCORCES",
      "Grille des spécifications",
      "                                                                                                                                 ZONES",
      "    CLASSES D’USAGES                             CATÉGORIE ET SOUS-CATÉGORIE D’USAGES                                                          RÉS-27",
      "                                                                                                  RÉS-23      RÉS-24     RÉS-25     RÉS-26",
      "                                   Nombre de logements maximum                                        3          3          3            1      8 (4)",
    ].join("\n"));

    expect(parsed.norms.map(({ zoneCode, value }) => ({ zoneCode, value }))).toEqual([
      { zoneCode: "RES-23", value: 3 },
      { zoneCode: "RES-24", value: 3 },
      { zoneCode: "RES-25", value: 3 },
      { zoneCode: "RES-26", value: 1 },
      { zoneCode: "RES-27", value: 8 },
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

describe("parseChestervilleDensityDocument", () => {
  const chestervilleHeader = [
    "Municipalité de Chesterville",
    "Grille des usages et normes",
  ].join("\n");

  it("publishes only when every printed class has one identical fixed value", () => {
    const parsed = parseChestervilleDensityDocument([
      chestervilleHeader,
      "Zone V1",
      "Nombre de logement par bâtiment 1/1 1/1",
    ].join("\n"));
    expect(parsed.norms).toEqual([expect.objectContaining({
      zoneCode: "V1",
      value: 1,
      unit: "logements/batiment",
      raw: "1/1 | 1/1",
    })]);
  });

  it("refuses ranges, divergent classes, and incomplete PDF operators", () => {
    const parsed = parseChestervilleDensityDocument([
      chestervilleHeader,
      "Zone H1",
      "Nombre de logement par bâtiment 1/1 2/3 4/",
    ].join("\n"));
    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason).toBe("plage-logements-incomplete");
  });

  it("does not let a scalar continuation page override a divergent zone sheet", () => {
    const parsed = parseChestervilleDensityDocument([
      chestervilleHeader,
      "Zone C5",
      "Nombre de logement par bâtiment 1/1 2/3 4/9",
      "\f",
      "Zone C5",
      "Nombre de logement par bâtiment 1/1",
    ].join("\n"));
    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.zoneCode).toBe("C5");
  });

  it("does not scalarize a partial amendment sheet", () => {
    const parsed = parseChestervilleDensityDocument([
      "Municipalité de Chesterville",
      "RÈGLEMENT N° 187",
      "Amendant le règlement de zonage n° 145",
      "Zone C1",
      "Nombre de logement par bâtiment 1/1",
    ].join("\n"));
    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason)
      .toBe("amendement-partiel-ne-prouve-pas-une-densite-de-zone");
  });
});

describe("parseDrummondvilleDensityDocument", () => {
  const drummondvilleHeader = [
    "Ville de Drummondville Chapitre 13",
    "Règlement de zonage No 4300",
  ].join("\n");

  it("uses the closest preceding zone heading on each page", () => {
    const parsed = parseDrummondvilleDensityDocument([
      drummondvilleHeader,
      "ZONE H-474",
      "ARTICLE 1335 GÉNÉRALITÉ",
      "ZONE D’HABITATION H-475",
      "ARTICLE 1336.04 NOMBRE DE LOGEMENTS PAR TERRAIN",
      "Le nombre de logements par terrain maximal est établi à 105",
      "\f",
      "ZONE H-735",
      "ZONE H-750",
      "c) nombre de logements/bâtiment maximal : 8",
    ].join("\n"));
    expect(parsed.norms).toEqual([
      expect.objectContaining({
        zoneCode: "H-475",
        value: 105,
        unit: "logements/terrain",
      }),
      expect.objectContaining({
        zoneCode: "H-750",
        value: 8,
        unit: "logements/batiment",
      }),
    ]);
  });
});

describe("parseHuberdeauDensityDocument", () => {
  it("keeps conditional municipality-wide density as a refusal, not a zone norm", () => {
    const parsed = parseHuberdeauDensityDocument([
      "MUNICIPALITÉ D’HUBERDEAU",
      "RÈGLEMENT DE ZONAGE NUMÉRO 199-02",
      "9.8.9 Densité brute",
      "Le nombre de logements à l’hectare brut ne doit pas excéder 3.3 dans le cas d’un lot",
    ].join("\n"));
    expect(parsed.documentAnchored).toBe(true);
    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason).toBe("densite-conditionnelle-sans-code-zone");
  });
});
