/**
 * Unit tests for the anti-invention cross-check rule (`shouldRejectForZeroOverlap`).
 *
 * Regression guard for the kirkland case: the OCR read row LABELS as zone codes,
 * producing ≥3 distinct strings (so the count gate passed) but overlap=0 against
 * the SIG/reglement grille — pure fabrication that must be rejected before deposit.
 */
import { describe, it, expect } from "vitest";

import { canonicalizeZoneCodeForJoin } from "@sentropic/geo";

import {
  shouldRejectForZeroOverlap,
  shouldRejectForZeroNormFields,
  looksLikeTableOfContents,
  canonZone,
  sigZoneCodesFromGeojson,
  zoneNumberKey,
  reconcileZoneNumbers,
  overlapWithNumericBridge,
} from "./zonage-norms.js";

/** Canonicalize an array of raw codes into the SIG/extracted canonical Set. */
function canonSet(codes: string[]): Set<string> {
  return new Set(codes.map(canonZone));
}

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

  describe("fix #2 — trailing presentational annotation (Longueuil STH/VLO/GP)", () => {
    it("BRIDGE: a code and its arrondissement-annotated form collapse to ONE key", () => {
      // Longueuil's SIG appends a redundant " (STH)"/" (VLO)"/" (GP)" arrondissement
      // label to the grille's bare code; the numeric core already identifies the zone.
      expect(canonZone("A12-024 (STH)")).toBe(canonZone("A12-024"));
      expect(canonZone("H34-327 (VLO)")).toBe(canonZone("H34-327"));
      expect(canonZone("C31-003 (GP)")).toBe(canonZone("C31-003"));
      // Whitespace variants of the annotation still collapse.
      expect(canonZone("A12-024(STH)")).toBe(canonZone("A12-024"));
      expect(canonZone("A12-024  (STH) ")).toBe(canonZone("A12-024"));
    });

    it("ANTI-FUSION: the annotation strip NEVER touches the code core", () => {
      // Same annotation, DIFFERENT core → still two distinct keys.
      expect(canonZone("A12-024 (STH)")).not.toBe(canonZone("A12-025 (STH)"));
      // Different arrondissement district prefix → distinct (12 vs 34).
      expect(canonZone("A12-024 (STH)")).not.toBe(canonZone("A34-024 (VLO)"));
      // The whole Longueuil famille stays fully distinct after stripping.
      const set = new Set(
        ["A12-024 (STH)", "A12-025 (STH)", "A34-024 (VLO)", "H34-327 (VLO)"].map(canonZone),
      );
      expect(set.size).toBe(4);
    });

    it("ANTI-FUSION: a DASH secteur suffix is NOT an annotation (mont-royal H-531-F ≠ H-531-G)", () => {
      // mont-royal's SIG subdivides a base zone into dash-suffixed secteurs; these are
      // distinct multi-segment codes, NOT a parenthetical presentation label.
      expect(canonZone("H-531-F")).not.toBe(canonZone("H-531-G"));
      expect(canonZone("H-531-F")).not.toBe(canonZone("H-531"));
      expect(new Set(["H-531", "H-531-F", "H-531-G"].map(canonZone)).size).toBe(3);
    });
  });

  describe("ANTI-INVENTION: genuinely different code schemes stay disjoint (never bridged)", () => {
    it("a bare-number SIG code is NOT the letter-prefixed grille code (shefford R-1 ≠ 1)", () => {
      // shefford's SIG is a sequential/bare-number layer (1..13); the grille uses
      // AF-1/M-3/R-1 — stripping the usage letter would fuse AF-1, M-1, R-1 → forbidden.
      expect(canonZone("R-1")).not.toBe(canonZone("1"));
      expect(new Set(["AF-1", "M-1", "R-1", "1"].map(canonZone)).size).toBe(4);
    });

    it("a low grille number is NOT a three-digit secteur SIG number (deux-montagnes H1 ≠ H-100)", () => {
      // deux-montagnes grille H1..H8 vs SIG H-100/H-108 (by-hundreds secteur numbering):
      // a different by-law vintage, NOT a format variant. H-1 must never equal H-100.
      expect(canonZone("H1")).not.toBe(canonZone("H-100"));
      expect(canonZone("H06")).not.toBe(canonZone("H-600"));
    });

    it("a letter-first grille code is NOT the same-letter digit-first SIG code at another number (saint-cuthbert A-1 ≠ 22A)", () => {
      // saint-cuthbert grille A-1..A-16 vs SIG 22A/23A (→ A-22/A-23). The digit⇄letter
      // reorder is already applied, but the NUMBERS differ, so they stay distinct.
      expect(canonZone("22A")).toBe("A-22");
      expect(canonZone("A-1")).not.toBe(canonZone("22A"));
    });
  });
});

describe("LOCKSTEP: canonZone === canonicalizeZoneCodeForJoin (gate ⇔ join, single source)", () => {
  // canonZone (deposit overlap gate) delegates to canonicalizeZoneCodeForJoin (runtime
  // lot⋈norms join). This is the anti-drift guard: the gate's reported overlap must be
  // byte-for-byte the overlap the join realizes. Any future divergence fails HERE.
  it("agrees code-for-code across every format family (incl. unicode dashes)", () => {
    const battery = [
      "H-1", "H01", "H-01", "H 1", "H1", "H–01", "H‐1", // en/hyphen dashes
      "HA-20", "HA20", "20HA", "20-HA", "20 Ha", "ha-020", "020-HA", "22A",
      "H-10", "H-100", "H-1-2", "RA-2-1", "20-A-1",
      "A12-024", "A12-024 (STH)", "H34-327 (VLO)", "H-531-F", "H-531-G",
      "CV-RF-106", "RA-106", "106", "URB", "MIXTE CENTRE", "200",
    ];
    for (const c of battery) {
      expect(canonZone(c)).toBe(canonicalizeZoneCodeForJoin(c));
    }
  });

  it("a unicode-dash SIG code reconciles to the ASCII-dash grille code (no false overlap=0)", () => {
    // Gate side previously left "H–1" (en-dash) un-normalised while the join folded it
    // to "H-1"; now both delegate, so the gate overlap equals the realized join match.
    expect(canonZone("H–1")).toBe(canonZone("H-1"));
    expect(canonZone("H–1")).toBe(canonicalizeZoneCodeForJoin("H-1"));
  });
});

describe("zoneNumberKey — the unambiguous single zone number", () => {
  it("extracts the one number regardless of letter prefix / vintage spelling", () => {
    // The Mont-Tremblant vintage family: same zone 106 written three ways.
    expect(zoneNumberKey("RA-106")).toBe("106");
    expect(zoneNumberKey("CV-RF-106")).toBe("106");
    expect(zoneNumberKey("106")).toBe("106");
    expect(zoneNumberKey("H-1")).toBe("1");
  });

  it("drops leading zeros so H-01 and H-1 share a number, H-1 and H-10 do not", () => {
    expect(zoneNumberKey("H-01")).toBe("1");
    expect(zoneNumberKey("H-1")).toBe("1");
    expect(zoneNumberKey("H-10")).toBe("10");
    expect(zoneNumberKey("H-1")).not.toBe(zoneNumberKey("H-10"));
  });

  it("returns null for a code with NO number or with ≥2 numbers (ambiguous identifier)", () => {
    expect(zoneNumberKey("URB")).toBeNull();
    expect(zoneNumberKey("HA")).toBeNull();
    expect(zoneNumberKey("A12-024")).toBeNull(); // two digit runs → ambiguous
    expect(zoneNumberKey("H-1-2")).toBeNull();
  });
});

describe("reconcileZoneNumbers / overlapWithNumericBridge — the millésime bridge", () => {
  it("BRIDGE: Mont-Tremblant — SIG secteur-composé CV-RF-106 ⇄ flat grille RA-106 (same n° 106)", () => {
    const extracted = canonSet(["RA-106", "RA-107", "RA-108"]);
    const sig = canonSet(["CV-RF-106", "CV-RF-107", "CV-RF-108"]);
    const res = overlapWithNumericBridge(extracted, sig);
    expect(res.exactOverlap).toBe(0);
    expect(res.numericBridged).toBe(3);
    expect(res.overlap).toBe(3);
    // The bridge maps the grille spelling to the SIG spelling of the SAME number.
    const bridge = res.bridges.find((b) => b.number === "106");
    expect(bridge).toEqual({ extracted: "RA-106", sig: "CV-RF-106", number: "106" });
  });

  it("BRIDGE: a bare-number SIG (repentigny-style vintage) meets a letter-prefixed grille", () => {
    const extracted = canonSet(["RB-12", "RB-13"]);
    const sig = canonSet(["12", "13"]);
    const res = overlapWithNumericBridge(extracted, sig);
    expect(res.overlap).toBe(2);
    expect(res.numericBridged).toBe(2);
  });

  it("adds to — never double-counts — the exact-canonical overlap", () => {
    const extracted = canonSet(["H-1", "RA-106"]); // H-1 exact, RA-106 bridges to CV-106
    const sig = canonSet(["H-1", "CV-106"]);
    const res = overlapWithNumericBridge(extracted, sig);
    expect(res.exactOverlap).toBe(1);
    expect(res.numericBridged).toBe(1);
    expect(res.overlap).toBe(2);
    expect(res.notMatched).toEqual([]);
  });

  it("ANTI-FUSION: different numbers never bridge (106 ≠ 1060, H-1 ≠ H-10)", () => {
    expect(overlapWithNumericBridge(canonSet(["RA-106"]), canonSet(["CV-1060"])).overlap).toBe(0);
    expect(overlapWithNumericBridge(canonSet(["H-1"]), canonSet(["X-10"])).overlap).toBe(0);
  });

  it("ANTI-FUSION: a number that is non-unique on the EXTRACTED side is never bridged (shefford AF-1/M-1/R-1)", () => {
    // shefford grille AF-1/M-1/R-1 (all number 1) vs a bare-number SIG {1}. The
    // number does not identify one zone on the grille side → refuse to guess.
    const extracted = canonSet(["AF-1", "M-1", "R-1"]);
    const sig = canonSet(["1", "2", "3"]);
    const res = overlapWithNumericBridge(extracted, sig);
    expect(res.numericBridged).toBe(0);
    expect(res.overlap).toBe(0);
  });

  it("ANTI-FUSION: a number that is non-unique on the SIG side is never bridged", () => {
    // SIG has RA-106 AND RB-106 (two distinct zones share number 106) → ambiguous.
    const extracted = canonSet(["X-106"]);
    const sig = canonSet(["RA-106", "RB-106"]);
    const res = overlapWithNumericBridge(extracted, sig);
    expect(res.numericBridged).toBe(0);
    expect(res.overlap).toBe(0);
  });

  it("ANTI-FUSION: multi-number codes (A12-024) are ineligible — no numeric fusion", () => {
    const extracted = canonSet(["A12-024"]);
    const sig = canonSet(["B12-024"]);
    const res = overlapWithNumericBridge(extracted, sig);
    expect(res.numericBridged).toBe(0);
    expect(res.overlap).toBe(0);
  });

  it("ANTI-INVENTION: non-overlapping vintages do not bridge (deux-montagnes H1..H8 vs H-100/H-108)", () => {
    const extracted = canonSet(["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8"]);
    const sig = canonSet(["H-100", "H-108"]);
    const res = overlapWithNumericBridge(extracted, sig);
    expect(res.overlap).toBe(0);
  });

  it("reconcileZoneNumbers surfaces only the genuine cross-vintage pairs", () => {
    const bridges = reconcileZoneNumbers(canonSet(["RA-106", "H-1"]), canonSet(["CV-106", "H-1"]));
    // H-1 is an exact match (skipped); only 106 bridges.
    expect(bridges).toEqual([{ extracted: "RA-106", sig: "CV-106", number: "106" }]);
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
