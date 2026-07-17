import { describe, it, expect } from "vitest";

import {
  readZoneHeaderCode,
  readNumeroZoneHeaderCode,
  normalizeHeaderCode,
  isZoneHeaderGrillePage,
  locateZoneHeaderGrille,
  MIN_ZH_PAGES,
} from "./grille-zoneheader-locator.js";

// ─────────────────────────────────────────────────────────────────────────────
//  Representative one-zone-per-page grille fixtures (distilled from the corpus).
// ─────────────────────────────────────────────────────────────────────────────

/** durham-sud: "Dispositions applicables à la zone :\n\n H-11" + label:value rows. */
const DURHAM_PAGE = (zone: string): string => `
                                    Règlement de zonage 267
                             Dispositions applicables à la zone :

                                                                        ${zone}
                             Amendements :

  Usages autorisés                     Normes relatives aux marges de recul
H1 Unifamiliale isolée       Marge de recul avant minimale              10 mètres
H2 Unifamiliale jumelée      Marge de recul arrière minimale            7,5 mètres
H3 Bifamiliale isolée        Marge de recul latérale minimale           2 mètres
H5 Habitation                Hauteur maximale                           9 mètres
                                       Normes de lotissement
C7 Gîte                      Largeur minimale                           25 mètres
C8 Hébergement               Superficie minimale                        1500 mètres carrés
`;

/** lachute: "GRILLE DES SPÉCIFICATIONS   ZONE: Ha-102" header, unit-in-paren rows. */
const LACHUTE_PAGE = (zone: string): string => `
     GRILLE DES SPÉCIFICATIONS                                     ZONE: ${zone}
                     Hauteur en mètre maximum         (m)        10       10        10
                     Superficie minimum               (m2)      3000     3000     3000
                     Frontage minimum                 (m)        45       45       45
                     Avant minimum                    (m)        15       15       15
`;

/** champlain: numeric-only "ZONE : 101" header; prefix stays for SIG numeric bridge. */
const CHAMPLAIN_PAGE = (zone: string): string => `
GRILLE DE SPÉCIFICATIONS                         ZONE : ${zone}                    RÉSIDENTIELLE

        Usages autorisés                                      Normes relatives au bâtiment principal
Habitation                                                      Marge avant minimale                      6m
Habitation unifamiliale                                         Marge arrière minimale                    6m
Habitation bifamiliale                                          Marge latérale minimale                   2m
Maison mobile                                                   Superficie minimale                      65 m2
                                                                Largeur minimale de la façade             6m
                                                                Hauteur maximale                          8m
`;

/** blainville: an ISOLATED corner code "M-1", numbered "Normes prescrites" matrix. */
const BLAINVILLE_PAGE = (zone: string): string => `
                                                                            ${zone}

               A- Usages autorisés
               B- Normes prescrites (bâtiment principal)
                     35. Avant minimale (m)                               6     6
                     43. Hauteur maximale (m)                            16    20
                     44. Largeur minimale (m)                            30    30
`;

/** A transposed multi-zone grille page — "Numéro de zone:" family, NOT one-zone. */
const TRANSPOSED_PAGE = `
                                                    Numéro de zone: MS-324
Grille des spécifications
           avant (m)                            min.     6       6           5
           hauteur (étages)                     max.     6       6    14    14
           superficie (m2)                      min.  1600    1600  1600  1600
`;

/** deux-montagnes: standalone "Numéro de zone" banner, code on next line. */
const NUMERO_ZONE_ONLY_PAGE = `
ANNEXE B - GRILLES DES USAGES ET NORMES

                                                    Numéro de zone
Grilles des usages et normes                           H-100

Lotissement
Frontage (m)                     min.      12,2           9,15
Superficie minimum (m²)                    370            270
Implantation
Marge avant (m)                   min.         6              6
Bâtiment
Hauteur (étages)                 max.          2              2
`;

/** A prose règlement page (no per-page header code). */
const PROSE_PAGE = `
ARTICLE 252  La marge avant minimale de la zone H-3 demeure inchangée; la
             hauteur maximale applicable est de 9 mètres.
`;

// ─────────────────────────────────────────────────────────────────────────────
//  readZoneHeaderCode
// ─────────────────────────────────────────────────────────────────────────────

describe("readZoneHeaderCode", () => {
  it("reads durham 'à la zone :' code on the NEXT non-blank line", () => {
    expect(readZoneHeaderCode(DURHAM_PAGE("H-11"))).toBe("H-11");
    expect(readZoneHeaderCode(DURHAM_PAGE("AD-54"))).toBe("AD-54");
  });

  it("reads lachute 'ZONE: Ha-102' inline (code on the title line)", () => {
    expect(readZoneHeaderCode(LACHUTE_PAGE("Ha-102"))).toBe("HA-102");
  });

  it("reads champlain 'ZONE : 101' as a verbatim numeric code", () => {
    expect(readZoneHeaderCode(CHAMPLAIN_PAGE("101"))).toBe("101");
  });

  it("reads blainville's ISOLATED corner code (no 'ZONE' word)", () => {
    expect(readZoneHeaderCode(BLAINVILLE_PAGE("M-1"))).toBe("M-1");
    expect(readZoneHeaderCode(BLAINVILLE_PAGE("H-103"))).toBe("H-103");
  });

  it("reads the digit-first 'ZONE 1- HA' codified gabarit", () => {
    expect(readZoneHeaderCode("ANNEXE J GRILLES DE SPÉCIFICATION   ZONE 1- HA\n  USAGE")).toBe("1-HA");
  });

  it("reads plaisance 'ZONE 5-P (Affectation …)' headers verbatim", () => {
    expect(
      readZoneHeaderCode("Grille de spécifications ZONE 5-P (Affectation Habitation, mixte)\nUSAGES AUTORISÉS"),
    ).toBe("5-P");
  });

  it("EXCLUDES the transposed 'Numéro de zone:' family (not one-zone-per-page)", () => {
    expect(readZoneHeaderCode(TRANSPOSED_PAGE)).toBeNull();
  });

  it("returns null for a prose page with no per-page header code", () => {
    expect(readZoneHeaderCode(PROSE_PAGE)).toBeNull();
  });

  it("never rewrites a serif 'I' prefix to a '1' (verbatim, anti-invention)", () => {
    expect(readZoneHeaderCode("GRILLE DES SPÉCIFICATIONS   ZONE: I01-132\n  norme")).toBe("I01-132");
  });
});

describe("readNumeroZoneHeaderCode", () => {
  it("reads a standalone 'Numéro de zone' banner code from the next line", () => {
    expect(readNumeroZoneHeaderCode(NUMERO_ZONE_ONLY_PAGE)).toBe("H-100");
  });

  it("keeps readZoneHeaderCode's transposed-family exclusion intact", () => {
    expect(readZoneHeaderCode(NUMERO_ZONE_ONLY_PAGE)).toBeNull();
    expect(readNumeroZoneHeaderCode(TRANSPOSED_PAGE)).toBeNull();
  });

  it("reads roberval abbreviated 'No de zone' banner + BARE code (same line)", () => {
    expect(
      readNumeroZoneHeaderCode("Zone résidentielle              No de zone   3R\nGroupe d'usage"),
    ).toBe("3R");
  });

  it("reads roberval 'No de zone' banner + BARE code on the next non-blank line", () => {
    expect(readNumeroZoneHeaderCode("No de zone\n\n21CO\nConstruction")).toBe("21CO");
    expect(readNumeroZoneHeaderCode("No de zone\n\n3REC\n")).toBe("3REC");
  });

  it("does NOT trip on ordinary prose mentioning a zone (no 'no … de zone' banner)", () => {
    expect(readNumeroZoneHeaderCode("les usages de la zone sont permis\n3R remains")).toBeNull();
  });
});

describe("normalizeHeaderCode", () => {
  it("normalises long dashes + inner spaces, uppercases", () => {
    expect(normalizeHeaderCode("Ha – 102")).toBe("HA-102");
    expect(normalizeHeaderCode("1- HA")).toBe("1-HA");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  isZoneHeaderGrillePage + locateZoneHeaderGrille (BORNAGE)
// ─────────────────────────────────────────────────────────────────────────────

describe("isZoneHeaderGrillePage", () => {
  it("accepts a durham label:value page (header code + norm rows)", () => {
    expect(isZoneHeaderGrillePage(DURHAM_PAGE("H-11"))).toBe(true);
  });
  it("accepts a lachute unit-in-paren page", () => {
    expect(isZoneHeaderGrillePage(LACHUTE_PAGE("Ha-102"))).toBe(true);
  });
  it("accepts a champlain numeric-code label:value page", () => {
    expect(isZoneHeaderGrillePage(CHAMPLAIN_PAGE("101"))).toBe(true);
  });
  it("rejects a prose page (no header code)", () => {
    expect(isZoneHeaderGrillePage(PROSE_PAGE)).toBe(false);
  });
});

describe("locateZoneHeaderGrille — bornage", () => {
  it("locates a contiguous one-zone-per-page window + verbatim codes", () => {
    const pages = [
      "COVER PAGE — no grille here",
      DURHAM_PAGE("H-11"),
      DURHAM_PAGE("P-12"),
      DURHAM_PAGE("AD-54"),
      "ANNEXE C — plans de zonage (no grille)",
    ];
    const win = locateZoneHeaderGrille(pages);
    expect(win).not.toBeNull();
    expect(win!.firstPage).toBe(2);
    expect(win!.lastPage).toBe(4);
    expect(win!.pages).toEqual([2, 3, 4]);
    expect(win!.zoneCodes).toEqual(["H-11", "P-12", "AD-54"]);
    expect(win!.uniqueZoneCodes).toBe(3);
    expect(win!.confidence).toBe(1);
  });

  it("bounds a DEEP annex (overrides a naive page-1 scan)", () => {
    const pages = [
      ...Array(30).fill("prose body of a codified by-law"),
      LACHUTE_PAGE("Ha-100"),
      LACHUTE_PAGE("Ha-101"),
      LACHUTE_PAGE("Hc-101"),
      LACHUTE_PAGE("Ha-102"),
    ];
    const win = locateZoneHeaderGrille(pages);
    expect(win).not.toBeNull();
    expect(win!.firstPage).toBe(31);
    expect(win!.lastPage).toBe(34);
    expect(win!.uniqueZoneCodes).toBe(4);
  });

  it("returns null below the MIN_ZH_PAGES floor (a lone grille page is not the layout)", () => {
    const pages = ["prose", DURHAM_PAGE("H-11"), "prose"];
    expect(MIN_ZH_PAGES).toBeGreaterThan(1);
    expect(locateZoneHeaderGrille(pages)).toBeNull();
  });

  it("returns null on a transposed multi-zone corpus (not one-zone-per-page)", () => {
    const pages = [TRANSPOSED_PAGE, TRANSPOSED_PAGE, TRANSPOSED_PAGE, TRANSPOSED_PAGE];
    expect(locateZoneHeaderGrille(pages)).toBeNull();
  });
});
