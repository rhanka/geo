import { describe, it, expect } from "vitest";

import {
  extractAgyJson,
  buildAgyImagePrompt,
  parseAgyContent,
  mapAgyExtractionToZones,
  AGY_METHODE,
  AGY_MODEL,
  type AgyRawExtraction,
} from "./grille-agy-cli.js";

const OPTS = { source_url: "https://example.test/grille.pdf", snapshot: "2026-07-04", methode: AGY_METHODE };

describe("buildAgyImagePrompt", () => {
  it("attaches the page image via an @<abs-path> reference and reuses the frozen prompt", () => {
    const p = buildAgyImagePrompt("/tmp/x/page-01.png");
    // image is referenced (agy expands @path into an attached image)
    expect(p).toContain("@/tmp/x/page-01.png");
    // and the frozen anti-invention prompt body is carried whole
    expect(p).toContain("marge_avant_min");
    expect(p).toContain('"zones"');
    expect(p).toMatch(/VERBATIM/);
    expect(p).toMatch(/null/);
  });
});

describe("extractAgyJson — tolerant of agy --output-format json noise", () => {
  it("parses the whole-stdout json object with usage", () => {
    const o = extractAgyJson(
      '{"conversation_id":"x","status":"SUCCESS","response":"{\\"zones\\":[]}","usage":{"input_tokens":22048,"output_tokens":1255,"thinking_tokens":1177,"total_tokens":23303}}',
    );
    expect(o).not.toBeNull();
    expect(o!.status).toBe("SUCCESS");
    expect((o!.usage as Record<string, unknown>).input_tokens).toBe(22048);
  });

  it("finds the json object even with leading npm-warn / log noise lines", () => {
    const o = extractAgyJson(
      'npm warn Unknown builtin config\nsome log line\n{"status":"SUCCESS","response":"ok","usage":{"input_tokens":10}}\n',
    );
    expect(o).not.toBeNull();
    expect(o!.response).toBe("ok");
  });

  it("returns null when there is no json at all", () => {
    expect(extractAgyJson("no json here")).toBeNull();
  });
});

describe("anti-invention reuse — parseAgyContent + mapAgyExtractionToZones are the frozen guard", () => {
  it("publishes a verbatim, plausible cell and stamps the agy methode", () => {
    const ext = parseAgyContent(
      '{"zones":[{"zone_code":"A 14","fields":{"marge_avant_min":"9","hauteur_metres":"10"}}]}',
    );
    const zones = mapAgyExtractionToZones(ext, 2, OPTS);
    expect(zones).toHaveLength(1);
    expect(zones[0]!.zone_code).toBe("A 14");
    expect(zones[0]!.marges.avant_min!.value).toBe(9);
    expect(zones[0]!.hauteur_max!.value).toBe(10);
    // Engine-C provenance tag (never the inherited Engine-B tag)
    expect(zones[0]!.marges.avant_min!._provenance.methode).toBe("agy-cli/gemini-3.5-flash-high");
  });

  it("refuses an out-of-range value (plausibility window) → value null, raw preserved", () => {
    const ext: AgyRawExtraction = { zones: [{ zone_code: "Z1", fields: { marge_avant_min: "999" } }] };
    const zones = mapAgyExtractionToZones(ext, 1, OPTS);
    expect(zones[0]!.marges.avant_min!.value).toBeNull();
    expect(zones[0]!.marges.avant_min!.flag).toBe("hors-plage");
    expect(zones[0]!.marges.avant_min!.raw).toBe("999");
  });

  it("drops a zone with no readable code (never invents one)", () => {
    const ext: AgyRawExtraction = { zones: [{ zone_code: null, fields: { marge_avant_min: "9" } }] };
    expect(mapAgyExtractionToZones(ext, 1, OPTS)).toHaveLength(0);
  });
});

describe("model pin", () => {
  it("targets Gemini 3.5 Flash (High)", () => {
    expect(AGY_MODEL).toBe("Gemini 3.5 Flash (High)");
  });
});
