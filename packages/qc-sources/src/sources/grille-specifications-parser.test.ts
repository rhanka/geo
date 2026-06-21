import { describe, it, expect } from "vitest";

import {
  normalizeUnit,
  isGrillePage,
  deriveColumnAnchors,
  extractZonePage,
  parseGrillePage,
  parseGrilleDocument,
  PUBLISH_THRESHOLD,
  type NormFieldT,
  type ZoneNormsT,
} from "./grille-specifications-parser.js";
import {
  GRILLE_SHERBROOKE_H0001,
  GRILLE_SHERBROOKE_P0004,
  GRILLE_SHERBROOKE_H0005,
  NON_GRILLE_SHERBROOKE_TITLE,
  GRILLE_SHERBROOKE_SOURCE_URL,
  GRILLE_SHERBROOKE_SNAPSHOT,
} from "./grille-specifications.fixture.js";

const OPTS = {
  source_url: GRILLE_SHERBROOKE_SOURCE_URL,
  snapshot: GRILLE_SHERBROOKE_SNAPSHOT,
};

/** Collect every NormField a ZoneNorms exposes (for verbatim auditing). */
function allFields(z: ZoneNormsT): NormFieldT[] {
  const out: NormFieldT[] = [];
  for (const f of [
    z.densite,
    z.hauteur_min,
    z.hauteur_max,
    z.frontage_min,
    z.superficie_min,
    z.marges.avant_min,
    z.marges.laterale_min,
    z.marges.arriere_min,
  ]) {
    if (f) out.push(f);
  }
  return out;
}

function zoneByCode(zones: ZoneNormsT[], code: string): ZoneNormsT {
  const z = zones.find((x) => x.zone_code === code);
  if (!z) throw new Error(`zone ${code} not found`);
  return z;
}

// ───────────────────────────────────────────────────────────────────────────
//  1. Unit normaliser (separate & independently tested — design §4).
// ───────────────────────────────────────────────────────────────────────────

describe("normalizeUnit — QC unit normaliser", () => {
  it("parses FR decimal comma with explicit metre unit", () => {
    expect(normalizeUnit("12,5 m")).toEqual({
      value: 12.5,
      unit: "m",
      raw: "12,5 m",
      absent: false,
    });
  });

  it("parses a bare number with the column's fallback unit", () => {
    expect(normalizeUnit("6,0", "m")).toMatchObject({ value: 6, unit: "m" });
    expect(normalizeUnit("2", "etages")).toMatchObject({
      value: 2,
      unit: "etages",
    });
  });

  it("reads m² off the cell suffix", () => {
    expect(normalizeUnit("415 m²")).toMatchObject({ value: 415, unit: "m2" });
    expect(normalizeUnit("150 m2")).toMatchObject({ value: 150, unit: "m2" });
  });

  it("reads étages off the cell suffix", () => {
    expect(normalizeUnit("2 étages")).toMatchObject({
      value: 2,
      unit: "etages",
    });
  });

  it("collapses a thousands-separator space", () => {
    expect(normalizeUnit("1 200 m²")).toMatchObject({ value: 1200, unit: "m2" });
  });

  it.each(["s.o.", "S.O.", "n/a", "—", "–", "-", ""])(
    "maps absent marker %s to null (NEVER 0)",
    (token) => {
      const r = normalizeUnit(token);
      expect(r.value).toBeNull();
      expect(r.absent).toBe(true);
      // The anti-invention contract: an absent cell is never coerced to 0.
      expect(r.value).not.toBe(0);
    },
  );

  it("keeps raw and refuses value on an unknown non-numeric pattern", () => {
    const r = normalizeUnit("voir art. 73");
    expect(r.value).toBeNull();
    expect(r.absent).toBe(false);
    expect(r.raw).toBe("voir art. 73");
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  2. Page classifier (design §2).
// ───────────────────────────────────────────────────────────────────────────

describe("isGrillePage — canonical-header classifier", () => {
  it("accepts a real grille page", () => {
    const c = isGrillePage(GRILLE_SHERBROOKE_H0001);
    expect(c.isGrille).toBe(true);
    expect(c.matchedHeaders).toEqual(
      expect.arrayContaining([
        "title",
        "usage",
        "lotissement",
        "largeur",
        "superficie",
        "hauteur",
        "marge",
        "implantation",
      ]),
    );
  });

  it("rejects the bylaw title page (no canonical headers)", () => {
    const c = isGrillePage(NON_GRILLE_SHERBROOKE_TITLE);
    expect(c.isGrille).toBe(false);
  });

  it("rejects prose that merely mentions one header word", () => {
    const c = isGrillePage(
      "La marge avant doit respecter le règlement applicable.",
    );
    expect(c.isGrille).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  3. Per-page anchored clustering (design §3) — pages indented differently.
// ───────────────────────────────────────────────────────────────────────────

describe("deriveColumnAnchors — per-page, header-anchored", () => {
  it("resolves the full column set on page 1 (incl. absorbed columns)", () => {
    const a = deriveColumnAnchors(GRILLE_SHERBROOKE_H0001.split("\n"));
    // Every value-bearing column is modelled (some only to absorb their tokens),
    // in header order; the surfaced subset is asserted via parseGrillePage below.
    expect(a.map((x) => x.spec.id)).toEqual([
      "nombre_max_chambres",
      "nombre_max_batiments",
      "frontage_min",
      "profondeur_min",
      "superficie_min",
      "densite",
      "hauteur_max_etage",
      "marge_avant_min",
      "marge_laterale_min",
      "total_marges_laterales",
      "marge_arriere_min",
      "espace_libre_min",
    ]);
  });

  it("derives DIFFERENT absolute anchor positions on the indented page 4", () => {
    const a1 = deriveColumnAnchors(GRILLE_SHERBROOKE_H0001.split("\n"));
    const a4 = deriveColumnAnchors(GRILLE_SHERBROOKE_P0004.split("\n"));
    const front1 = a1.find((x) => x.spec.id === "frontage_min")!.center;
    const front4 = a4.find((x) => x.spec.id === "frontage_min")!.center;
    // Page 4 is indented further: its anchors must NOT equal page 1's, proving
    // we re-derive per page (not reuse absolute positions across pages).
    expect(front4).not.toBe(front1);
    expect(front4).toBeGreaterThan(front1);
  });

  it("reads the verbatim 'No zone' page label", () => {
    expect(extractZonePage(GRILLE_SHERBROOKE_H0001)).toBe("H0001");
    expect(extractZonePage(GRILLE_SHERBROOKE_P0004)).toBe("P0004");
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  3 & 4. End-to-end extraction (design §3–6).
// ───────────────────────────────────────────────────────────────────────────

describe("parseGrillePage — page 1 (H0001)", () => {
  const res = parseGrillePage(GRILLE_SHERBROOKE_H0001, OPTS);
  if (res.rejected) throw new Error(`page 1 unexpectedly rejected: ${res.reason}`);
  const zones = res.zones;

  it("extracts all four zones H-1..H-4", () => {
    expect(zones.map((z) => z.zone_code)).toEqual(["H-1", "H-2", "H-3", "H-4"]);
  });

  it("extracts H-1 norms with the correct verbatim values", () => {
    const h1 = zoneByCode(zones, "H-1");
    // H-1 row: 15 (largeur) 415 (sup) 35 (sol max) 2 (étage) 6,0 (avant)
    // 1,2 (latérale) 4,8 (total marges) 6,0 (arrière) 40 (libre).
    expect(h1.frontage_min?.value).toBe(15);
    expect(h1.superficie_min?.value).toBe(415);
    expect(h1.densite?.value).toBe(35);
    expect(h1.hauteur_max?.value).toBe(2);
    expect(h1.marges.avant_min?.value).toBe(6);
    expect(h1.marges.laterale_min?.value).toBe(1.2);
    expect(h1.marges.arriere_min?.value).toBe(6);
  });

  it("extracts H-2 norms (the 9 / 270 row)", () => {
    const h2 = zoneByCode(zones, "H-2");
    expect(h2.frontage_min?.value).toBe(9);
    expect(h2.superficie_min?.value).toBe(270);
    expect(h2.marges.laterale_min?.value).toBe(0);
  });

  it("attaches per-field provenance (source_url, methode, snapshot, page)", () => {
    const h1 = zoneByCode(zones, "H-1");
    expect(h1.frontage_min?._provenance).toMatchObject({
      source_url: GRILLE_SHERBROOKE_SOURCE_URL,
      snapshot: GRILLE_SHERBROOKE_SNAPSHOT,
      page: "H0001",
    });
    expect(h1.frontage_min?._provenance.methode).toContain("native-text");
  });
});

describe("parseGrillePage — page 4 (P0004), the indentation-shift trap", () => {
  const res = parseGrillePage(GRILLE_SHERBROOKE_P0004, OPTS);
  if (res.rejected) throw new Error(`page 4 unexpectedly rejected: ${res.reason}`);
  const zones = res.zones;

  it("extracts C-306, H-1, P-104 despite the ~9-char page indentation", () => {
    expect(zones.map((z) => z.zone_code)).toEqual(["C-306", "H-1", "P-104"]);
  });

  it("reads C-306 correctly on the shifted page (no décalage)", () => {
    const c = zoneByCode(zones, "C-306");
    // C-306 row: 30 (largeur) 30 (profondeur) 900 (sup) 40 (sol max) 2 (étage)
    // 12,0 (avant) 5,0 (latérale) 12,0 (total) 6,0 (arrière).
    expect(c.frontage_min?.value).toBe(30);
    expect(c.superficie_min?.value).toBe(900);
    expect(c.densite?.value).toBe(40);
    expect(c.hauteur_max?.value).toBe(2);
    expect(c.marges.avant_min?.value).toBe(12);
    expect(c.marges.laterale_min?.value).toBe(5);
    expect(c.marges.arriere_min?.value).toBe(6);
  });

  it("REFUSES to invent P-104's empty largeur/superficie cells (null)", () => {
    const p = zoneByCode(zones, "P-104");
    // P-104 has NO frontage/superficie/density-min cell on the grille.
    expect(p.frontage_min?.value).toBeNull();
    expect(p.frontage_min?.flag).toBe("absent");
    expect(p.superficie_min?.value).toBeNull();
    // …but its REAL values (density 40, height, margins) are still read.
    // P-104 row: ... 40 (sol max) ... 2 (étages) ... 12,0 (avant) ... 5,0
    // (latérale) ... 12,0 (total) ... 6,0 (arrière).
    expect(p.densite?.value).toBe(40);
    expect(p.hauteur_max?.value).toBe(2);
    expect(p.marges.avant_min?.value).toBe(12);
    expect(p.marges.laterale_min?.value).toBe(5);
    expect(p.marges.arriere_min?.value).toBe(6);
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  ANTI-INVENTION HARD-FAIL (design §6 / MVP metric) — the golden gate.
// ───────────────────────────────────────────────────────────────────────────

describe("ANTI-INVENTION — every served value MUST be verbatim in the page", () => {
  it.each([
    ["H0001", GRILLE_SHERBROOKE_H0001],
    ["P0004", GRILLE_SHERBROOKE_P0004],
    ["H0005", GRILLE_SHERBROOKE_H0005],
  ])(
    "page %s: no published value is absent from the raw bytes",
    (_label, pageText) => {
      const res = parseGrillePage(pageText, OPTS);
      if (res.rejected) throw new Error(`unexpected rejection: ${res.reason}`);
      for (const zone of res.zones) {
        for (const field of allFields(zone)) {
          if (field.value === null) continue; // refusals are allowed
          // 1) The raw cell must appear verbatim in the page bytes.
          expect(pageText).toContain(field.raw);
          // 2) The served numeric value must round-trip to the verbatim raw cell
          //    (FR comma → dot). A value that is NOT in its own raw cell is an
          //    invention → HARD FAIL.
          const rawNumber = field.raw.replace(",", ".");
          expect(rawNumber).toContain(String(field.value));
        }
      }
    },
  );

  it("HARD-FAILS the test if a value is fabricated (negative control)", () => {
    const res = parseGrillePage(GRILLE_SHERBROOKE_H0001, OPTS);
    if (res.rejected) throw new Error("unexpected rejection");
    const h1 = zoneByCode(res.zones, "H-1");
    // Simulate an inventing parser: assert a value the cell does not carry.
    // This MUST fail the verbatim check, proving the gate has teeth.
    const fabricated = 999;
    const isVerbatim = h1.frontage_min!.raw.replace(",", ".").includes(
      String(fabricated),
    );
    expect(isVerbatim).toBe(false);
  });

  it("at least one cell is REFUSED as null, proving the parser declines to invent", () => {
    const all: NormFieldT[] = [];
    for (const pt of [GRILLE_SHERBROOKE_H0001, GRILLE_SHERBROOKE_P0004]) {
      const res = parseGrillePage(pt, OPTS);
      if (res.rejected) continue;
      for (const z of res.zones) all.push(...allFields(z));
    }
    const refused = all.filter((f) => f.value === null);
    expect(refused.length).toBeGreaterThan(0);
    // Every refusal keeps a flag explaining WHY (absent / a-verifier / décalage).
    for (const f of refused) expect(f.flag).toBeDefined();
  });

  it("treats H-3's 'Note 5'/'Note 6' reference cells as null, not numbers", () => {
    const res = parseGrillePage(GRILLE_SHERBROOKE_H0001, OPTS);
    if (res.rejected) throw new Error("unexpected rejection");
    const h3 = zoneByCode(res.zones, "H-3");
    // The "Largeur" cell of H-3 is the ambiguous "Note 5" reference → null.
    expect(h3.frontage_min?.value).toBeNull();
    expect(h3.frontage_min?.raw).toMatch(/Note/);
    expect(h3.superficie_min?.value).toBeNull();
    expect(h3.superficie_min?.raw).toMatch(/Note/);
    // confidence is well below the publish threshold.
    expect(h3.frontage_min!.confidence).toBeLessThan(PUBLISH_THRESHOLD);
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  Anti-décalage GUARDS (design §6) — column-count + semantic + round-trip.
// ───────────────────────────────────────────────────────────────────────────

describe("anti-décalage guards", () => {
  it("rejects a non-grille page outright (no norms read off prose)", () => {
    const res = parseGrillePage(NON_GRILLE_SHERBROOKE_TITLE, OPTS);
    expect(res.rejected).toBe(true);
  });

  it("rejects the WHOLE grille when the header band is unrecognisable", () => {
    // A page that passes the header-word classifier but whose column band is
    // corrupted (headers present in prose, but no alignable label line) must
    // fail the column-count guard rather than emit mis-clustered numbers.
    const corrupted = [
      "grille des usages et des normes - usage lotissement",
      "largeur superficie hauteur marge implantation",
      "  H-9   garbled 1 2 3 4 5 6 7 8 9 10 11 12 13",
    ].join("\n");
    const res = parseGrillePage(corrupted, OPTS);
    expect(res.rejected).toBe(true);
    if (res.rejected) expect(res.reason).toMatch(/column-count|anti-décalage/);
  });

  it("semantic type-check REFUSES an m² cell that lands in a length column", () => {
    // Forge a grille row where a "25m²" cell sits under the "Marge avant min."
    // (a LENGTH column). 25 IS plausible as a margin (window [0,30]), so ONLY the
    // semantic guard (unit m² ≠ length) can catch this décalage. It must REFUSE
    // → null. Built from a real page so the header band and anchors resolve.
    const lines = GRILLE_SHERBROOKE_H0001.split("\n");
    const headerEnd = lines.findIndex((l) => /libre min\./.test(l));
    const header = lines.slice(0, headerEnd + 1).join("\n");
    // "25m²" (no inner space → single token) at the marge-avant center (~208).
    const decalageRow = `${" ".repeat(4)}H-9${" ".repeat(204)}25m²`;
    const forged = `${header}\n\n${decalageRow}\n`;
    const res = parseGrillePage(forged, OPTS);
    if (res.rejected) throw new Error(`forged page rejected: ${res.reason}`);
    const h9 = res.zones.find((z) => z.zone_code === "H-9")!;
    // The cell DID cluster to avant_min and IS plausible (25 ∈ [0,30])…
    expect(h9.marges.avant_min?.raw).toBe("25m²");
    expect(h9.marges.avant_min?.unit).toBe("m2");
    // …but the m² unit in a length column is a décalage → refused.
    expect(h9.marges.avant_min?.value).toBeNull();
    expect(h9.marges.avant_min?.flag).toBe("a-verifier");
  });

  it("unit detection: explicit cell unit overrides the column fallback", () => {
    const asArea = normalizeUnit("415 m²", "m");
    expect(asArea.unit).toBe("m2");
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  Document-level convenience.
// ───────────────────────────────────────────────────────────────────────────

describe("parseGrilleDocument — multi-page", () => {
  it("aggregates zones across pages and reports rejected pages", () => {
    const { zones, rejectedPages } = parseGrilleDocument(
      [
        GRILLE_SHERBROOKE_H0001,
        GRILLE_SHERBROOKE_P0004,
        GRILLE_SHERBROOKE_H0005,
        NON_GRILLE_SHERBROOKE_TITLE,
      ],
      OPTS,
    );
    // 4 + 3 + 3 zones from the three grille pages; the title page is rejected.
    expect(zones.length).toBe(10);
    expect(rejectedPages.length).toBe(1);
  });
});
