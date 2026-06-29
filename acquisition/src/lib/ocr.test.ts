import { describe, it, expect } from "vitest";

import { resolveOcrCall, liveMistralOcrLib } from "./ocr.js";

/**
 * Network-free: only the BACKEND SELECTION is asserted (no OCR call is made).
 * Default mistral-ocr → the proven lib call; a custom/Chandra backend → the
 * generic HTTP call (a distinct closure). Branching Chandra is pure config.
 */
describe("resolveOcrCall — backend selection", () => {
  it("defaults to the proven mistral-ocr lib call", () => {
    const r = resolveOcrCall({ MISTRAL_API_KEY: "k" });
    expect(r.call).toBe(liveMistralOcrLib);
    expect(r.config.provider).toBe("mistral-ocr");
    expect(r.methode).toBe("ocr/mistral-ocr");
    expect(r.costPerPage).toBe(0.001);
  });

  it("switches to the generic HTTP call for a self-hosted Chandra backend", () => {
    const r = resolveOcrCall({
      OCR_PROVIDER: "chandra",
      OCR_API_BASE: "http://chandra.local:8080",
      OCR_API_KEY: "secret",
      OCR_USD_PER_PAGE: "0.0004",
    });
    expect(r.call).not.toBe(liveMistralOcrLib);
    expect(r.methode).toBe("ocr/chandra");
    expect(r.costPerPage).toBe(0.0004);
  });

  it("uses the generic HTTP call when mistral-ocr points at a custom base", () => {
    const r = resolveOcrCall({ OCR_API_BASE: "http://localhost:9999", MISTRAL_API_KEY: "k" });
    expect(r.call).not.toBe(liveMistralOcrLib);
  });
});
