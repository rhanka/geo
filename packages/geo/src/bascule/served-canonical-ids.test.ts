import { describe, expect, it } from "vitest";

import { buildServedCanonicalIds, serializeServedCanonicalIds } from "./served-canonical-ids.js";

describe("buildServedCanonicalIds", () => {
  it("emits ogc:zones / ogc:lots tokens via the shared canonicalizers", () => {
    const ids = buildServedCanonicalIds({
      zones: [{ citySlug: "westmount", zoneCode: "C408" }],
      lots: [{ citySlug: "laval", noLot: "1 234 567" }],
    });
    expect(ids).toContain("ogc:zones:westmount:C-408"); // C408 -> C-408
    expect(ids).toContain("ogc:lots:laval:1234567"); // spaces stripped
  });

  it("skips refs whose canonical form or slug is empty (fail-closed by absence)", () => {
    const ids = buildServedCanonicalIds({
      zones: [
        { citySlug: "granby", zoneCode: null }, // out-of-polygon / null code
        { citySlug: "", zoneCode: "H-1" }, // missing slug
      ],
      lots: [{ citySlug: "sorel", noLot: "   " }], // blank lot
    });
    expect(ids).toEqual([]);
  });

  it("deduplicates and sorts in byte order (LC_ALL=C)", () => {
    const ids = buildServedCanonicalIds({
      zones: [
        { citySlug: "wotton", zoneCode: "H-2" },
        { citySlug: "wotton", zoneCode: "H-2" }, // dup
      ],
      lots: [{ citySlug: "wotton", noLot: "5 678" }],
    });
    // "ogc:lots:…" precedes "ogc:zones:…" because 'l' (0x6c) < 'z' (0x7a).
    expect(ids).toEqual(["ogc:lots:wotton:5678", "ogc:zones:wotton:H-2"]);
  });
});

describe("serializeServedCanonicalIds", () => {
  it("is newline-terminated (the exact bytes hashed into geo.json)", () => {
    expect(serializeServedCanonicalIds(["ogc:lots:a:1", "ogc:zones:a:B"])).toBe(
      "ogc:lots:a:1\nogc:zones:a:B\n",
    );
  });

  it("is empty for an empty set", () => {
    expect(serializeServedCanonicalIds([])).toBe("");
  });
});
