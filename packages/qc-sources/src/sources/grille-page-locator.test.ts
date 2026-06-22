import { describe, it, expect } from "vitest";

import {
  hasGrilleTitle,
  countGrilleRows,
  isGrilleTablePage,
  locateGrillePages,
  MIN_GRILLE_ROWS,
} from "./grille-page-locator.js";

// ─────────────────────────────────────────────────────────────────────────────
//  Representative page fixtures (distilled from the discovered corpus gabarits).
// ─────────────────────────────────────────────────────────────────────────────

/** A real grille TABLE page: title + a band of grille-row-shaped lines. */
const GRILLE_TABLE_PAGE = `
                                                    Numéro de zone: MS-324
Grille des spécifications
                                                    Dominance d'usage
            détail et services de proximité    C-1            x       x
           avant (m)                            min,     6       6           5
           latérale (m)                         min.     4       0
           arrière (m)                          min.     4       4
           largeur (m)                          min.    48      48          18
           hauteur (étages)                     min.     3       3     3     3
           hauteur (étages)                     max.     6       6    14    14
           superficie (m2)                      min.  1600    1600  1600  1600
`;

/** A one-zone-per-page vertical grille (boisbriand gabarit), OCR'd title. */
const ONE_ZONE_GRILLE_PAGE = `
 ZONE: R-1 102
 À jour au: 21 septembre 2016
 GRI LLES DES USAGES ET DES NORM ES
 CLASSES D'USAGES PERMISES
                 Largeur minimale (m)                                15
                 Superficie de planchers minimale (m2)
                 Hauteur en étage(s) minimale                         1
                 Hauteur en étage(s) maximale                         3
                 Hauteur en mètres maximale                          12
                 Profondeur minimale (m)                              28
                 Marge avant minimale (m)                              6
`;

/**
 * The bylaw's "Comment lire la grille" LEGEND page — it mentions the grille
 * title AND lists the norms ("a) La marge avant minimale;"), but every line is a
 * prose enumeration, NOT a table row. Must NOT be classified as a grille page.
 */
const LEGEND_PROSE_PAGE = `
Ville de La Prairie                                              Chapitre 1
Règlement de zonage No 1250
                     Les rapports peuvent être compris à la grille des usages et des normes :
                           f) hauteur en étages, maximale;
                           g) hauteur en mètres, minimale;
                           h) hauteur en mètres, maximale.
                     4° Marges
                           a) La marge avant minimale;
                           b) La marge avant maximale;
                           c) La marge latérale minimale;
                           d) Les marges latérales totales minimales ;
                           e) La marge arrière minimale ;
`;

/** A plain règlement body page that merely references the grille once, in prose. */
const PROSE_REFERENCE_PAGE = `
ARTICLE 252  L'annexe B constituant la grille des spécifications est modifiée
             afin de remplacer la hauteur maximale applicable à la zone H-3.
             La marge avant minimale demeure inchangée.
`;

/** An image-only scan page: poppler emits an empty (or near-empty) text layer. */
const IMAGE_ONLY_PAGE = "";

/** A zoning MAP page (delson): a title block, no norm table at all. */
const MAP_PAGE = `
ANNEXE A
PLAN DE ZONAGE
Règlement 901
`;

// ─────────────────────────────────────────────────────────────────────────────
//  hasGrilleTitle
// ─────────────────────────────────────────────────────────────────────────────

describe("hasGrilleTitle", () => {
  it("matches the clean 'grille des spécifications' title", () => {
    expect(hasGrilleTitle("Grille des spécifications")).toBe(true);
  });

  it("matches the canonical 'grille des usages et des normes' title", () => {
    expect(hasGrilleTitle("GRILLE DES USAGES ET DES NORMES")).toBe(true);
  });

  it("matches the OCR'd intra-word-space variant 'GRI LLES … NORM ES'", () => {
    expect(hasGrilleTitle("GRI LLES DES USAGES ET DES NORM ES")).toBe(true);
  });

  it("is accent-insensitive (specifications without the accent)", () => {
    expect(hasGrilleTitle("grille des specifications")).toBe(true);
  });

  it("rejects a page with no grille title", () => {
    expect(hasGrilleTitle("PLAN DE ZONAGE — annexe A")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  countGrilleRows — the table-vs-prose discriminator
// ─────────────────────────────────────────────────────────────────────────────

describe("countGrilleRows", () => {
  it("counts the row-shaped lines of a real grille table", () => {
    expect(countGrilleRows(GRILLE_TABLE_PAGE)).toBeGreaterThanOrEqual(MIN_GRILLE_ROWS);
  });

  it("counts the vertical one-zone grille's norm rows", () => {
    expect(countGrilleRows(ONE_ZONE_GRILLE_PAGE)).toBeGreaterThanOrEqual(MIN_GRILLE_ROWS);
  });

  it("does NOT count legend enumeration prose as rows", () => {
    // "a) La marge avant minimale;" etc. are sentences, not table cells.
    expect(countGrilleRows(LEGEND_PROSE_PAGE)).toBeLessThan(MIN_GRILLE_ROWS);
  });

  it("does NOT count a single prose reference as rows", () => {
    expect(countGrilleRows(PROSE_REFERENCE_PAGE)).toBeLessThan(MIN_GRILLE_ROWS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  isGrilleTablePage — title AND rows
// ─────────────────────────────────────────────────────────────────────────────

describe("isGrilleTablePage", () => {
  it("accepts a real grille table page", () => {
    expect(isGrilleTablePage(GRILLE_TABLE_PAGE)).toBe(true);
  });

  it("accepts a one-zone vertical grille page", () => {
    expect(isGrilleTablePage(ONE_ZONE_GRILLE_PAGE)).toBe(true);
  });

  it("rejects the legend prose page (title present, rows are prose)", () => {
    expect(isGrilleTablePage(LEGEND_PROSE_PAGE)).toBe(false);
  });

  it("rejects a prose reference page", () => {
    expect(isGrilleTablePage(PROSE_REFERENCE_PAGE)).toBe(false);
  });

  it("rejects an image-only (empty text) page", () => {
    expect(isGrilleTablePage(IMAGE_ONLY_PAGE)).toBe(false);
  });

  it("rejects a zoning map / title page", () => {
    expect(isGrilleTablePage(MAP_PAGE)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  locateGrillePages — range + layout + anti-invention null
// ─────────────────────────────────────────────────────────────────────────────

describe("locateGrillePages", () => {
  it("locates a single grille on the last page (saint-constant gabarit)", () => {
    const pages = [
      PROSE_REFERENCE_PAGE,
      MAP_PAGE,
      PROSE_REFERENCE_PAGE,
      GRILLE_TABLE_PAGE, // page 4
    ];
    const loc = locateGrillePages(pages);
    expect(loc).not.toBeNull();
    expect(loc!.firstPage).toBe(4);
    expect(loc!.lastPage).toBe(4);
    expect(loc!.grillePageCount).toBe(1);
    expect(loc!.confidence).toBe(1);
    expect(loc!.layout).toBe("multi-zone-per-page");
  });

  it("locates a full one-zone-per-page annex and flags its layout", () => {
    const pages = [
      ONE_ZONE_GRILLE_PAGE,
      ONE_ZONE_GRILLE_PAGE,
      ONE_ZONE_GRILLE_PAGE,
    ];
    const loc = locateGrillePages(pages);
    expect(loc).not.toBeNull();
    expect(loc!.firstPage).toBe(1);
    expect(loc!.lastPage).toBe(3);
    expect(loc!.grillePageCount).toBe(3);
    expect(loc!.confidence).toBe(1);
    expect(loc!.layout).toBe("one-zone-per-page");
  });

  it("computes a density confidence below 1 when grille pages are interleaved", () => {
    const pages = [
      GRILLE_TABLE_PAGE, // 1
      PROSE_REFERENCE_PAGE, // 2 (gap)
      GRILLE_TABLE_PAGE, // 3
    ];
    const loc = locateGrillePages(pages);
    expect(loc).not.toBeNull();
    expect(loc!.firstPage).toBe(1);
    expect(loc!.lastPage).toBe(3);
    expect(loc!.grillePageCount).toBe(2);
    expect(loc!.confidence).toBeCloseTo(2 / 3, 2);
  });

  it("returns null when no grille table page is present (prose-only bylaw)", () => {
    const pages = [PROSE_REFERENCE_PAGE, LEGEND_PROSE_PAGE, MAP_PAGE];
    expect(locateGrillePages(pages)).toBeNull();
  });

  it("returns null for an image-only scanned annex (empty text layer)", () => {
    const pages = [MAP_PAGE, IMAGE_ONLY_PAGE, IMAGE_ONLY_PAGE];
    expect(locateGrillePages(pages)).toBeNull();
  });
});
