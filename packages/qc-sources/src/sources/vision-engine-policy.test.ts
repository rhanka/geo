import { describe, it, expect } from "vitest";

import {
  assertVisionModelAllowed,
  BannedVisionEngineError,
  BANNED_VISION_MODEL_PATTERN,
} from "./vision-engine-policy.js";
import { MistralVisionGrille } from "./grille-vision-extractor.js";
import { MistralVisionMultiZone } from "./grille-vision-multizone.js";
import { MistralVisionZoneHeader } from "./grille-vision-zoneheader.js";

// ───────────────────────────────────────────────────────────────────────────
//  OWNER BAN (2026-08-14, ADR-0024). This test is the CI gate: it FAILS if any
//  vision-chat path can resolve a Mistral vision-chat model (mistral-medium-* /
//  pixtral-*), or if the removed mistral-medium-latest default ever comes back.
// ───────────────────────────────────────────────────────────────────────────

describe("vision-engine-policy — mistral-medium-latest ban", () => {
  it("throws on the banned mistral-medium lineage", () => {
    for (const m of ["mistral-medium-latest", "mistral-medium-2505", "pixtral-large-latest", "PIXTRAL-12b"]) {
      expect(() => assertVisionModelAllowed(m), m).toThrow(BannedVisionEngineError);
    }
  });

  it("throws when no model is configured (the removed default was banned)", () => {
    expect(() => assertVisionModelAllowed(undefined)).toThrow(BannedVisionEngineError);
    expect(() => assertVisionModelAllowed("")).toThrow(BannedVisionEngineError);
    expect(() => assertVisionModelAllowed("   ")).toThrow(BannedVisionEngineError);
  });

  it("allows sanctioned non-vision-chat models (OCR, audio) and gateway models", () => {
    for (const m of ["mistral-ocr-latest", "voxtral-mini-latest", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      expect(assertVisionModelAllowed(m)).toBe(m);
    }
  });

  it("the ban pattern matches mistral-medium and pixtral, not mistral-ocr/voxtral", () => {
    expect(BANNED_VISION_MODEL_PATTERN.test("mistral-medium-latest")).toBe(true);
    expect(BANNED_VISION_MODEL_PATTERN.test("pixtral-large-latest")).toBe(true);
    expect(BANNED_VISION_MODEL_PATTERN.test("mistral-ocr-latest")).toBe(false);
    expect(BANNED_VISION_MODEL_PATTERN.test("voxtral-mini-latest")).toBe(false);
  });

  it("every production vision class refuses to construct the banned engine (incl. its default)", () => {
    for (const ctor of [MistralVisionGrille, MistralVisionMultiZone, MistralVisionZoneHeader]) {
      expect(() => new ctor(), `${ctor.name} default`).toThrow(/BANNED/);
      expect(() => new ctor({ model: "mistral-medium-latest" }), `${ctor.name} explicit`).toThrow(/BANNED/);
      // A sanctioned model still constructs (the guard only blocks the vision-chat ban).
      expect(() => new ctor({ model: "gpt-5.6-terra" }), `${ctor.name} sanctioned`).not.toThrow();
    }
  });
});
