import { describe, it, expect } from "vitest";

import {
  reparseNormRow,
  reparseNormRows,
  REPARSE_RAW_CONFIDENCE,
  REPARSE_METHODE_TAG,
} from "./zonage-norms-reparse.js";

/** A flat norms row shaped like the deposited MT parquet (zone TM-105). */
function mtRow(): Record<string, unknown> {
  return {
    zone_code: "TM-105",
    zone_page: "ZONE TM-105",
    // divergence-2-passes left value/unit null + confidence 0 but kept the raw:
    densite_value: null,
    densite_raw: "90 / -",
    densite_unit: null,
    densite_confidence: 0,
    frontage_min_value: null,
    frontage_min_raw: "20",
    frontage_min_unit: null,
    frontage_min_confidence: 0,
    superficie_min_value: null,
    superficie_min_raw: "800",
    superficie_min_unit: null,
    superficie_min_confidence: 0,
    // concordant 2-pass values already published — MUST be preserved:
    hauteur_max_value: 1,
    hauteur_max_raw: "1 / 2",
    hauteur_max_unit: "etages",
    hauteur_max_confidence: 0.92,
    marge_avant_min_value: 8,
    marge_avant_min_raw: "8",
    marge_avant_min_unit: "m",
    marge_avant_min_confidence: 0.92,
    _source_url: "https://example.qc/grille.pdf",
    _methode: "mistral-vision",
    _snapshot: "2026-06",
  };
}

describe("reparseNormRow — strict raw→value re-parse (anti-invention)", () => {
  it("(a) republishes ONLY the value the stored raw carries", () => {
    const { row, filled } = reparseNormRow(mtRow());
    expect(row["densite_value"]).toBe(90); // "90 / -" → 90
    expect(row["frontage_min_value"]).toBe(20); // "20" → 20 (m)
    expect(row["frontage_min_unit"]).toBe("m");
    expect(row["superficie_min_value"]).toBe(800); // "800" → 800 (m²)
    expect(row["superficie_min_unit"]).toBe("m2");
    expect(filled.sort()).toEqual(["densite", "frontage_min", "superficie_min"]);
  });

  it("(b) fill-nulls-only: NEVER overwrites a concordant 2-pass value", () => {
    const { row } = reparseNormRow(mtRow());
    expect(row["hauteur_max_value"]).toBe(1);
    expect(row["hauteur_max_confidence"]).toBe(0.92); // untouched
    expect(row["marge_avant_min_value"]).toBe(8);
    expect(row["marge_avant_min_confidence"]).toBe(0.92); // untouched
  });

  it("(c) marks re-parsed fields with a distinct single-read confidence + methode tag", () => {
    const { row } = reparseNormRow(mtRow());
    expect(row["densite_confidence"]).toBe(REPARSE_RAW_CONFIDENCE);
    expect(REPARSE_RAW_CONFIDENCE).toBeLessThan(0.92); // distinct from 2-pass
    expect(row["frontage_min_confidence"]).toBe(REPARSE_RAW_CONFIDENCE);
    expect(String(row["_methode"])).toContain(REPARSE_METHODE_TAG);
    expect(String(row["_methode"])).toContain("mistral-vision"); // original kept
  });

  it("(d) is idempotent — a second pass fills nothing and re-tags nothing", () => {
    const first = reparseNormRow(mtRow()).row;
    const second = reparseNormRow(first);
    expect(second.filled).toEqual([]);
    expect(second.row).toEqual(first);
    expect(String(second.row["_methode"])).toBe("mistral-vision+reparse-raw");
  });

  it("(a) leaves a non-numeric / unparsable raw null — never invents", () => {
    const row = {
      densite_value: null,
      densite_raw: "voir grille",
      frontage_min_value: null,
      frontage_min_raw: "à déterminer",
      frontage_min_unit: null,
      superficie_min_value: null,
      superficie_min_raw: null, // no raw at all
    };
    const out = reparseNormRow(row);
    expect(out.row["densite_value"]).toBeNull();
    expect(out.row["frontage_min_value"]).toBeNull();
    expect(out.row["superficie_min_value"]).toBeNull();
    expect(out.filled).toEqual([]);
    expect(out.row["_methode"]).toBeUndefined(); // no fill → no tag
  });

  it("skips hauteur when its stored unit is ambiguous (never guesses étages vs m)", () => {
    const row = {
      hauteur_max_value: null,
      hauteur_max_raw: "10",
      hauteur_max_unit: null, // ambiguous — could be m or étages
    };
    const out = reparseNormRow(row);
    expect(out.row["hauteur_max_value"]).toBeNull();
    expect(out.filled).toEqual([]);
  });

  it("refuses an out-of-window value (plausibility guard still applies)", () => {
    // densité is a percentage in [0,100]; 900 is out of range → refused.
    const out = reparseNormRow({ densite_value: null, densite_raw: "900" });
    expect(out.row["densite_value"]).toBeNull();
    expect(out.filled).toEqual([]);
  });
});

describe("reparseNormRows — aggregate", () => {
  it("counts filled fields per name and changed rows", () => {
    const res = reparseNormRows([mtRow(), mtRow()]);
    expect(res.rowsChanged).toBe(2);
    expect(res.filledByField).toEqual({ densite: 2, frontage_min: 2, superficie_min: 2 });
  });
});
