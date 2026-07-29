import { describe, expect, it } from "vitest";

import {
  parseAmosDensityDocument,
  parseChamplainDensityDocument,
  parseChestervilleDensityDocument,
  parseClermontDensityDocument,
  parseDrummondvilleDensityDocument,
  parseHuberdeauDensityDocument,
  parseLacDesEcorcesDensityDocument,
  parseMontLaurierZonesHDensityDocument,
  parseMontTremblantDensityDocument,
  parseMontTremblantPlanDensityDocument,
  parseNotreDameDeLourdesJolietteDensityDocument,
  parseSaintJeromeDensityDocument,
  parseTresSaintRedempteurDensityDocument,
  parseVarennesDensityDocument,
  parseVarennesPpuDensityDocument,
} from "./densityDocument.js";

describe("parseAmosDensityDocument", () => {
  const ownerAndPage = [
    "GRILLE DE SPECIFICATIONS ZONE P-1",
    "(1) Inclut le bâtiment principal et les bâtiments accessoires rattachés.",
  ].join("\n");

  it("publishes the verbatim COS when both use columns agree and the page is dated", () => {
    const parsed = parseAmosDensityDocument([
      ownerAndPage,
      "Coefficient d’occupation du sol maximum (%) 50(1) 50(1)",
      "Amendements No règlement Date adoption VA-1290 17 sept. 2024",
    ].join("\n"));

    expect(parsed).toMatchObject({
      documentAnchored: true,
      projectExcluded: false,
      refusals: [],
      norms: [{
        zoneCode: "P-1",
        value: 50,
        unit: "cos-max",
        raw: "50(1) 50(1)",
        page: 1,
      }],
    });
  });

  it("refuses an otherwise valid row when its own page is undated", () => {
    const parsed = parseAmosDensityDocument([
      ownerAndPage,
      "Coefficient d’occupation du sol maximum (%) 50(1) 50(1)",
    ].join("\n"));

    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason).toBe("date-amendement-absente-sur-la-page");
  });

  it("refuses divergent use columns instead of choosing one", () => {
    const parsed = parseAmosDensityDocument([
      ownerAndPage,
      "Coefficient d’occupation du sol maximum (%) 40(1) 50(1)",
      "VA-1290 17 sept. 2024",
    ].join("\n"));

    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason).toBe("maxima-divergents-entre-colonnes-usages");
  });

  it("excludes a project document", () => {
    const parsed = parseAmosDensityDocument([
      ownerAndPage,
      "PREMIER PROJET DE RÈGLEMENT",
      "Coefficient d’occupation du sol maximum (%) 50(1) 50(1)",
      "VA-1290 17 sept. 2024",
    ].join("\n"));

    expect(parsed.projectExcluded).toBe(true);
    expect(parsed.norms).toEqual([]);
  });
});

describe("parseNotreDameDeLourdesJolietteDensityDocument", () => {
  const datedOwner = [
    "Règlement de zonage 02-2023",
    "MUNICIPALITÉ DE NOTRE-DAME-DE-LOURDES",
    "Dernière mise à jour le : 27 novembre 2024",
    "Les documents suivants sont annexés au présent règlement et en font partie intégrante à toute fin que de droit :",
    "Annexe C : Grilles des spécifications",
  ].join("\n");

  it("publishes the verbatim H-16 COS when every printed use column agrees", () => {
    const parsed = parseNotreDameDeLourdesJolietteDensityDocument([
      datedOwner,
      "\fRèglement de zonage 02-2023 Annexe C – Grilles de spécifications",
      "Zone H-16",
      "Coefficient d'emprise au sol maximal (%) 2 2 2 2",
    ].join("\n"));

    expect(parsed).toMatchObject({
      documentAnchored: true,
      projectExcluded: false,
      refusals: [],
      norms: [{
        zoneCode: "H-16",
        value: 2,
        unit: "cos-max",
        raw: "2 2 2 2",
        page: 2,
      }],
    });
  });

  it("refuses an annex whose integrated municipal document has no verbatim date", () => {
    const parsed = parseNotreDameDeLourdesJolietteDensityDocument([
      datedOwner.replace("Dernière mise à jour le : 27 novembre 2024", ""),
      "\fZone H-16",
      "Coefficient d'emprise au sol maximal (%) 2 2 2 2",
    ].join("\n"));

    expect(parsed.documentAnchored).toBe(false);
    expect(parsed.norms).toEqual([]);
  });

  it("refuses divergent use columns instead of selecting a maximum", () => {
    const parsed = parseNotreDameDeLourdesJolietteDensityDocument([
      datedOwner,
      "\fZone H-16",
      "Coefficient d'emprise au sol maximal (%) 2 2 3 2",
    ].join("\n"));

    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason).toBe("maxima-divergents-entre-colonnes-usages");
  });

  it("excludes a project document", () => {
    const parsed = parseNotreDameDeLourdesJolietteDensityDocument([
      datedOwner,
      "PREMIER PROJET DE RÈGLEMENT",
      "\fZone H-16",
      "Coefficient d'emprise au sol maximal (%) 2 2 2 2",
    ].join("\n"));

    expect(parsed.projectExcluded).toBe(true);
    expect(parsed.norms).toEqual([]);
  });
});

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

describe("parseTresSaintRedempteurDensityDocument", () => {
  const owner = [
    'MUNICIPALITÉ DE TRÈS-SAINT-RÉDEMPTEUR   Annexe "C" du règlement',
    "GRILLE DES USAGES ET DES NORMES   de zonage numéro 155",
  ].join("\n");
  const positioned = (cells: Array<[number, string]>): string => {
    const line: string[] = [];
    for (const [column, value] of cells) {
      while (line.length < column) line.push(" ");
      for (const [offset, character] of [...value].entries()) line[column + offset] = character;
    }
    return line.join("");
  };

  it("publishes only numeric dwelling maxima under their measured zone columns", () => {
    const parsed = parseTresSaintRedempteurDensityDocument([
      owner,
      positioned([[0, "ZONES"], [40, "A-1"], [50, "A-2"], [60, "RC-7"], [70, "PA-16"]]),
      positioned([[0, "Logement / bâtiment"], [30, "max."], [40, "1"], [50, "2"], [60, "4"]]),
    ].join("\n"));

    expect(parsed).toMatchObject({
      documentAnchored: true,
      projectExcluded: false,
      refusals: [],
      norms: [
        { zoneCode: "A-1", value: 1, unit: "logements/batiment", raw: "1", page: 1 },
        { zoneCode: "A-2", value: 2, unit: "logements/batiment", raw: "2", page: 1 },
        { zoneCode: "RC-7", value: 4, unit: "logements/batiment", raw: "4", page: 1 },
      ],
    });
  });

  it("does not shift a value into an adjacent blank zone cell", () => {
    const parsed = parseTresSaintRedempteurDensityDocument([
      owner,
      positioned([[0, "ZONES"], [40, "RB-11"], [50, "Cons-"], [60, "RC-14"], [70, "PA-18"]]),
      positioned([[50, "13"]]),
      positioned([[0, "Logement / bâtiment"], [30, "max."], [40, "1"], [60, "3"]]),
    ].join("\n"));

    expect(parsed.norms).toEqual([
      expect.objectContaining({ zoneCode: "RB-11", value: 1 }),
      expect.objectContaining({ zoneCode: "RC-14", value: 3 }),
    ]);
  });

  it("excludes a project document", () => {
    const parsed = parseTresSaintRedempteurDensityDocument([
      owner,
      "PREMIER PROJET DE RÈGLEMENT",
      positioned([[0, "ZONES"], [40, "A-1"], [50, "A-2"]]),
      positioned([[0, "Logement / bâtiment"], [30, "max."], [40, "1"], [50, "1"]]),
    ].join("\n"));

    expect(parsed.projectExcluded).toBe(true);
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

describe("parseClermontDensityDocument", () => {
  const clermontHeader = [
    "VILLE DE CLERMONT",
    "RÈGLEMENT DE ZONAGE NUMÉRO VC-434-13",
    "ANNEXE K - GRILLES DES SPÉCIFICATIONS",
  ].join("\n");

  it("publishes one explicit maximum when all use columns agree", () => {
    const parsed = parseClermontDensityDocument([
      clermontHeader,
      "ZONE 006-Rec",
      "H1 Logement Nombre minimal de logement 1 1",
      "Nombre maximal de logement 2 2",
    ].join("\n"));
    expect(parsed.norms).toEqual([expect.objectContaining({
      zoneCode: "006-Rec",
      value: 2,
      unit: "logements/batiment",
      raw: "2 | 2",
    })]);
  });

  it("preserves a decimal zone code and excludes a parenthetical note number", () => {
    const parsed = parseClermontDensityDocument([
      clermontHeader,
      "ZONE 138.1-Ha (PIIA)",
      "Nombre maximal de logement 1 (note 7)",
    ].join("\n"));
    expect(parsed.norms).toEqual([expect.objectContaining({
      zoneCode: "138.1-Ha",
      value: 1,
      raw: "1",
    })]);
  });

  it("refuses divergent maxima instead of choosing a use class", () => {
    const parsed = parseClermontDensityDocument([
      clermontHeader,
      "ZONE 010-H",
      "Nombre maximal de logement 2 1 -",
    ].join("\n"));
    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason)
      .toBe("maxima-divergents-entre-colonnes-usages");
  });
});

describe("parseVarennesDensityDocument", () => {
  const varennesPage = [
    "GRILLE DES USAGES ET NORMES Zone H-403",
    "file:///C:/PGSYSTEM/Grille/Exe/html1.html 2021-06-01",
  ].join("\n");

  it("carries the printed zone to the continuation page and keeps an agreeing COS maximum", () => {
    const parsed = parseVarennesDensityDocument([
      varennesPage,
      "\f",
      "54. Coefficient d'occupation du sol max. 0.8 0.8",
      "file:///C:/PGSYSTEM/Grille/Exe/html1.html 2021-06-01",
    ].join("\n"));
    expect(parsed.norms).toEqual([expect.objectContaining({
      zoneCode: "H-403",
      value: 0.8,
      unit: "cos-max",
      raw: "0.8 | 0.8",
    })]);
  });

  it("retains a safe housing maximum while refusing a divergent COS row", () => {
    const parsed = parseVarennesDensityDocument([
      "GRILLE DES USAGES ET NORMES Zone H-405",
      "6. b) Nombre de logements max. 32",
      "file:///C:/PGSYSTEM/Grille/Exe/html1.html 2021-06-01",
      "\f",
      "54. Coefficient d'occupation du sol max. 0.8 2",
    ].join("\n"));
    expect(parsed.norms).toEqual([expect.objectContaining({
      zoneCode: "H-405",
      value: 32,
      unit: "logements/batiment",
    })]);
    expect(parsed.refusals[0]?.reason)
      .toBe("maxima-divergents-entre-colonnes-usages");
  });

  it("drops a zone carrying two different valid maximum metrics", () => {
    const parsed = parseVarennesDensityDocument([
      "GRILLE DES USAGES ET NORMES Zone H-405",
      "6. b) Nombre de logements max. 32",
      "file:///C:/PGSYSTEM/Grille/Exe/html1.html 2021-06-01",
      "\f",
      "54. Coefficient d'occupation du sol max. 0.8 0.8",
    ].join("\n"));
    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason).toBe("valeurs-divergentes-pour-la-zone");
  });
});

describe("parseMontTremblantDensityDocument", () => {
  const anchor = [
    "Annexe A du règlement de zonage (2008)-102",
    "GRILLE DES USAGES ET DES NORMES",
  ].join("\n");

  it("keeps agreeing logements/ha columns and strips footnote numbers", () => {
    const parsed = parseMontTremblantDensityDocument([
      anchor,
      "ZONE : TM-680",
      "Logements/terrain maximal (logements/ha) 2,6 (3) 2,6 (3) 2,6 (3)",
    ].join("\n"));
    expect(parsed.norms).toEqual([expect.objectContaining({
      zoneCode: "TM-680",
      value: 2.6,
      unit: "log/ha",
      raw: "2,6 | 2,6 | 2,6",
    })]);
  });

  it("publishes an unconditional per-building maximum", () => {
    const parsed = parseMontTremblantDensityDocument([
      anchor,
      "ZONE : CV-325",
      "(1) Le nombre maximal de logements par bâtiment est fixé à 12.",
    ].join("\n"));
    expect(parsed.norms).toEqual([expect.objectContaining({
      zoneCode: "CV-325",
      value: 12,
      unit: "logements/batiment",
    })]);
  });

  it("refuses divergent columns and conditional prose", () => {
    const parsed = parseMontTremblantDensityDocument([
      anchor,
      "ZONE : RC-400",
      "Logements/terrain maximal (logements/ha) 65 55",
      "Le nombre maximal de logements par bâtiment est fixé à 4 à l'exception d'un bâtiment qui peut en avoir 8.",
    ].join("\n"));
    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals.map((refusal) => refusal.reason)).toEqual([
      "maxima-divergents-entre-colonnes-usages",
      "maximum-conditionnel",
    ]);
  });
});

describe("parseSaintJeromeDensityDocument", () => {
  const owner = [
    "Règlement numéro 0351-000 sur le zonage de la Ville de Saint-Jérôme",
    "Zone : CUS-406",
  ].join("\n");

  it("publishes only a numeric COS maximum", () => {
    const parsed = parseSaintJeromeDensityDocument([
      owner,
      "132 Coefficient d'occupation du sol (COS) min./max. 0,5 / 3",
    ].join("\n"));
    expect(parsed.norms).toEqual([expect.objectContaining({
      zoneCode: "CUS-406",
      value: 3,
      unit: "cos-max",
      raw: "3",
    })]);
  });

  it("does not turn a COS minimum into a maximum", () => {
    const parsed = parseSaintJeromeDensityDocument([
      owner,
      "70 Coefficient d'occupation du sol (COS) min./max. 2,5 / -",
    ].join("\n"));
    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason).toBe("cos-maximum-absent");
  });
});

describe("area density documents", () => {
  it("refuses the Mont-Tremblant plan density without a zone code", () => {
    const parsed = parseMontTremblantPlanDensityDocument([
      "Ville de Mont-Tremblant",
      "Règlement (2008)-100",
      "Plan d’urbanisme",
      "DENSITÉ D’OCCUPATION",
      "Maximum de 5 logements à l’hectare",
    ].join("\n"));
    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason).toBe("densite-affectation-sans-code-zone");
  });

  it("refuses the Varennes PPU density without a zone code", () => {
    const parsed = parseVarennesPpuDensityDocument([
      "Ville de Varennes",
      "PROGRAMME PARTICULIER D’URBANISME",
      "logements à l’hectare : 30",
    ].join("\n"));
    expect(parsed.norms).toEqual([]);
    expect(parsed.refusals[0]?.reason).toBe("densite-affectation-sans-code-zone");
  });
});
