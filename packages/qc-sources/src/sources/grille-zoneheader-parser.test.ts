import { describe, it, expect } from "vitest";

import {
  extractNormValue,
  resolveField,
  detectSection,
  parseLabelValueGrillePage,
} from "./grille-zoneheader-parser.js";
import type { ZoneNormsT } from "./grille-specifications-parser.js";

const OPTS = { source_url: "https://ex/durham.pdf", snapshot: "2026-07-03" };

// ─────────────────────────────────────────────────────────────────────────────
//  extractNormValue — leftmost value + canonical unit, both sub-layouts.
// ─────────────────────────────────────────────────────────────────────────────

describe("extractNormValue", () => {
  it("reads a trailing '<value> <unit-word>' (durham layout)", () => {
    expect(extractNormValue("Marge de recul avant minimale              10 mètres")).toEqual({
      label: "Marge de recul avant minimale",
      raw: "10 m",
      unit: "m",
    });
  });

  it("folds spelled-out 'mètres carrés' → m2 (else the area guard rejects it)", () => {
    const r = extractNormValue("Superficie minimale                        1500 mètres carrés");
    expect(r?.raw).toBe("1500 m2");
    expect(r?.unit).toBe("m2");
  });

  it("keeps the FR decimal comma verbatim", () => {
    expect(extractNormValue("Marge arrière minimale   7,5 mètres")?.raw).toBe("7,5 m");
  });

  it("reads a BARE 'm' abbreviation (beaupré/weblex '10 m' / '9m')", () => {
    expect(extractNormValue("Marge de recul avant minimale        10 m")).toEqual({
      label: "Marge de recul avant minimale",
      raw: "10 m",
      unit: "m",
    });
    expect(extractNormValue("Marge de recul arrière minimale     9m")?.raw).toBe("9 m");
  });

  it("captures a FR thousands-space number in full ('7 500' → 7500, not 500)", () => {
    const r = extractNormValue("Superficie minimum du lot            7 500 m²");
    expect(r?.raw).toBe("7500 m2");
    expect(r?.unit).toBe("m2");
  });

  it("reads unit-in-paren + takes the LEFTMOST value column (lachute/blainville)", () => {
    expect(extractNormValue("Frontage minimum                 (m)        45       45       45")).toEqual({
      label: "Frontage minimum",
      raw: "45 m",
      unit: "m",
    });
    expect(extractNormValue("Superficie minimum   (m2)   3000   3000   3000")?.raw).toBe("3000 m2");
  });

  it("keeps min/max qualifiers that sit after a paren unit", () => {
    expect(extractNormValue("Hauteur (étages)                 max.          2              2")).toEqual({
      label: "Hauteur max.",
      raw: "2 etages",
      unit: "etages",
    });
  });

  it("flags a dwelling density 'log / ha' as LOGHA (≠ emprise-au-sol %)", () => {
    const r = extractNormValue("Densité d'occupation du sol                6 log / ha");
    expect(r?.unit).toBe("LOGHA");
  });

  it("returns the absent marker for an empty leftmost cell", () => {
    expect(extractNormValue("Avant maximum   (m)   —   —   —")?.raw).toBe("—");
  });

  it("returns null for a usages / prose line with no numeric value", () => {
    expect(extractNormValue("H1 Unifamiliale isolée")).toBeNull();
    expect(extractNormValue("A- Usages autorisés")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  resolveField — self-describing labels + section + hauteur-by-unit + guards.
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveField", () => {
  it("maps durham self-describing labels directly", () => {
    expect(resolveField("Marge de recul avant minimale", "other", "m")).toBe("marge_avant_min");
    expect(resolveField("Largeur minimale", "other", "m")).toBe("frontage_min");
    expect(resolveField("Superficie minimale", "other", "m2")).toBe("superficie_min");
  });

  it("maps a bare 'Hauteur maximale' by its VALUE unit (mètres → hauteur_metres)", () => {
    expect(resolveField("Hauteur maximale", "other", "m")).toBe("hauteur_metres");
    expect(resolveField("Hauteur maximale", "other", "etages")).toBe("hauteur_etages");
  });

  it("lets the VALUE unit override an étages-labelled combined cap ('3 étages et 11 m')", () => {
    // The metric bound was captured ("11 m"), so publish hauteur_metres — NOT the
    // étages spec that would reject "11 m" as unite-incoherente.
    expect(resolveField("Hauteur maximale 3 étages et", "batiment", "m")).toBe("hauteur_metres");
  });

  it("maps terse marges only under the MARGES section (lachute/blainville)", () => {
    expect(resolveField("Avant minimale", "marges", "m")).toBe("marge_avant_min");
    expect(resolveField("Latérale minimale", "marges", "m")).toBe("marge_laterale_min");
    expect(resolveField("Avant minimale", "other", "m")).toBeNull(); // no section → no guess
  });

  it("REFUSES a 'somme des marges' (its own norm, anti-over-mapping)", () => {
    expect(resolveField("Somme des marges latérales", "marges", "m")).toBeNull();
  });

  it("REFUSES a dwelling-density 'log/ha' value → null (not emprise %)", () => {
    expect(resolveField("Densité d'occupation du sol", "rapports", "LOGHA")).toBeNull();
  });
});

describe("detectSection", () => {
  it("tracks the rotated / numbered section bands", () => {
    expect(detectSection("Marges", "other")).toBe("marges");
    expect(detectSection("TERRAIN", "other")).toBe("terrain");
    expect(detectSection("Dimensions", "other")).toBe("terrain");
    expect(detectSection("Hauteur", "other")).toBe("batiment");
    expect(detectSection("a plain prose line", "marges")).toBe("marges"); // unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  parseLabelValueGrillePage — the durham proof + anti-invention.
// ─────────────────────────────────────────────────────────────────────────────

const DURHAM_PAGE = `
                             Dispositions applicables à la zone :

                                                                        H-11

  Usages autorisés                     Normes relatives aux marges de recul
H1 Unifamiliale isolée       Marge de recul avant minimale              10 mètres
H2 Unifamiliale jumelée      Marge de recul arrière minimale            7,5 mètres
H3 Bifamiliale isolée        Marge de recul latérale minimale           2 mètres
H4 Habitation                Somme des marges latérales                 4 mètres
H5 Habitation                Hauteur maximale                           9 mètres
                                       Normes de lotissement
C7 Gîte                      Largeur minimale                           25 mètres
C8 Hébergement               Superficie minimale                        1500 mètres carrés
C10 Artisanat                Densité d'occupation du sol                6 log / ha
`;

describe("parseLabelValueGrillePage — durham-sud proof (publishedFieldPct 0 → >0)", () => {
  const zs = parseLabelValueGrillePage(DURHAM_PAGE, 1, OPTS);
  const z = zs[0] as ZoneNormsT;

  it("recovers the verbatim zone_code from the header", () => {
    expect(zs).toHaveLength(1);
    expect(z.zone_code).toBe("H-11");
  });

  it("MAPS the label:value norms (this is the unblock)", () => {
    // A NormField is `NormFieldT | null` by contract: null = the field was never
    // emitted at all, a published field with `.value === null` = read but refused.
    // This parser always emits the field OBJECT, so assert that first (the test
    // fails here if a field ever goes missing) and only then read `.value`.
    expect(z.marges.avant_min).not.toBeNull();
    expect(z.marges.arriere_min).not.toBeNull();
    expect(z.marges.laterale_min).not.toBeNull();
    expect(z.hauteur_max).not.toBeNull();
    expect(z.frontage_min).not.toBeNull();
    expect(z.superficie_min).not.toBeNull();
    expect(z.marges.avant_min!.value).toBe(10);
    expect(z.marges.arriere_min!.value).toBe(7.5);
    expect(z.marges.laterale_min!.value).toBe(2);
    expect(z.hauteur_max!.value).toBe(9);
    expect(z.hauteur_max!.unit).toBe("m");
    expect(z.frontage_min!.value).toBe(25);
    expect(z.superficie_min!.value).toBe(1500);
    expect(z.superficie_min!.unit).toBe("m2");
  });

  it("does NOT fold the 'somme des marges' into a marge minimum (anti-over-mapping)", () => {
    // The only latéral value published is the 2 m minimum, never the 4 m sum.
    expect(z.marges.laterale_min).not.toBeNull();
    expect(z.marges.laterale_min!.value).toBe(2);
  });

  it("leaves densité null on a 'log/ha' dwelling density (not emprise %)", () => {
    // The field is PUBLISHED (the label was read) but its value is refused.
    expect(z.densite).not.toBeNull();
    expect(z.densite!.value).toBeNull();
  });

  it("publishes a non-zero field count (defeats the zero-norm-fields reject gate)", () => {
    const n = [
      z.densite,
      z.hauteur_max,
      z.frontage_min,
      z.superficie_min,
      z.marges.avant_min,
      z.marges.laterale_min,
      z.marges.arriere_min,
    ].filter((f) => f && f.value !== null).length;
    expect(n).toBeGreaterThan(0);
  });

  it("emits nothing when there is no header code (anti-invention: no header, no zone)", () => {
    expect(parseLabelValueGrillePage("just some prose with a 10 mètres value", 1, OPTS)).toEqual([]);
  });
});
