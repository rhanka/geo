import { describe, expect, it } from "vitest";

import type { FieldProvenanceT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

import {
  bandRole,
  bridgeZoneCode,
  buildZoneNorms,
  locateFieldColumns,
  parseMergeSpans,
  pickFieldValue,
  resolveMergedRow,
  type BandCell,
  type MergeSpan,
} from "./zonage-norms-vdq-xlsx-ingest.js";

const PROV: FieldProvenanceT = {
  source_url: "https://carte.ville.quebec.qc.ca/DonneesOuvertes/vdq-zonage-grille.xlsx",
  methode: "native-xlsx/vdq-open-data",
  snapshot: "2026-07-17",
  page: "11001Ra",
};

/** Shorthand for one band's cell. */
const cell = (band: string, value: string, col = 0): BandCell => ({
  band,
  role: bandRole(band),
  value,
  col,
});

const GEN = "Normes d'implantation générales";
const PART = "Normes d'implantation particulières";

describe("bandRole", () => {
  it("names the générale / particulière bands from their merged label", () => {
    expect(bandRole(GEN)).toBe("generale");
    expect(bandRole(PART)).toBe("particuliere");
    expect(bandRole("Dimension du bâtiment principal – Dimensions générales")).toBe("generale");
    expect(bandRole("Dimension du bâtiment principal – Dimensions particulières")).toBe(
      "particuliere",
    );
    // Unknown / unnamed bands are honestly reported as such (never guessed).
    expect(bandRole("Marge de recul à l'axe")).toBe("inconnu");
    expect(bandRole("")).toBe("inconnu");
  });
});

describe("pickFieldValue — the multi-band rule (anti-column-shift, design §6)", () => {
  it("publishes the value VERBATIM when exactly one band is non-empty", () => {
    const f = pickFieldValue([cell(GEN, "6"), cell(PART, "")], "m", PROV);
    expect(f.value).toBe(6);
    expect(f.raw).toBe("6");
    expect(f.unit).toBe("m");
    expect(f.confidence).toBe(1);
    expect(f.flag).toBeUndefined();
  });

  it("publishes the value when several bands of the same role CONCUR", () => {
    const f = pickFieldValue([cell(GEN, "7,5", 10), cell(GEN, "7,5", 20)], "m", PROV);
    expect(f.value).toBe(7.5); // FR decimal comma honoured by the frozen normaliser
    expect(f.flag).toBeUndefined();
  });

  it("REFUSES (null + flag) when several bands of the same role DIVERGE — never chooses", () => {
    const f = pickFieldValue([cell(GEN, "6", 10), cell(GEN, "9", 20)], "m", PROV);
    expect(f.value).toBeNull();
    expect(f.flag).toBe("bandes-divergentes");
    // Both verbatim readings are kept so the divergence is auditable.
    expect(f.raw).toContain("6");
    expect(f.raw).toContain("9");
  });

  it("flags a null (never 0) when no band carries a value", () => {
    const f = pickFieldValue([cell(GEN, ""), cell(PART, "")], "m", PROV);
    expect(f.value).toBeNull();
    expect(f.flag).toBe("absent");
    expect(f.value).not.toBe(0);
  });

  it("never publishes a PARTICULIÈRE value as the zone's norm, but keeps it in raw", () => {
    // The particulière band is qualified by a use sub-group selector: it is not
    // this zone's unconditional norm, so it must NOT be published as one.
    const f = pickFieldValue([cell(GEN, ""), cell(PART, "10.5")], "m", PROV);
    expect(f.value).toBeNull();
    expect(f.flag).toBe("conditionnel-particulier");
    expect(f.raw).toBe("10.5");
  });

  it("prefers the GÉNÉRALE band over a divergent PARTICULIÈRE one (proven by merges)", () => {
    // Real shape: zone 22236Ha — général 11, particulière 12.5 for "H1 en rangée".
    const f = pickFieldValue([cell(GEN, "11", 214), cell(PART, "12.5", 223)], "m", PROV);
    expect(f.value).toBe(11);
    expect(f.flag).toBeUndefined();
  });

  it("refuses a multi-line cell whose lines DIVERGE, publishes when they agree", () => {
    const diverge = pickFieldValue([cell(GEN, "9\r\n15")], "m", PROV);
    expect(diverge.value).toBeNull();
    expect(diverge.flag).toBe("multi-valeur");
    expect(diverge.raw).toBe("9\r\n15");

    const agree = pickFieldValue([cell(GEN, "10.5\r\n10.5")], "m", PROV);
    expect(agree.value).toBe(10.5);
    expect(agree.flag).toBeUndefined();
  });

  it("falls back to the multi-band rule when NO band is named (template change)", () => {
    const one = pickFieldValue([cell("Bande X", "4"), cell("Bande Y", "")], "m", PROV);
    expect(one.value).toBe(4);
    const diverge = pickFieldValue([cell("Bande X", "4"), cell("Bande Y", "8")], "m", PROV);
    expect(diverge.value).toBeNull();
    expect(diverge.flag).toBe("bandes-divergentes");
  });

  it("maps 's.o.' to null and NEVER to 0 (frozen normaliser)", () => {
    const f = pickFieldValue([cell(GEN, "s.o.")], "m", PROV);
    expect(f.value).toBeNull();
    expect(f.value).not.toBe(0);
  });

  it("keeps raw + flags a non-numeric cell rather than lifting a digit out of prose", () => {
    const f = pickFieldValue([cell(GEN, "voir note 5")], "m", PROV);
    expect(f.value).toBeNull();
    expect(f.flag).toBe("non-numerique");
    expect(f.raw).toBe("voir note 5");
  });
});

describe("bridgeZoneCode", () => {
  it("bridges the digit-first XLSX code to the canonical LETTER-NUMBER served form", () => {
    expect(bridgeZoneCode("11001Ra")).toBe("Ra-11001");
    expect(bridgeZoneCode("11004Mc")).toBe("Mc-11004");
  });

  it("delegates the surface form to the shared canon — never re-cases it", () => {
    // `zonage-canon-serve-run.ts` canonicalises the SIG with the SAME
    // (non-re-casing) `canonZoneCodeServe`. A hand-rolled "RA-11001" would pass
    // the canonical overlap gate and still fold to 0% at immo's EXACT join.
    expect(bridgeZoneCode("11001Ra")).not.toBe("RA-11001");
  });

  it("returns null for a non-code cell (skipped, never invented)", () => {
    expect(bridgeZoneCode("")).toBeNull();
    expect(bridgeZoneCode("Zone")).toBeNull();
    expect(bridgeZoneCode("Total des zones")).toBeNull();
  });
});

describe("merged-header resolution", () => {
  it("parses <mergeCells> into 0-based columns / 1-based rows", () => {
    const spans = parseMergeSpans(
      '<mergeCells count="2"><mergeCell ref="A1:C1"/><mergeCell ref="D2:E2"/></mergeCells>',
    );
    expect(spans).toEqual([
      { c1: 0, r1: 1, c2: 2, r2: 1 },
      { c1: 3, r1: 2, c2: 4, r2: 2 },
    ]);
  });

  it("expands a merged label across ITS span only — never bleeds into a gap", () => {
    const rows = [["SECTION", "", "", "", "AUTRE"]];
    const merges: MergeSpan[] = [{ c1: 0, r1: 1, c2: 2, r2: 1 }];
    // Column 3 is outside the span: a carry-forward would wrongly label it
    // "SECTION"; the merge-driven resolution leaves it empty (the §6 guard).
    expect(resolveMergedRow(rows, merges, 1, 5)).toEqual(["SECTION", "SECTION", "SECTION", "", "AUTRE"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  End-to-end on a TINY hand-built fixture mirroring the real sheet's shape.
// ───────────────────────────────────────────────────────────────────────────

/**
 * A 6-column miniature of the real layout:
 *   col 0 Zone | col 1 règlement | col 2 LOT "Largeur min.(m)" (générale)
 *   col 3 BÂT "Largeur min. (m)" (générale — the building width DECOY)
 *   col 4 BÂT "Hauteur max. (m)" (générale) | col 5 BÂT "Hauteur max. (m)" (particulière)
 */
function fixture(): { rows: string[][]; merges: MergeSpan[] } {
  const rows: string[][] = [
    ["", "", "NORMES DE LOTISSEMENT", "BÂTIMENT PRINCIPAL", "", ""],
    ["", "", "Dimensions générales", "Dimension du bâtiment principal – Dimensions générales", "", "Dimension du bâtiment principal – Dimensions particulières"],
    ["", "", "", "", "", ""],
    ["Zone", "Dernier règlement ayant modifié la zone", "Largeur min.(m)", "Largeur min. (m)", "Hauteur max. (m)", "Hauteur max. (m)"],
    ["11001Ra", "R.V.Q. 2910", "15", "8", "11", "12.5"],
    ["36006Ha", "R.V.Q. 3540", "", "", "9", "15"],
    ["Total", "", "", "", "", ""],
  ];
  const merges: MergeSpan[] = [
    { c1: 3, r1: 1, c2: 5, r2: 1 }, // "BÂTIMENT PRINCIPAL" spans cols 3-5
    { c1: 3, r1: 2, c2: 4, r2: 2 }, // building "générales" band spans cols 3-4
  ];
  return { rows, merges };
}

describe("buildZoneNorms (tiny fixture, not the 8 MB workbook)", () => {
  const { rows, merges } = fixture();
  const built = buildZoneNorms(rows, merges, {
    source_url: PROV.source_url,
    snapshot: "2026-07-17",
  });

  it("bridges zone codes and skips the non-code footer row", () => {
    expect(built.zones.map((z) => z.zone_code)).toEqual(["Ra-11001", "Ha-36006"]);
    expect(built.skippedRows).toBe(1); // "Total"
    // zone_page keeps the VERBATIM sheet code so a row stays traceable.
    expect(built.zones[0].zone_page).toBe("11001Ra");
  });

  it("reads the LOT frontage, NOT the building width (the column-shift trap)", () => {
    // Both columns are headed "Largeur min." — only the merged SECTION tells them
    // apart. 15 is the lot's frontage; 8 is the building width and must not leak.
    expect(built.zones[0].frontage_min?.value).toBe(15);
    expect(built.zones[0].frontage_min?.value).not.toBe(8);
  });

  it("publishes the GÉNÉRALE hauteur_max and ignores the PARTICULIÈRE twin", () => {
    expect(built.zones[0].hauteur_max?.value).toBe(11);
    expect(built.zones[0].hauteur_max?.unit).toBe("m");
    expect(built.zones[0].hauteur_max?._provenance.methode).toBe("native-xlsx/vdq-open-data");
  });

  it("refuses (null) when only the conditional PARTICULIÈRE band has a value", () => {
    const z = built.zones[1];
    expect(z.frontage_min?.value).toBeNull();
    expect(z.frontage_min?.flag).toBe("absent");
    // hauteur_max: général 9 wins over the particulière 15.
    expect(z.hauteur_max?.value).toBe(9);
  });

  it("captures the PER-ZONE règlement provenance verbatim", () => {
    expect(built.reglementByZone.get("Ra-11001")).toBe("R.V.Q. 2910");
    expect(built.reglementByZone.get("Ha-36006")).toBe("R.V.Q. 3540");
  });

  it("locates each field's columns with the band role resolved from the merges", () => {
    expect(built.located.get("hauteur_max")).toEqual([
      { col: 4, band: "Dimension du bâtiment principal – Dimensions générales", role: "generale" },
      { col: 5, band: "Dimension du bâtiment principal – Dimensions particulières", role: "particuliere" },
    ]);
    expect(built.located.get("frontage_min")?.map((c) => c.col)).toEqual([2]);
  });

  it("leaves usages empty (a Dominante letter is not a use label)", () => {
    expect(built.zones[0].usages).toEqual([]);
  });
});

describe("locateFieldColumns", () => {
  it("does not match a header outside its declared section", () => {
    const section = ["BÂTIMENT PRINCIPAL"];
    const band = ["Dimensions générales"];
    const header = ["Sup. min. (m2)"]; // a superficie under the BUILDING section
    // superficie_min is anchored on the LOTISSEMENT section → no match here.
    expect(locateFieldColumns(section, band, header, 1).get("superficie_min")).toBeUndefined();
  });
});
