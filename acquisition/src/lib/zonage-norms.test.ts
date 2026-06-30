/**
 * Unit tests for the anti-invention cross-check rule (`shouldRejectForZeroOverlap`).
 *
 * Regression guard for the kirkland case: the OCR read row LABELS as zone codes,
 * producing ≥3 distinct strings (so the count gate passed) but overlap=0 against
 * the SIG/reglement grille — pure fabrication that must be rejected before deposit.
 */
import { describe, it, expect } from "vitest";

import {
  shouldRejectForZeroOverlap,
  shouldRejectForZeroNormFields,
  looksLikeTableOfContents,
} from "./zonage-norms.js";

describe("shouldRejectForZeroOverlap", () => {
  it("A — gridFound:true, overlap:0 → REJECTED (kirkland mis-routed OCR)", () => {
    expect(shouldRejectForZeroOverlap({ gridFound: true, overlap: 0 })).toBe(true);
  });

  it("B — gridFound:true, overlap:5 → accepted (codes match the grille)", () => {
    expect(shouldRejectForZeroOverlap({ gridFound: true, overlap: 5 })).toBe(false);
  });

  it("C — gridFound:false → accepted (no grille to cross-validate; count gate alone)", () => {
    expect(shouldRejectForZeroOverlap({ gridFound: false, overlap: 0 })).toBe(false);
  });
});

describe("shouldRejectForZeroNormFields", () => {
  it("0% published norm fields → REJECTED (carignan ToC/body-text OCR)", () => {
    expect(shouldRejectForZeroNormFields(0)).toBe(true);
  });

  it("40% published norm fields → accepted (real grille has values)", () => {
    expect(shouldRejectForZeroNormFields(40)).toBe(false);
  });
});

describe("looksLikeTableOfContents", () => {
  const tocTitled = [
    "TABLE DES MATIÈRES",
    "CHAPITRE 1  DISPOSITIONS DÉCLARATOIRES ............. 5",
    "Article 1.1  Titre du règlement ................... 6",
    "CHAPITRE 2  DISPOSITIONS ADMINISTRATIVES .......... 12",
  ].join("\n");

  const tocDotted = [
    "Dispositions déclaratoires ...................... 3",
    "Champ d'application ............................. 4",
    "Définitions ..................................... 7",
    "Zones et usages ................................ 11",
  ].join("\n");

  // A real grille header band + numeric value rows (hauteur/marges/densité).
  const grillePage = [
    "GRILLE DES USAGES ET NORMES",
    "Références          A-1   A-2   A-3   A-4   A-5   A-6",
    "Hauteur max (m)      12    15    10     9    11     8",
    "Marge avant (m)       6     6     4   4.5     6     6",
    "Densité (log/ha)     20    25    15    10    30    35",
    "Superficie min       300   350   250   400   300   300",
  ].join("\n");

  it("ToC page with a title → excluded (true)", () => {
    expect(looksLikeTableOfContents(tocTitled)).toBe(true);
  });

  it("ToC page with dotted leaders (no title) → excluded (true)", () => {
    expect(looksLikeTableOfContents(tocDotted)).toBe(true);
  });

  it("grille page with numeric value columns → kept (false)", () => {
    expect(looksLikeTableOfContents(grillePage)).toBe(false);
  });
});
