import { describe, it, expect } from "vitest";

import { extractZoneHeaderPageFromPdf, MistralVisionZoneHeader } from "./grille-vision-zoneheader.js";
import type { VisionCallImpl, VisionRawExtraction } from "./grille-vision-extractor.js";

// A canned two-pass vision call (both passes concord) — NO network, NO poppler.
const canned: VisionCallImpl = async (
  _img: string,
  _pass: 0 | 1,
  _expected: string | undefined,
): Promise<VisionRawExtraction> => ({
  zone_code: "H-11",
  usages: [],
  fields: { marge_avant_min: "10 m", superficie_min: "1500 m2", hauteur_metres: "9 m" },
});

describe("grille-vision-zoneheader — scan fallback wiring", () => {
  it("delegates to the frozen 2-pass pipeline and guards each cell", async () => {
    const zn = await extractZoneHeaderPageFromPdf("fake.pdf", 1, {
      source_url: "https://ex/scan.pdf",
      snapshot: "2026-07-03",
      expectedZone: "H-11",
      vision: canned,
      // injected renderer → no poppler; path lacks "grille-vision-" so no cleanup rm.
      render: async () => "/nonexistent/fake.png",
    });
    expect(zn.zone_code).toBe("H-11");
    // A NormField is `NormFieldT | null` by contract (null = never emitted). The
    // guarded pipeline must PUBLISH each cell it was fed, so assert the field
    // objects first — a missing field fails here — then read the guarded values.
    expect(zn.marges.avant_min).not.toBeNull();
    expect(zn.superficie_min).not.toBeNull();
    expect(zn.hauteur_max).not.toBeNull();
    expect(zn.marges.avant_min!.value).toBe(10);
    expect(zn.superficie_min!.value).toBe(1500);
    expect(zn.hauteur_max!.value).toBe(9);
    // Provenance stamped by the frozen single-zone pipeline (mistral-vision).
    expect(zn.superficie_min!._provenance.methode).toBe("mistral-vision");
  });

  it("still guards the cell values when the model code is present (concordant read)", async () => {
    const divergent: VisionCallImpl = async () => ({
      zone_code: "H-11",
      usages: [],
      fields: { marge_avant_min: "10 m" },
    });
    const zn = await extractZoneHeaderPageFromPdf("fake.pdf", 1, {
      source_url: "https://ex/scan.pdf",
      snapshot: "2026-07-03",
      expectedZone: "H-11",
      vision: divergent,
      render: async () => "/nonexistent/fake.png",
    });
    expect(zn.zone_code).toBe("H-11");
    expect(zn.marges.avant_min).not.toBeNull();
    expect(zn.marges.avant_min!.value).toBe(10);
  });

  it("BANS the mistral-medium-latest default (ADR-0024) yet still exposes extract on a sanctioned model", () => {
    // Owner ban 2026-08-14: no vision path may resolve a Mistral vision-chat model.
    // The old no-arg default was mistral-medium-latest → constructing with no model throws.
    expect(() => new MistralVisionZoneHeader()).toThrow(/BANNED/);
    expect(() => new MistralVisionZoneHeader({ model: "mistral-medium-latest" })).toThrow(/BANNED/);
    // An explicit sanctioned (non-banned) model is accepted and still exposes extract.
    const m = new MistralVisionZoneHeader({ model: "gpt-5.6-terra" });
    expect(typeof m.extract).toBe("function");
  });
});
