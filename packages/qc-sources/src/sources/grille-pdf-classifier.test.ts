import { describe, it, expect } from "vitest";

import {
  classifyGrillePdf,
  countMultiZoneHorizontalPages,
  gateGrilleCandidate,
  isMultiZoneHorizontalPage,
  isTitleGatedGrillePage,
  isZoneCodeHeaderLine,
  isZoneHeaderGrillePage,
  zoneCodesOnLine,
} from "./grille-pdf-classifier.js";

// ─────────────────────────────────────────────────────────────────────────────
//  Representative page fixtures distilled from the discovered corpus.
//  POSITIVES — real grilles that MUST be kept (kind="grille").
//  NEGATIVES — plans (image-only) and règlements/amendements that MUST be
//  rejected so discovery never deposits them as grille.pdf.
// ─────────────────────────────────────────────────────────────────────────────

/** compton: "Grille des normes relatives à l'implantation…" — zone-code header
 *  band (H1..H10) + norm rows (signal C). NOT one of the frozen title anchors. */
const COMPTON_NORMES_PAGE = `
     Grille des normes relatives à l'implantation et aux dimensions des bâtiments par zone

   Normes d'implantation et de dimensions                                             Zones
                                                        H1     H2     H3     H4     H5     H6     H7     H8     H9     H10
Marge de recul avant minimale (mètre)                   7,5    7,5    7,5    7,5    7,5    7,5    7,5    7,5    7,5    7,5
Marge de recul arrière minimale (mètre)                  3      3      5      3      3      3      5      5      3      3
Marge de recul latérale minimale (mètre)                 2      2      2      2      2      2      2      2      2      2
Coefficient d'occupation du sol maximal (C.O.S)         0,15   0,25   0,25   0,25   0,25   0,15   0,25   0,40   0,25   0,25
`;

/** saint-claude: "Grille des usages et des constructions autorisés par zones" —
 *  a labelled zone-code header "Réf. classe d'usages AG-1 … AG-5" (signal C). */
const SAINT_CLAUDE_USAGE_PAGE = `
 Grille des usages et des constructions autorisés par zones
 Sous-groupe ZONES
 Réf. classe d'usages AG-1 AG-2 AG-3 AG-4 AG-5
 6,2 A Résidentiel de faible densité
 A.1 Habitation unifamiliale isolée x1 x1 x1 x1 x1
 E Maison mobile x² x² x² x² x²
`;

/** portneuf gabarit (signal A): title anchor + grille-row band, transposed. */
const TITLE_TABLE_PAGE = `
                                                    Numéro de zone: MS-324
Grille des spécifications
           largeur (m)                          min.    48      48          18
           hauteur (étages)                     min.     3       3     3     3
           hauteur (étages)                     max.     6       6    14    14
           superficie (m2)                      min.  1600    1600  1600  1600
`;

/** godmanchester: a règlement modifiant (amendment) — legal prose, no table. */
const REGLEMENT_AMENDMENT_PAGE = `
 Règlement 505
PROVINCE DE QUÉBEC
MUNICIPALITÉ DU CANTON DE GODMANCHESTER
 RÈGLEMENT 505 MODIFIANT LE RÈGLEMENT DE ZONAGE 357
ATTENDU que le conseil souhaite modifier certaines normes règlementaires ;
Article 1
Le règlement de zonage 357 est modifié à l'article 2.6.2, par l'ajout de l'alinéa suivant.
Avis de motion : 3 avril 2023
Adoption du règlement : 5 juin 2023
Entrée en vigueur :
`;

/** A règlement body that NAMES zones in prose (les zones H-1, H-2 et H-3) — must
 *  NOT be read as a zone-code header (anti-prose discriminator). */
const REGLEMENT_PROSE_ZONES_PAGE = `
Le présent règlement s'applique aux zones commerciales soumises à la réglementation.
Les zones H-1, H-2 et H-3 sont autorisées à des fins résidentielles de faible densité.
Attendu que le conseil souhaite modifier le règlement de zonage afin de réaliser sa vision.
`;

/** saint-paul gabarit (signal D): "Grilles de spécifications" (DE, not des) running
 *  header + a one-zone-per-page "Zone A1" banner — the locator's strict "des"
 *  anchor misses it; signal D rescues it. */
const SAINT_PAUL_ONE_ZONE_PAGE = `
Règlement de zonage numéro 606-2023 Annexe E – Grilles de spécifications
Zone A1
 Classes d'usages
 H1 – Habitation unifamiliale
 Marge
 Avant minimale (m) 8 8 10 8 8 10 8
 Superficie minimale (m2) 600
 Hauteur maximale (étage) 2 2
`;

/** A règlement that prose-mentions "dans la grille des spécifications H-14"
 *  (bois-des-filion) — broad title present but NO tabular structure → not grille. */
const REGLEMENT_MENTIONS_GRILLE_PAGE = `
 RÈGLEMENT NUMÉRO 7206 AMENDANT LE RÈGLEMENT DE ZONAGE NUMÉRO 7200
CONSIDÉRANT QUE le conseil juge opportun de modifier le règlement de zonage afin
 d'ajouter dans la grille des spécifications H-14 la disposition particulière de projet intégré;
 avis de motion donné le 14 janvier 2020.
`;

describe("zoneCodesOnLine", () => {
  it("extracts distinct uppercase zone codes from a column band", () => {
    expect(zoneCodesOnLine("  H1   H2    H3   H4   H10  ")).toEqual([
      "H1",
      "H2",
      "H3",
      "H4",
      "H10",
    ]);
  });
  it("handles dashed and labelled codes (AG-1 … AG-5)", () => {
    expect(zoneCodesOnLine("Réf. classe d'usages AG-1 AG-2 AG-3 AG-4 AG-5")).toEqual([
      "AG-1",
      "AG-2",
      "AG-3",
      "AG-4",
      "AG-5",
    ]);
  });
  it("ignores plain numbers, years and reference numbers (no letter prefix)", () => {
    expect(zoneCodesOnLine("Règlement 505 article 2.6.2 adopté 2023")).toEqual([]);
  });
});

describe("isZoneCodeHeaderLine", () => {
  it("accepts a bare column band of ≥3 zone codes", () => {
    expect(isZoneCodeHeaderLine("H1   H2   H3   H4   H5")).toBe(true);
  });
  it("accepts a labelled header where codes dominate the tokens", () => {
    expect(isZoneCodeHeaderLine("Réf. classe d'usages AG-1 AG-2 AG-3 AG-4 AG-5")).toBe(true);
  });
  it("rejects a prose sentence naming zones (commas + terminator)", () => {
    expect(
      isZoneCodeHeaderLine("Les zones H-1, H-2 et H-3 sont autorisées à des fins résidentielles."),
    ).toBe(false);
  });
  it("rejects fewer than 3 codes", () => {
    expect(isZoneCodeHeaderLine("zones H-1 et H-2")).toBe(false);
  });
});

/** clarenceville: zones numbered (no letter prefix) — caught only via the explicit
 *  "Numéros de zones" label anchor. */
const NUMERIC_ZONE_PAGE = `
Municipalité de Saint-Georges-de-Clarenceville                          ZONE
Règlement de Zonage no 428                              Grilles des usages
 Numéros de zones                       101   103   104   105   106
 USAGES AUTORISÉS PAR ZONE
`;

describe("isNumericZoneHeaderLine / numeric-zone grilles", () => {
  it("accepts an explicit 'Numéros de zones 101 103 104 …' header", () => {
    expect(
      classifyGrillePdf([NUMERIC_ZONE_PAGE]).kind,
    ).toBe("grille");
  });
  it("does NOT fire on a bare run of numbers without the zone label", () => {
    const c = classifyGrillePdf(["Annexe budgétaire 101 103 104 105 106 totaux"]);
    expect(c.signals.zoneHeaderPages).toBe(0);
  });
});

describe("isZoneHeaderGrillePage", () => {
  it("flags the compton normes page (header band + grille context)", () => {
    expect(isZoneHeaderGrillePage(COMPTON_NORMES_PAGE)).toBe(true);
  });
  it("flags the saint-claude usage page (labelled header + ZONES context)", () => {
    expect(isZoneHeaderGrillePage(SAINT_CLAUDE_USAGE_PAGE)).toBe(true);
  });
  it("does NOT flag a règlement prose page that names zones", () => {
    expect(isZoneHeaderGrillePage(REGLEMENT_PROSE_ZONES_PAGE)).toBe(false);
  });
});

describe("classifyGrillePdf — POSITIVES kept", () => {
  it("compton multi-zone normes sheet → grille", () => {
    const c = classifyGrillePdf([COMPTON_NORMES_PAGE, COMPTON_NORMES_PAGE]);
    expect(c.kind).toBe("grille");
    expect(c.signals.zoneHeaderPages).toBe(2);
    expect(c.signals.firstZoneHeaderPage).toBe(1);
  });
  it("saint-claude usage grid → grille", () => {
    const c = classifyGrillePdf([SAINT_CLAUDE_USAGE_PAGE]);
    expect(c.kind).toBe("grille");
  });
  it("title-anchored transposed grille (portneuf gabarit) → grille", () => {
    const c = classifyGrillePdf([TITLE_TABLE_PAGE]);
    expect(c.kind).toBe("grille");
    expect(c.signals.titleTablePages).toBeGreaterThanOrEqual(1);
  });
  it("a grille buried after cover pages is still found (multi-page)", () => {
    const c = classifyGrillePdf(["cover page\nintro text\n", "", COMPTON_NORMES_PAGE]);
    expect(c.kind).toBe("grille");
    expect(c.signals.firstGrillePage).toBe(3);
  });
});

describe("isTitleGatedGrillePage (signal D)", () => {
  it("rescues a one-zone-per-page 'Grilles de spécifications' grille (saint-paul)", () => {
    expect(isTitleGatedGrillePage(SAINT_PAUL_ONE_ZONE_PAGE)).toBe(true);
  });
  it("does NOT fire on a règlement that only prose-mentions the grille", () => {
    expect(isTitleGatedGrillePage(REGLEMENT_MENTIONS_GRILLE_PAGE)).toBe(false);
  });
});

describe("classifyGrillePdf — POSITIVES via signal D", () => {
  it("saint-paul one-zone vertical grille → grille (not unknown)", () => {
    const c = classifyGrillePdf([SAINT_PAUL_ONE_ZONE_PAGE]);
    expect(c.kind).toBe("grille");
  });
});

describe("classifyGrillePdf — NEGATIVES rejected", () => {
  it("règlement amendant (AMENDANT/CONSIDÉRANT) that mentions the grille → reglement", () => {
    const c = classifyGrillePdf([REGLEMENT_MENTIONS_GRILLE_PAGE]);
    expect(c.kind).toBe("reglement");
    expect(c.signals.grillePages).toBe(0);
  });
  it("image-only plan/carte (empty text layer) → plan-image", () => {
    const c = classifyGrillePdf(["", " ", "1"]); // ~scanned map, near-empty text
    expect(c.kind).toBe("plan-image");
  });
  it("multi-page image-only plan (la-minerve gabarit: 1 char/page) → plan-image", () => {
    const c = classifyGrillePdf(Array.from({ length: 15 }, () => " "));
    expect(c.kind).toBe("plan-image");
  });
  it("règlement modifiant (godmanchester) → reglement", () => {
    const c = classifyGrillePdf([REGLEMENT_AMENDMENT_PAGE]);
    expect(c.kind).toBe("reglement");
    expect(c.signals.amendmentPages).toBe(1);
  });
  it("règlement naming zones in prose → reglement (not grille)", () => {
    const c = classifyGrillePdf([REGLEMENT_PROSE_ZONES_PAGE]);
    expect(c.kind).toBe("reglement");
    expect(c.signals.zoneHeaderPages).toBe(0);
  });
  it("dense non-grille text without amendment markers → unknown (still rejected)", () => {
    const filler =
      "Le présent document décrit les orientations générales d'aménagement du territoire municipal. ".repeat(
        10,
      );
    const c = classifyGrillePdf([filler]);
    expect(c.kind).toBe("unknown");
    expect(c.signals.grillePages).toBe(0);
  });
});

describe("gateGrilleCandidate", () => {
  const grille = classifyGrillePdf([COMPTON_NORMES_PAGE]);
  const reglement = classifyGrillePdf([REGLEMENT_AMENDMENT_PAGE]);
  const plan = classifyGrillePdf([""]);
  const unknown = classifyGrillePdf([
    "Le présent document décrit les orientations d'aménagement. ".repeat(10),
  ]);

  it("hard-rejects a plan/carte (image-only)", () => {
    expect(gateGrilleCandidate(plan, false).keep).toBe(false);
  });
  it("hard-rejects a règlement/amendement", () => {
    expect(gateGrilleCandidate(reglement, false).keep).toBe(false);
  });
  it("keeps a grille and ranks a bounded route highest", () => {
    expect(gateGrilleCandidate(grille, true)).toMatchObject({ keep: true, priority: 3 });
    expect(gateGrilleCandidate(grille, false)).toMatchObject({ keep: true, priority: 1 });
  });
  it("keeps an unknown only as the lowest-priority fallback", () => {
    expect(gateGrilleCandidate(unknown, false)).toMatchObject({ keep: true, priority: 0 });
  });
  it("ranks a real grille above an unknown fallback", () => {
    expect(gateGrilleCandidate(grille, false).priority).toBeGreaterThan(
      gateGrilleCandidate(unknown, false).priority,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Multi-zone HORIZONTAL detection (route-fix signal): zones-as-columns pages the
//  zone-header signal C can miss → must route MULTIZONE, not single-zone vision.
// ─────────────────────────────────────────────────────────────────────────────

/** A horizontal multi-zone sheet: grille title + a header ROW of zone-code columns. */
const MZ_HORIZONTAL_PAGE = `
        Grille des normes relatives à l'implantation
   Réf.   classe        H1     H2     H3     H4     H10
   Marge avant (m)       6      6      5      5      4
   Hauteur (étages)      2      2      3      3      6
`;

/** The la-durantaye / saint-neree ONE-zone-per-page codified-bylaw gabarit: one
 *  zone in the title, usage codes listed ONE PER LINE (never ≥3 codes on a row). */
const ONE_ZONE_PER_PAGE = `
ANNEXE J GRILLES DE SPÉCIFICATION                                   ZONE 1- HA
                  USAGE PERMIS                          NORMES D'IMPLANTATION
                       Unifamiliale isolée    H-1    x      Marge avant (m)   5   -
                     Unifamiliale jumelée     H-2    x    Marge latérale (m)  2   -
                   Unifamiliale en rangée     H-3         Marge arrière (m)   6   -
                              Multifamiliale  H-7              Hauteur (m)     5  10
`;

describe("isMultiZoneHorizontalPage", () => {
  it("detects a zones-as-columns horizontal grille (title + ≥3 codes on a row)", () => {
    expect(isMultiZoneHorizontalPage(MZ_HORIZONTAL_PAGE)).toBe(true);
  });

  it("does NOT fire on a one-zone-per-page codified gabarit (≤1 code per line)", () => {
    // Route-fix guardrail: la-durantaye/saint-neree must stay single-zone vision,
    // not be rerouted to multizone.
    expect(isMultiZoneHorizontalPage(ONE_ZONE_PER_PAGE)).toBe(false);
  });

  it("does NOT fire on prose that merely names zones", () => {
    const prose =
      "Dans la grille des spécifications, les zones H-1, H-2 et H-3 sont visées.";
    expect(isMultiZoneHorizontalPage(prose)).toBe(false);
  });

  it("requires the grille title (a bare code row without a title does not match)", () => {
    expect(isMultiZoneHorizontalPage("   H1   H2   H3   H4   H10\n")).toBe(false);
  });

  it("counts horizontal pages within a 1-based page range", () => {
    const pages = [ONE_ZONE_PER_PAGE, MZ_HORIZONTAL_PAGE, MZ_HORIZONTAL_PAGE];
    expect(countMultiZoneHorizontalPages(pages)).toBe(2);
    expect(countMultiZoneHorizontalPages(pages, 1, 1)).toBe(0);
    expect(countMultiZoneHorizontalPages(pages, 2, 3)).toBe(2);
  });
});
