import { describe, it, expect } from "vitest";

import {
  parseClaudeContent,
  mapClaudeExtractionToZones,
  buildClaudePrompt,
  type ClaudeRawExtraction,
} from "./grille-claude-cli.js";

const OPTS = { source_url: "https://example.test/grille.pdf", snapshot: "2026-06-29" };

describe("buildClaudePrompt", () => {
  it("lists every norm field and forbids invention", () => {
    const p = buildClaudePrompt();
    expect(p).toContain("marge_avant_min");
    expect(p).toContain("superficie_min");
    expect(p).toContain("densite");
    expect(p).toMatch(/null/);
    expect(p).toMatch(/VERBATIM/);
    // must request the strict zones JSON shape
    expect(p).toContain('"zones"');
  });
});

describe("parseClaudeContent", () => {
  it("parses a plain JSON object", () => {
    const r = parseClaudeContent(
      '{"zones":[{"zone_code":"A 14","fields":{"marge_avant_min":"9","hauteur_metres":"10"}}]}',
    );
    expect(r.zones).toHaveLength(1);
    expect(r.zones[0]!.zone_code).toBe("A 14");
    expect(r.zones[0]!.fields.marge_avant_min).toBe("9");
    // unspecified fields normalise to null (never fabricated)
    expect(r.zones[0]!.fields.superficie_min).toBeNull();
  });

  it("strips ```json fences", () => {
    const r = parseClaudeContent(
      '```json\n{"zones":[{"zone_code":"R-1","fields":{}}]}\n```',
    );
    expect(r.zones[0]!.zone_code).toBe("R-1");
  });

  it("isolates JSON wrapped in prose", () => {
    const r = parseClaudeContent(
      'Voici le résultat:\n{"zones":[{"zone_code":"C-2","fields":{"densite":"0,3"}}]}\nFin.',
    );
    expect(r.zones[0]!.fields.densite).toBe("0,3");
  });

  it("coerces a null cell to null, not the string 'null'", () => {
    const r = parseClaudeContent('{"zones":[{"zone_code":"X","fields":{"marge_avant_min":null}}]}');
    expect(r.zones[0]!.fields.marge_avant_min).toBeNull();
  });

  it("throws on non-JSON output", () => {
    expect(() => parseClaudeContent("the model refused")).toThrow(/did not return JSON/);
  });
});

describe("mapClaudeExtractionToZones — frozen guard reuse, anti-invention", () => {
  it("publishes a verbatim, plausible cell", () => {
    const ext: ClaudeRawExtraction = {
      zones: [{ zone_code: "A 14", fields: { marge_avant_min: "9", hauteur_metres: "10" } }],
    };
    const zones = mapClaudeExtractionToZones(ext, 2, OPTS);
    expect(zones).toHaveLength(1);
    expect(zones[0]!.zone_code).toBe("A 14");
    expect(zones[0]!.marges.avant_min!.value).toBe(9);
    expect(zones[0]!.hauteur_max!.value).toBe(10);
    expect(zones[0]!.marges.avant_min!._provenance.methode).toBe("claude-cli/opus-4-8");
  });

  it("refuses an OUT-OF-RANGE value (plausibility window) → value null", () => {
    const ext: ClaudeRawExtraction = {
      zones: [{ zone_code: "Z1", fields: { marge_avant_min: "999" } }],
    };
    const zones = mapClaudeExtractionToZones(ext, 1, OPTS);
    expect(zones[0]!.marges.avant_min!.value).toBeNull();
    expect(zones[0]!.marges.avant_min!.flag).toBe("hors-plage");
    // raw is preserved (never discarded)
    expect(zones[0]!.marges.avant_min!.raw).toBe("999");
  });

  it("refuses a WRONG-UNIT cell (semantic type-check) → value null", () => {
    const ext: ClaudeRawExtraction = {
      zones: [{ zone_code: "Z2", fields: { marge_avant_min: "415 m²" } }],
    };
    const zones = mapClaudeExtractionToZones(ext, 1, OPTS);
    expect(zones[0]!.marges.avant_min!.value).toBeNull();
    expect(zones[0]!.marges.avant_min!.flag).toBe("unite-incoherente");
  });

  it("keeps a null cell as null (absent), never 0", () => {
    const ext: ClaudeRawExtraction = {
      zones: [{ zone_code: "Z3", fields: { marge_avant_min: null } }],
    };
    const zones = mapClaudeExtractionToZones(ext, 1, OPTS);
    expect(zones[0]!.marges.avant_min!.value).toBeNull();
  });

  it("drops a zone with no readable code (never invents one)", () => {
    const ext: ClaudeRawExtraction = {
      zones: [{ zone_code: null, fields: { marge_avant_min: "9" } }],
    };
    expect(mapClaudeExtractionToZones(ext, 1, OPTS)).toHaveLength(0);
  });

  it("dedups repeated zone codes within a page (whitespace-insensitive, like the OCR mapper)", () => {
    const ext: ClaudeRawExtraction = {
      zones: [
        { zone_code: "A 14", fields: { marge_avant_min: "9" } },
        { zone_code: "A  14", fields: { marge_avant_min: "11" } },
      ],
    };
    // dedup key strips whitespace → "A14" collides; only the first read survives.
    const zones = mapClaudeExtractionToZones(ext, 1, OPTS);
    expect(zones).toHaveLength(1);
    expect(zones[0]!.marges.avant_min!.value).toBe(9);
  });
});

describe("multizone read — many zones in one page", () => {
  it("maps every column to its own guarded ZoneNorms row", () => {
    // Mirrors the Stratford feuillet read (zones in columns).
    const ext: ClaudeRawExtraction = {
      zones: [
        { zone_code: "A 14", fields: { marge_avant_min: "9", hauteur_metres: "10" } },
        { zone_code: "A 15", fields: { marge_avant_min: "11", hauteur_metres: "10" } },
        { zone_code: "AFT1-8", fields: { marge_avant_min: "9", hauteur_metres: "10" } },
      ],
    };
    const zones = mapClaudeExtractionToZones(ext, 2, OPTS);
    expect(zones.map((z) => z.zone_code)).toEqual(["A 14", "A 15", "AFT1-8"]);
    expect(zones.every((z) => z.hauteur_max!.value === 10)).toBe(true);
    expect(zones[0]!.marges.avant_min!.value).toBe(9);
    expect(zones[1]!.marges.avant_min!.value).toBe(11);
  });
});
