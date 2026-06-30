/**
 * Unit tests for the anti-invention cross-check rule (`shouldRejectForZeroOverlap`).
 *
 * Regression guard for the kirkland case: the OCR read row LABELS as zone codes,
 * producing ≥3 distinct strings (so the count gate passed) but overlap=0 against
 * the SIG/reglement grille — pure fabrication that must be rejected before deposit.
 */
import { describe, it, expect } from "vitest";

import { shouldRejectForZeroOverlap } from "./zonage-norms.js";

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
