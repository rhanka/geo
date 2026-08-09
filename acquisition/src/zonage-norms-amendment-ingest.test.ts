import { describe, expect, it } from "vitest";

import { concordField } from "./zonage-norms-amendment-ingest.js";
import type { NormFieldT } from "../../packages/qc-sources/src/sources/grille-specifications-parser.js";

/** Minimal valid NormFieldT for the concordance test (only `.value` is read). */
function field(value: number | null, raw = String(value ?? "")): NormFieldT {
  return {
    value,
    raw,
    unit: "m",
    confidence: value === null ? 0 : 0.95,
    _provenance: {
      source_url: "test",
      methode: "mistral-vision",
      snapshot: "2026-07-12",
      page: "ZONE HC-14",
    },
  } as NormFieldT;
}

describe("concordField — cross-run concordance (anti-invention)", () => {
  it("keeps the value when every non-null read agrees (verbatim)", () => {
    const out = concordField([field(15), null, field(15), field(null)]);
    expect(out?.value).toBe(15);
    expect(out?.raw).toBe("15");
  });

  it("publishes even when only ONE read saw the value (the rest flickered to null)", () => {
    // HC-14 hauteur_max: read as 15 in ~2/6 runs, null otherwise — never a wrong number.
    const out = concordField([null, field(15), null, null, field(null), null]);
    expect(out?.value).toBe(15);
  });

  it("nulls the field when two reads DISAGREE on a value (never guesses/averages)", () => {
    const out = concordField([field(15), field(12), field(15)]);
    expect(out).toBeNull();
  });

  it("nulls the field when no read produced a value", () => {
    expect(concordField([null, field(null), undefined, null])).toBeNull();
  });

  it("nulls on an empty read set", () => {
    expect(concordField([])).toBeNull();
  });

  it("treats value 0 as a real value (not falsy-dropped)", () => {
    const out = concordField([field(0), field(0)]);
    expect(out?.value).toBe(0);
  });
});
