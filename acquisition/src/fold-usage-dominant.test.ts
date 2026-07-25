import { describe, expect, it } from "vitest";

import {
  carroyageVocation,
  categoryFor,
  categoryForAttribute,
  parenSigle,
  zoneCodeOf,
} from "./fold-usage-dominant.js";

describe("fold-usage-dominant attribute mode", () => {
  // Couches SANS zone_code (sansCode = 100%) dont la vocation est servie EN CLAIR
  // par un attribut du SIG — « Affectatio » = « Affectation » tronqué à 10 car. par
  // l'export shapefile (MRC de La Côte-de-Beaupré).
  const attrs = {
    "Agricole dynamique": "agricole",
    Conservation: "environnemental",
    "secteur déstru": null,
    "Périmètre d'urbanisation": null,
  } as const;

  it("matche le LIBELLÉ VERBATIM COMPLET, trim et casse-insensible", () => {
    expect(categoryForAttribute({ Affectatio: "Agricole dynamique" }, "Affectatio", attrs)).toBe("agricole");
    expect(categoryForAttribute({ Affectatio: "  conservation " }, "Affectatio", attrs)).toBe("environnemental");
    expect(categoryForAttribute({ Affectatio: "secteur déstru" }, "Affectatio", attrs)).toBe(null);
  });

  it("ne matche JAMAIS sur un fragment: un libellé absent du map rend null", () => {
    // « Agricole viable » ne doit pas être capté par la clé « Agricole dynamique »,
    // ni « Conservation » par un préfixe: le mode attribut n'est pas un startsWith.
    expect(categoryForAttribute({ Affectatio: "Agricole viable" }, "Affectatio", attrs)).toBe(null);
    expect(categoryForAttribute({ Affectatio: "Conservation intégrale" }, "Affectatio", attrs)).toBe(null);
    expect(categoryForAttribute({ Affectatio: "" }, "Affectatio", attrs)).toBe(null);
    expect(categoryForAttribute({}, "Affectatio", attrs)).toBe(null);
  });
});

describe("fold-usage-dominant zone-code selection", () => {
  it("matches a regulatory prefix on a digit-first SIG code", () => {
    const prefixes = { P: "commercial", H: "residentiel", REC: "environnemental", AAF: "agricole" } as const;

    expect(zoneCodeOf({ zone_code: "64 P" })).toBe("64 P");
    expect(categoryFor(zoneCodeOf({ zone_code: "64 P" })!, prefixes)).toBe("commercial");
    expect(categoryFor(zoneCodeOf({ zone_code: "22 H" })!, prefixes)).toBe("residentiel");
    expect(categoryFor(zoneCodeOf({ zone_code: "004-Rec" })!, prefixes)).toBe("environnemental");
    expect(categoryFor(zoneCodeOf({ zone_code: "29-Aaf" })!, prefixes)).toBe("agricole");
  });

  it("keeps an explicit raw-code map working during the prefix transition", () => {
    expect(categoryFor(zoneCodeOf({ zone_code: "22 H" })!, { "22 H": "residentiel", H: null })).toBe("residentiel");
  });

  it("keeps an already letter-first code matchable", () => {
    expect(zoneCodeOf({ zone_code: "Ra5" })).toBe("Ra5");
    expect(categoryFor(zoneCodeOf({ zone_code: "Ra5" })!, { RA: "residentiel" })).toBe("residentiel");
  });

  it("matches the spaced-dash digit-first form « 48 - R » (Ville de Disraeli)", () => {
    // `canonZoneCodeServe` ne réverse le digit-first qu'avec UN caractère de
    // séparation, donc « 48 - R » lui échappe: sans le resserrement, ces codes
    // ne matchent AUCUN préfixe réglementaire.
    const prefixes = { R: "residentiel", RC: null, IP: null, PE: "environnemental", A: "agricole" } as const;

    expect(categoryFor("48 - R", prefixes)).toBe("residentiel");
    expect(categoryFor("33 - RC", prefixes)).toBe(null); // le préfixe le PLUS LONG gagne: RC, pas R
    expect(categoryFor("31 - IP", prefixes)).toBe(null);
    expect(categoryFor("49 - PE", prefixes)).toBe("environnemental");
    expect(categoryFor("55 - A", prefixes)).toBe("agricole");
    // déjà letter-first: inchangé
    expect(categoryFor("ZR-74", prefixes)).toBe(null);
    // un code sans lettre reste sans catégorie
    expect(categoryFor("515", prefixes)).toBe(null);
  });

  it("lit la vocation en LETTRE FINALE d'un code de carroyage (« GJ06R », Ville de Granby)", () => {
    // Règl. 0663-2016 art. 14: les 2 lettres de tête sont une coordonnée cartésienne,
    // « la lettre qui suit le nombre séquentiel indique la vocation dominante ». Un map
    // par préfixe y voyait 110 « préfixes » sans aucun sens (`GJ32C` et `GJ06R` cohabitent).
    const prefixes = { R: "residentiel", C: "commercial", I: "industriel", A: "agricole", P: null } as const;

    expect(carroyageVocation("GJ06R")).toBe("R");
    expect(categoryFor("GJ06R", prefixes)).toBe("residentiel");
    expect(categoryFor("GJ32C", prefixes)).toBe("commercial");
    expect(categoryFor("HH13I", prefixes)).toBe("industriel");
    expect(categoryFor("KO01A", prefixes)).toBe("agricole");
    expect(categoryFor("GK04P", prefixes)).toBe(null);
    // ⛔ ANTI-FALL-THROUGH: la COORDONNÉE de tête a la forme d'un préfixe et gagnait
    // le longest-prefix à égalité de longueur — `IJ21R` était servi « industriel »
    // par la clé « I », `CK05R` « commercial » par la clé « C » (122 industriels et
    // 132 commerciaux FAUX mesurés au dry-run Granby avant correction).
    expect(categoryFor("IJ21R", prefixes)).toBe("residentiel");
    expect(categoryFor("CK05R", prefixes)).toBe("residentiel");
    expect(categoryFor("AF01A", prefixes)).toBe("agricole");
    expect(categoryFor("RG02C", prefixes)).toBe("commercial");
    expect(categoryFor("PL03I", prefixes)).toBe("industriel");
    // vocation ABSENTE du map => on retombe sur les formes ordinaires (legacy intact)
    expect(categoryFor("AB12Z", { AB: "agricole" })).toBe("agricole");
    // les artefacts « no.0966-2020 » du même SIG ne sont PAS des codes de zone
    expect(carroyageVocation("no.0966-2020")).toBe("");
    expect(categoryFor("no.0966-2020", prefixes)).toBe(null);
  });

  it("n'active PAS le carroyage sur les autres familles de codes", () => {
    // Additif: le motif exige 2 lettres + 2 chiffres + 1-3 lettres.
    expect(carroyageVocation("R-13")).toBe("");
    expect(carroyageVocation("22 H")).toBe("");
    expect(carroyageVocation("624 (AGC)")).toBe("");
    expect(carroyageVocation("515")).toBe("");
    expect(carroyageVocation("Ra5")).toBe("");
    // un letter-first à 2 lettres + 2 chiffres SANS lettre finale reste un préfixe
    expect(carroyageVocation("AF01")).toBe("");
    expect(categoryFor("AF01", { AF: "agricole" })).toBe("agricole");
  });

  it("expose le sigle parenthésé, pour que le gate --list-prefixes ne le range plus sous « (numérique) »", () => {
    // Famille MRC de La Mitis: la vocation est en SUFFIXE PARENTHÉSÉ. `categoryFor`
    // la lisait déjà, mais le gate la comptait comme numérique pure => on renonçait
    // à des munis mappables (sainte-luce 104 pol., sainte-angele 76, price 45…).
    expect(parenSigle("18 (AGF)")).toBe("AGF");
    expect(parenSigle("104 (AGF)")).toBe("AGF");
    expect(parenSigle("137 (MTF")).toBe("MTF"); // parenthèse fermante manquante à la source
    expect(parenSigle("83 AGC)")).toBe("AGC"); // parenthèse ouvrante manquante
    // pas de sigle: ni sur un code numérique pur, ni sur un code letter-first
    expect(parenSigle("515")).toBe("");
    expect(parenSigle("48 - R")).toBe("");
    expect(parenSigle("R-103")).toBe("");
  });
});
