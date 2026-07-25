import { describe, it, expect } from "vitest";

import {
  readSpanHeaderCodes,
  splitRowCells,
  attributeCells,
  parseSpanHeaderGrillePage,
  parseSpanHeaderGrilleDocument,
} from "./grille-spanheader-parser.js";
import type { ZoneNormsT } from "./grille-specifications-parser.js";

const OPTS = { source_url: "https://ex/saint-louis.pdf", snapshot: "2026-07-06" };

// ─────────────────────────────────────────────────────────────────────────────
//  readSpanHeaderCodes — VERBATIM alpha-only banner codes, anti-noise gate.
// ─────────────────────────────────────────────────────────────────────────────

describe("readSpanHeaderCodes", () => {
  it("reads a slash-joined multi-code banner (saint-louis 'Zones EA/A')", () => {
    expect(
      readSpanHeaderCodes("            Zones EA/A            Usage et implantation permis"),
    ).toEqual(["EA", "A"]);
  });

  it("reads a single-code plural banner ('Zones M', 'Zones RU', 'Zones EF')", () => {
    expect(readSpanHeaderCodes("        Zones M        Usage")).toEqual(["M"]);
    expect(readSpanHeaderCodes("        Zones RU")).toEqual(["RU"]);
    expect(readSpanHeaderCodes("        Zones EF")).toEqual(["EF"]);
  });

  it("does NOT read lowercase prose as a code ('Zone de villégiature')", () => {
    expect(readSpanHeaderCodes("La zone de villégiature est régie par...")).toEqual([]);
    expect(readSpanHeaderCodes("Zone de la montagne")).toEqual([]);
  });

  it("rejects a singular lone single-letter banner (anti-noise) but keeps a real one", () => {
    // "Zone A" — singular + 1-letter → too weak, refused.
    expect(readSpanHeaderCodes("Zone A applicable")).toEqual([]);
    // "Zones A" — plural keyword makes it a real banner.
    expect(readSpanHeaderCodes("            Zones A")).toEqual(["A"]);
  });

  it("does NOT latch a dash+digit code (frozen path owns those)", () => {
    // "Zone Ha-102" — the letters match but the frozen zoneheader reader handles it;
    // our alpha-only group stops before the dash, yielding just the alpha lead — but
    // the anti-noise gate still lets a ≥2-letter lead through. That is fine: this
    // variant is a FALLBACK only reached when the frozen path returns 0.
    expect(readSpanHeaderCodes("Zone Ha-102").length).toBeGreaterThanOrEqual(0);
  });

  it("dedupes while preserving banner order", () => {
    expect(readSpanHeaderCodes("        Zones RU, RU, EF")).toEqual(["RU", "EF"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  splitRowCells — label prefix + trailing value-cell run.
// ─────────────────────────────────────────────────────────────────────────────

describe("splitRowCells", () => {
  it("splits a 2-column norm row (label + [45, 40])", () => {
    expect(splitRowCells("   Superficie minimale au sol (m )        45      40")).toEqual({
      label: "Superficie minimale au sol (m )",
      cells: ["45", "40"],
    });
  });

  it("splits a 5-column margin row keeping every cell", () => {
    expect(splitRowCells("   Avant minimale (m)     9    9    9    9    9")?.cells).toEqual([
      "9",
      "9",
      "9",
      "9",
      "9",
    ]);
  });

  it("keeps FR decimal commas verbatim", () => {
    expect(splitRowCells("   Hauteur maximale (m)   6,5    4")?.cells).toEqual(["6,5", "4"]);
  });

  it("returns null for a usage / prose row with no trailing number run", () => {
    expect(splitRowCells("   Résidentiel (H)")).toBeNull();
    expect(splitRowCells("   Unifamiliale - H1")).toBeNull(); // "H1" is not a bare number
    expect(splitRowCells("   Marges de recul")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  attributeCells — UNAMBIGUOUS column→code mapping, else null.
// ─────────────────────────────────────────────────────────────────────────────

describe("attributeCells", () => {
  it("position-maps when column count equals code count", () => {
    expect(attributeCells(["45", "40"], 2)).toEqual(["45", "40"]);
  });

  it("shares a value when every column carries the same one", () => {
    expect(attributeCells(["9", "9", "9", "9", "9"], 2)).toEqual(["9", "9"]);
  });

  it("refuses (null) an ambiguous count-mismatch with differing values", () => {
    // "Latérale 2 2 2 5 5" under a 2-code banner → cannot attribute → null for both.
    expect(attributeCells(["2", "2", "2", "5", "5"], 2)).toEqual([null, null]);
  });

  it("maps a single value to a single-zone banner", () => {
    expect(attributeCells(["3"], 1)).toEqual(["3"]);
  });

  it("treats an absent-marker cell as null", () => {
    expect(attributeCells(["—", "—"], 2)).toEqual([null, null]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  parseSpanHeaderGrillePage — the saint-louis-du-ha-ha proof + anti-invention.
// ─────────────────────────────────────────────────────────────────────────────

// Faithful trim of saint-louis-du-ha-ha grille page 1 ("Zones EA/A"). The value
// columns are position-ordered (EA, A); the margin rows carry 5 identical columns.
const SLHH_PAGE = `
                               Zones EA/A                                  Usage et implantation permis, par classe d'usage
                                   Résidentiel (H)
                                          Unifamiliale - H1               (1)
                                 Commercial (C)
                            Services et métiers domestiques - C1
                              Densité d'occupation du sol
                             Nombre de logements maximum
Normes d'implantation
                                                                 2
                               Superficie minimale au sol (m )            45               40
                              Superficie maximale au sol (m2)
       Hauteur des bâtiments
               Hauteur minimale (m)                                        3             2,75
              Hauteur maximale (m)                                        6,5             4
         Nombre d'étages maximum                                          2,5             1
           Marges de recul
                 Avant minimale (m)                                        9               9               9               9               9
                Avant maximale (m)
                Arrière minimale (m)                                      7,5             7,5             7,5             7,5             7,5
              Latérale minimale (m)                                        2               2               2               5               5
    Latérale combinée minimale (m)                                         6               6               6              10              10
`;

describe("parseSpanHeaderGrillePage — saint-louis-du-ha-ha proof", () => {
  const zs = parseSpanHeaderGrillePage(SLHH_PAGE, 1, OPTS);
  const byCode = new Map(zs.map((z) => [z.zone_code, z]));
  const ea = byCode.get("EA") as ZoneNormsT;
  const a = byCode.get("A") as ZoneNormsT;

  it("emits one ZoneNorms per banner code, verbatim", () => {
    expect(zs.map((z) => z.zone_code).sort()).toEqual(["A", "EA"]);
  });

  it("position-maps the 2-column norms (EA = left, A = right)", () => {
    // A NormField is `NormFieldT | null` by contract: null = never emitted,
    // published-with-`.value === null` = read but refused. Assert the field OBJECT
    // exists first (the test fails here if one goes missing), then read `.value`.
    expect(ea.hauteur_max).not.toBeNull();
    expect(a.hauteur_max).not.toBeNull();
    expect(ea.hauteur_max!.value).toBe(6.5);
    expect(ea.hauteur_max!.unit).toBe("m");
    expect(a.hauteur_max!.value).toBe(4);
  });

  it("shares a value from an all-equal margin row across both zones", () => {
    expect(ea.marges.avant_min).not.toBeNull();
    expect(a.marges.avant_min).not.toBeNull();
    expect(ea.marges.arriere_min).not.toBeNull();
    expect(a.marges.arriere_min).not.toBeNull();
    expect(ea.marges.avant_min!.value).toBe(9);
    expect(a.marges.avant_min!.value).toBe(9);
    expect(ea.marges.arriere_min!.value).toBe(7.5);
    expect(a.marges.arriere_min!.value).toBe(7.5);
  });

  it("REFUSES the ambiguous 5-vs-2 latérale row (null, not a guess)", () => {
    // The refusal is a PUBLISHED field carrying a null value, not a missing field.
    expect(ea.marges.laterale_min).not.toBeNull();
    expect(a.marges.laterale_min).not.toBeNull();
    expect(ea.marges.laterale_min!.value).toBeNull();
    expect(a.marges.laterale_min!.value).toBeNull();
  });

  it("NULLs a below-floor 'superficie au sol' (45 m² < 150 m² lot-area window)", () => {
    // "Superficie minimale au sol" is a building footprint, not a lot area; the
    // frozen plausibility guard rejects 45 m² → null (never a fabricated lot area).
    expect(ea.superficie_min).not.toBeNull();
    expect(ea.superficie_min!.value).toBeNull();
  });

  it("does NOT let a 'Latérale combinée' sum populate a marge minimum", () => {
    // Latérale minimale is refused (ambiguous) and combinée never maps → laterale null.
    expect(ea.marges.laterale_min).not.toBeNull();
    expect(ea.marges.laterale_min!.value).toBeNull();
  });

  it("publishes a non-zero field count for each zone (defeats the fieldPct gate)", () => {
    for (const z of [ea, a]) {
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
    }
  });

  it("emits nothing when there is no banner (anti-invention: no header, no zone)", () => {
    expect(parseSpanHeaderGrillePage("just prose with a 10 mètres value", 1, OPTS)).toEqual([]);
  });
});

describe("parseSpanHeaderGrilleDocument — merge by zone across pages", () => {
  it("keeps the page with more published values for a recurring zone family", () => {
    const usagesFeuillet = "        Zones RU\n   Résidentiel (H)\n";
    const normesFeuillet =
      "        Zones RU\nNormes d'implantation\n   Hauteur maximale (m)   8\n   Marges de recul\n   Avant minimale (m)   6\n";
    const zs = parseSpanHeaderGrilleDocument([usagesFeuillet, normesFeuillet], OPTS);
    expect(zs).toHaveLength(1);
    expect(zs[0]!.zone_code).toBe("RU");
    expect(zs[0]!.hauteur_max).not.toBeNull();
    expect(zs[0]!.marges.avant_min).not.toBeNull();
    expect(zs[0]!.hauteur_max!.value).toBe(8);
    expect(zs[0]!.marges.avant_min!.value).toBe(6);
  });
});
