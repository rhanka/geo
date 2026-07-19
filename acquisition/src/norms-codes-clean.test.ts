/**
 * Unit tests for the PURE grille-row → zone-code cleaning (cleanGrilleCode).
 *
 * The contract under test is anti-invention: strip an annotation the grille
 * extraction glued onto a real code, split a row shared by two zones, and DROP
 * anything that is not a zone token — never invent, extend or rename a code.
 */
import { describe, expect, it } from "vitest";

import { cleanGrilleCode } from "./norms-codes-clean.js";

describe("cleanGrilleCode", () => {
  it("keeps a clean lettered zone code verbatim", () => {
    expect(cleanGrilleCode("AF-3")).toEqual({ raw: "AF-3", kept: ["AF-3"], reason: "verbatim" });
  });

  it("strips a trailing grille footnote marker", () => {
    // eastman: the "(1,2)" refers to the grille's own notes, not to the zone.
    expect(cleanGrilleCode("RT-1 (1,2)").kept).toEqual(["RT-1"]);
    expect(cleanGrilleCode("RT-2 (1)").kept).toEqual(["RT-2"]);
    expect(cleanGrilleCode("R-11 (3)").kept).toEqual(["R-11"]);
  });

  it("strips a trailing repeal status, accent-insensitively", () => {
    expect(cleanGrilleCode("CONS-3 abrogé").kept).toEqual(["CONS-3"]);
    expect(cleanGrilleCode("RUR-13 abroge").kept).toEqual(["RUR-13"]);
    expect(cleanGrilleCode("A-1 Abrogé").kept).toEqual(["A-1"]);
  });

  it("splits a row shared by two zones into both", () => {
    const e = cleanGrilleCode("RT-3 ET RT-4");
    expect(e.kept).toEqual(["RT-3", "RT-4"]);
    expect(e.reason).toBe("shared-row-split");
  });

  it("accepts a NUMBER-DOMINANCE composite in either order", () => {
    expect(cleanGrilleCode("12-R").kept).toEqual(["12-R"]);
    expect(cleanGrilleCode("R-12").kept).toEqual(["R-12"]);
  });

  it("DROPS grille row labels that are not zones", () => {
    for (const row of [
      "Cour avant",
      "Cour arrière",
      "Chemin public et piste cyclable",
      "Immeuble Protégé (m)",
      "Maison d'habitation (m)",
      "Périmètre d'urbanisation, zones RT-1, RT-2, RT-3, RT-4, CONS-2, P-3, P-7, P-8, P-9 (m)",
    ]) {
      expect(cleanGrilleCode(row)).toEqual({ raw: row, kept: [], reason: "not-a-zone-token" });
    }
  });

  it("DROPS a bare prefix with no number (a legend vocation, not a zone)", () => {
    // "AF" / "RUR ET AF" are legend vocations; admitting them would let a
    // vocation letter stand in for a zone code.
    expect(cleanGrilleCode("AF").kept).toEqual([]);
    expect(cleanGrilleCode("RUR ET AF").kept).toEqual([]);
  });

  it("never invents or extends a series", () => {
    // A single dict row yields at most the codes literally written in it.
    expect(cleanGrilleCode("R-1").kept).toEqual(["R-1"]);
    expect(cleanGrilleCode("R-1 à R-9").kept).toEqual([]);
  });
});
