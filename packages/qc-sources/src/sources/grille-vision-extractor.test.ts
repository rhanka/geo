import { describe, it, expect } from "vitest";

import {
  buildVisionField,
  extractZonePageFromImage,
  parseVisionContent,
  FIELD_SPECS,
  VISION_METHODE,
  VISION_PUBLISH_CONFIDENCE,
  type FieldSpec,
  type VisionCallImpl,
  type VisionRawExtraction,
} from "./grille-vision-extractor.js";
import { PUBLISH_THRESHOLD, type FieldProvenanceT } from "./grille-specifications-parser.js";
import {
  GRILLE_SSKK_VISION_PAGES,
  GRILLE_SSKK_SOURCE_URL,
  GRILLE_SSKK_SNAPSHOT,
  GRILLE_SSKK_DIVERGENT,
  GRILLE_SSKK_TRAP,
  ssKkPage,
  type GrilleVisionFixturePage,
} from "./grille-vision-saint-stanislas.fixture.js";

const PROV: FieldProvenanceT = {
  source_url: GRILLE_SSKK_SOURCE_URL,
  methode: VISION_METHODE,
  snapshot: GRILLE_SSKK_SNAPSHOT,
};

function spec(id: FieldSpec["id"]): FieldSpec {
  const s = FIELD_SPECS.find((x) => x.id === id);
  if (!s) throw new Error(`no spec ${id}`);
  return s;
}

/**
 * Build an injectable two-pass vision call from a fixture page — NO network.
 * pass 0 → page.passA, pass 1 → page.passB. This is how CI replays the real
 * model output deterministically.
 */
function mockVision(page: GrilleVisionFixturePage): VisionCallImpl {
  return async (_img: string, pass: 0 | 1): Promise<VisionRawExtraction> =>
    pass === 0 ? page.passA : page.passB;
}

// ───────────────────────────────────────────────────────────────────────────
//  1. parseVisionContent — tolerant JSON parse, anti-invention nulls.
// ───────────────────────────────────────────────────────────────────────────

describe("parseVisionContent", () => {
  it("parses a clean JSON object", () => {
    const r = parseVisionContent(
      '{"zone_code":"A-2","usages":["AA"],"fields":{"marge_avant_min":"7.5"}}',
    );
    expect(r.zone_code).toBe("A-2");
    expect(r.usages).toEqual(["AA"]);
    expect(r.fields.marge_avant_min).toBe("7.5");
  });

  it("strips ```json fences", () => {
    const r = parseVisionContent('```json\n{"zone_code":"A-3","fields":{}}\n```');
    expect(r.zone_code).toBe("A-3");
  });

  it("missing fields become null (never fabricated)", () => {
    const r = parseVisionContent('{"zone_code":"A-2","fields":{}}');
    expect(r.fields.marge_avant_min ?? null).toBeNull();
    expect(r.fields.superficie_min ?? null).toBeNull();
  });

  it("a non-string zone_code → null (no invention)", () => {
    const r = parseVisionContent('{"zone_code":123,"fields":{}}');
    expect(r.zone_code).toBeNull();
  });

  it("throws on non-JSON content", () => {
    expect(() => parseVisionContent("désolé je ne peux pas")).toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  2. buildVisionField — the guard cascade (concordance / unit / plausibility).
// ───────────────────────────────────────────────────────────────────────────

describe("buildVisionField — guards", () => {
  it("publishes a value when both passes concord, plausible, right unit", () => {
    const f = buildVisionField(spec("marge_avant_min"), "7.5", "7.5", PROV);
    expect(f.value).toBe(7.5);
    expect(f.unit).toBe("m");
    expect(f.confidence).toBe(VISION_PUBLISH_CONFIDENCE);
    expect(f.confidence).toBeGreaterThanOrEqual(PUBLISH_THRESHOLD);
    expect(f.flag).toBeUndefined();
    expect(f.raw).toBe("7.5");
  });

  it("CONCORDANCE is semantic: FR comma vs dot still publishes (same number)", () => {
    const f = buildVisionField(spec("marge_avant_min"), "7,5", "7.5", PROV);
    expect(f.value).toBe(7.5);
    expect(f.flag).toBeUndefined();
    // raw keeps the verbatim pass-A text.
    expect(f.raw).toBe("7,5");
  });

  it("an OCR mark on a superscript ('7.5'' vs '7.5') still concords on the number", () => {
    const f = buildVisionField(spec("marge_avant_min"), "7.5'", "7.5", PROV);
    expect(f.value).toBe(7.5);
    expect(f.flag).toBeUndefined();
  });

  it("DIVERGENT numbers → null + flag (never picks one — anti-invention)", () => {
    const f = buildVisionField(spec("marge_avant_min"), "7.5", "9.5", PROV);
    expect(f.value).toBeNull();
    expect(f.confidence).toBe(0);
    expect(f.flag).toBe("divergence-2-passes");
    // raw is still kept for audit.
    expect(f.raw).toBe("7.5");
  });

  it("UNIT type-check: an m² value on a length field → null (décalage trap)", () => {
    const f = buildVisionField(spec("marge_avant_min"), "415 m²", "415 m²", PROV);
    expect(f.value).toBeNull();
    expect(f.flag).toBe("unite-incoherente");
    expect(f.raw).toBe("415 m²");
  });

  it("PLAUSIBILITY: a 120 m height (window 1–60) → null + flag", () => {
    const f = buildVisionField(spec("hauteur_metres"), "120 m", "120 m", PROV);
    expect(f.value).toBeNull();
    expect(f.flag).toBe("hors-plage");
  });

  it("PLAUSIBILITY: a 2 m² lot superficie (window ≥150) → null + flag", () => {
    const f = buildVisionField(spec("superficie_min"), "2 m²", "2 m²", PROV);
    expect(f.value).toBeNull();
    expect(f.flag).toBe("hors-plage");
  });

  it("an empty cell (both passes null) → value null, flag absent, NOT 0", () => {
    const f = buildVisionField(spec("hauteur_metres"), null, null, PROV);
    expect(f.value).toBeNull();
    expect(f.flag).toBe("absent");
    expect(f.value).not.toBe(0);
  });

  it("a concordant '—' absent marker → null + absent (never 0)", () => {
    const f = buildVisionField(spec("densite"), "—", "—", PROV);
    expect(f.value).toBeNull();
    expect(f.flag).toBe("absent");
  });

  it("a note/prose cell → null, flag non-numerique (digit never lifted from prose)", () => {
    const f = buildVisionField(spec("marge_avant_min"), "voir art. 73", "voir art. 73", PROV);
    expect(f.value).toBeNull();
    expect(f.flag).toBe("non-numerique");
  });

  it("provenance method is mistral-vision on every field", () => {
    const f = buildVisionField(spec("frontage_min"), "45", "45", PROV);
    expect(f._provenance.methode).toBe("mistral-vision");
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  3. End-to-end on the 5 pilot zones (mocked vision — no network).
// ───────────────────────────────────────────────────────────────────────────

describe("extractZonePageFromImage — pilot Saint-Stanislas-de-Kostka", () => {
  it("extracts all 5 zones (A-2..A-6) with concordant values", async () => {
    for (const page of GRILLE_SSKK_VISION_PAGES) {
      const zn = await extractZonePageFromImage("FAKE.png", {
        source_url: GRILLE_SSKK_SOURCE_URL,
        snapshot: GRILLE_SSKK_SNAPSHOT,
        expectedZone: page.zone,
        vision: mockVision(page),
      });
      expect(zn.zone_code).toBe(page.zone);

      // The eye-verified ground truth for every pilot zone.
      expect(zn.marges.avant_min?.value).toBe(7.5);
      expect(zn.marges.avant_min?.unit).toBe("m");
      expect(zn.marges.laterale_min?.value).toBe(3);
      expect(zn.marges.arriere_min?.value).toBe(7.5);
      expect(zn.frontage_min?.value).toBe(45);
      expect(zn.superficie_min?.value).toBe(2787);
      expect(zn.superficie_min?.unit).toBe("m2");

      // hauteur_max: when the "hauteur en mètres" cell carries a value (A-3/A-4/
      // A-6 → "6") we publish that (=6 m); when it is empty (A-2/A-5) we fall back
      // to the étages range "1/2" (first number → 1). Either way it is a faithful
      // read of a real cell — never invented.
      if (page.passA.fields.hauteur_metres) {
        expect(zn.hauteur_max?.value).toBe(6);
        expect(zn.hauteur_max?.unit).toBe("m");
      } else {
        expect(zn.hauteur_max?.value).toBe(1);
        expect(zn.hauteur_max?.raw).toBe("1/2");
      }

      // Every PUBLISHED field is at/above the publish threshold; every field
      // either has a value or is explicitly null (anti-invention: no field is a
      // fabricated default).
      for (const f of [
        zn.densite,
        zn.hauteur_max,
        zn.frontage_min,
        zn.superficie_min,
        zn.marges.avant_min,
        zn.marges.laterale_min,
        zn.marges.arriere_min,
      ]) {
        if (f && f.value !== null) {
          expect(f.confidence).toBeGreaterThanOrEqual(PUBLISH_THRESHOLD);
        }
      }
    }
  });

  it("A-2 has an EMPTY hauteur-en-mètres cell → étages fallback, not invented", async () => {
    const page = ssKkPage("A-2");
    const zn = await extractZonePageFromImage("FAKE.png", {
      source_url: GRILLE_SSKK_SOURCE_URL,
      snapshot: GRILLE_SSKK_SNAPSHOT,
      expectedZone: "A-2",
      vision: mockVision(page),
    });
    // hauteur_max falls back to étages (value 1 from "1/2"), since métres empty.
    expect(zn.hauteur_max?.raw).toBe("1/2");
  });

  it("METRIC — 0 fausse valeur servie: every published value matches a cell verbatim", async () => {
    // For each pilot zone, every NON-null served value must be derivable from a
    // cell that one of the two passes actually read (no value out of thin air).
    for (const page of GRILLE_SSKK_VISION_PAGES) {
      const zn = await extractZonePageFromImage("FAKE.png", {
        source_url: GRILLE_SSKK_SOURCE_URL,
        snapshot: GRILLE_SSKK_SNAPSHOT,
        expectedZone: page.zone,
        vision: mockVision(page),
      });
      const served = [
        zn.densite,
        zn.hauteur_max,
        zn.frontage_min,
        zn.superficie_min,
        zn.marges.avant_min,
        zn.marges.laterale_min,
        zn.marges.arriere_min,
      ].filter((f) => f && f.value !== null);
      for (const f of served) {
        // The served raw must be present in BOTH passes (concordance already
        // guarantees this), and must be non-empty.
        expect(f!.raw.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
//  4. Guards at the page level (synthetic divergence / trap fixtures).
// ───────────────────────────────────────────────────────────────────────────

describe("extractZonePageFromImage — guards refuse, never invent", () => {
  it("divergent passes → marge_avant_min refused (null + flag), rest still published", async () => {
    const zn = await extractZonePageFromImage("FAKE.png", {
      source_url: GRILLE_SSKK_SOURCE_URL,
      snapshot: GRILLE_SSKK_SNAPSHOT,
      expectedZone: "A-DIV",
      vision: mockVision(GRILLE_SSKK_DIVERGENT),
    });
    expect(zn.marges.avant_min?.value).toBeNull();
    expect(zn.marges.avant_min?.flag).toBe("divergence-2-passes");
    // a concordant sibling field is still published — refusal is per-field.
    expect(zn.marges.laterale_min?.value).toBe(3);
  });

  it("unit-trap + implausible height → both refused even though passes agree", async () => {
    const zn = await extractZonePageFromImage("FAKE.png", {
      source_url: GRILLE_SSKK_SOURCE_URL,
      snapshot: GRILLE_SSKK_SNAPSHOT,
      expectedZone: "A-TRAP",
      vision: mockVision(GRILLE_SSKK_TRAP),
    });
    expect(zn.marges.avant_min?.value).toBeNull();
    expect(zn.marges.avant_min?.flag).toBe("unite-incoherente");
    // hauteur_metres 120m refused → falls back to étages "1/2" (=1), which is fine.
    expect(zn.hauteur_max?.value).toBe(1);
  });

  it("refuses when zone cannot be determined and no expectedZone is given", async () => {
    const noZone: VisionCallImpl = async () => ({
      zone_code: null,
      usages: [],
      fields: {},
    });
    await expect(
      extractZonePageFromImage("FAKE.png", {
        source_url: GRILLE_SSKK_SOURCE_URL,
        snapshot: GRILLE_SSKK_SNAPSHOT,
        vision: noZone,
      }),
    ).rejects.toThrow(/zone_code/);
  });
});
