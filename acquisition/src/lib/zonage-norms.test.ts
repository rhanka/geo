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
  canonZone,
  sigZoneCodesFromGeojson,
} from "./zonage-norms.js";

/** Build a minimal FeatureCollection whose features carry the given properties. */
function fc(propsList: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    type: "FeatureCollection",
    features: propsList.map((properties) => ({
      type: "Feature",
      geometry: null,
      properties,
    })),
  });
}

describe("canonZone — order-invariant digit⇄letter reconciliation", () => {
  it("reconciles every format of one letter+digit code to the SAME key (Matapédia/Mitis 'Ha' famille)", () => {
    const canon = "HA-20";
    for (const v of ["20 Ha", "20HA", "20-HA", "HA-20", "HA20", "Ha-020", "020-ha"]) {
      expect(canonZone(v)).toBe(canon);
    }
  });

  it("ANTI-FUSION: distinct digit blocks never merge (H-1 ≠ H-10)", () => {
    expect(canonZone("H-1")).toBe("H-1");
    expect(canonZone("H-10")).toBe("H-10");
    expect(canonZone("H-1")).not.toBe(canonZone("H-10"));
  });

  it("ANTI-FUSION: multi-segment codes are kept strict (no reorder, never fused)", () => {
    // Three genuinely distinct multi-segment codes must stay three distinct keys.
    expect(canonZone("H-1-2")).toBe("H-1-2");
    expect(canonZone("H-2-1")).toBe("H-2-1");
    expect(canonZone("RA-2-1")).toBe("RA-2-1");
    expect(canonZone("20-A-1")).toBe("20-A-1"); // digit-first multi-segment: unchanged
    const set = new Set(["H-1-2", "H-2-1", "RA-2-1", "20-A-1"].map(canonZone));
    expect(set.size).toBe(4);
  });

  it("zero-pad reconciliation still holds and does not over-merge", () => {
    expect(canonZone("A-01")).toBe("A-1");
    expect(canonZone("A-1")).toBe("A-1");
    expect(canonZone("A-10")).toBe("A-10"); // trailing zero preserved
    expect(canonZone("A-1")).not.toBe(canonZone("A-10"));
  });

  it("pure-numeric and pure-alpha codes pass through unchanged", () => {
    expect(canonZone("200")).toBe("200");
    expect(canonZone("HA")).toBe("HA");
  });
});

describe("sigZoneCodesFromGeojson — widened, curated zone-code field set", () => {
  it("reads a grille whose codes live under `Zonage` (the field the old regex missed)", () => {
    const set = sigZoneCodesFromGeojson(
      fc([{ Zonage: "H-4" }, { Zonage: "C-2" }, { Zonage: "I-3" }, { Zonage: "H-4" }]),
    );
    expect(set).toEqual(new Set(["H-4", "C-2", "I-3"]));
  });

  it("also reads the ZONAGE / CODE_ZONE / NO_ZONAGE variants", () => {
    expect(sigZoneCodesFromGeojson(fc([{ ZONAGE: "RA-1" }, { ZONAGE: "RA-2" }, { ZONAGE: "P-1" }]))).toEqual(
      new Set(["RA-1", "RA-2", "P-1"]),
    );
    expect(
      sigZoneCodesFromGeojson(fc([{ CODE_ZONE: "H-10" }, { CODE_ZONE: "H-11" }, { CODE_ZONE: "H-12" }])),
    ).toEqual(new Set(["H-10", "H-11", "H-12"]));
    expect(
      sigZoneCodesFromGeojson(fc([{ NO_ZONAGE: "M-1" }, { NO_ZONAGE: "M-2" }, { NO_ZONAGE: "M-3" }])),
    ).toEqual(new Set(["M-1", "M-2", "M-3"]));
  });

  it("still reads the legacy zone_code / ZONE fields (no regression)", () => {
    expect(sigZoneCodesFromGeojson(fc([{ zone_code: "A-1" }, { zone_code: "A-2" }, { zone_code: "A-3" }]))).toEqual(
      new Set(["A-1", "A-2", "A-3"]),
    );
    expect(sigZoneCodesFromGeojson(fc([{ ZONE: "20 Ha" }, { ZONE: "21 Ha" }, { ZONE: "22 Ha" }]))).toEqual(
      new Set(["HA-20", "HA-21", "HA-22"]),
    );
  });

  it("ANTI-INVENTION: an AFFECTATION layer (no zone-code field) yields NO codes", () => {
    // The exact shape of the repentigny/beaupre S3 slices: affectation names +
    // usages + descriptions, but NOT a real zone-code field. Must return ∅ so the
    // overlap gate is not fed fabricated 'codes' from an affectation column.
    const set = sigZoneCodesFromGeojson(
      fc([
        { Affectation: "Périmètre d'urbanisation", Usages: "les industries légères…", Categorie: "Perimetres_urbains.shp" },
        { Affectation: "Récréation intensive 1", Usages: "la récréation extensive…", Categorie: "Affectations_forestier.shp" },
        { Affectation: "Conservation", Usages: "l'interprétation de la nature…", Vocation: "Pole" },
      ]),
    );
    expect(set.size).toBe(0);
  });

  it("ANTI-INVENTION: unions the code column, never a whitelisted GUID/description neighbour", () => {
    // `zone_id` holds GUIDs (a non-code column → skipped); `Zonage` holds real codes.
    const set = sigZoneCodesFromGeojson(
      fc([
        { zone_id: "7c7bf375-e17b-4d6d-8a2d-460eb0abfeb8", Zonage: "H-101" },
        { zone_id: "083a6b1c-6fc5-40c5-ae1e-c10a24c17b87", Zonage: "H-102" },
        { zone_id: "af40a1db-530f-4709-a1a3-1af14188ccab", Zonage: "C-201" },
      ]),
    );
    expect(set).toEqual(new Set(["H-101", "H-102", "C-201"]));
  });

  it("NO REGRESSION: reads annotated codes like longueuil's `A12-024 (STH)` (secteur suffix)", () => {
    const set = sigZoneCodesFromGeojson(
      fc([
        { zone_code: "A12-024 (STH)" },
        { zone_code: "A15-032 (STH)" },
        { zone_code: "C31-003" },
        { zone_code: "H-1-103" },
      ]),
    );
    // Canonical set keeps every real code (the annotation/multi-segment forms survive).
    expect(set.size).toBe(4);
    expect(set.has(canonZone("A12-024 (STH)"))).toBe(true);
    expect(set.has(canonZone("H-1-103"))).toBe(true);
  });

  it("does NOT drop the real code column when a sequential-index column coexists", () => {
    // `NUM_ZONE` is a 1..N index; `Zonage` the real codes. Union keeps BOTH, so the
    // real codes are always present for the overlap check (best-single-field could
    // have mis-picked the fuller index column and false-rejected).
    const set = sigZoneCodesFromGeojson(
      fc([
        { NUM_ZONE: "1", Zonage: "H-4" },
        { NUM_ZONE: "2", Zonage: "C-2" },
        { NUM_ZONE: "3", Zonage: "I-3" },
      ]),
    );
    expect(set.has("H-4")).toBe(true);
    expect(set.has("C-2")).toBe(true);
    expect(set.has("I-3")).toBe(true);
  });

  it("falls back to the streaming regex on malformed (non-parseable) geojson", () => {
    // A truncated/streamed geojson body — still recovers the codes via regex.
    const broken = '{"features":[{"properties":{"Zonage":"H-7"}},{"properties":{"Zonage":"H-8"}},{"prope';
    expect(sigZoneCodesFromGeojson(broken)).toEqual(new Set(["H-7", "H-8"]));
  });
});

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
