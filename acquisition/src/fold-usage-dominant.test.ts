import { describe, expect, it } from "vitest";

import { categoryFor, zoneCodeOf } from "./fold-usage-dominant.js";

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
});
