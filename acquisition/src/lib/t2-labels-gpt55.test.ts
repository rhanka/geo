import { describe, expect, it } from "vitest";

import type { GeoRef } from "./t1-georef.js";
import { validateGpt55LabelReads } from "./t2-labels-gpt55.js";

function fakeGeo(): GeoRef {
  return {
    bbox: [0, 0, 100, 100],
    pageW: 100,
    pageH: 100,
    proj4def: "epsg:4326",
    crsName: "test",
    corners: [],
    maxResidualM: 0,
    scaleMPerPt: 1,
    pageToLonLat: (x, y) => [x / 100, y / 100],
    topLeftToLonLat: (x, yTopDown) => [x / 100, (100 - yTopDown) / 100],
  };
}

describe("t2-labels-gpt55 validation", () => {
  it("keeps only unique dictionary-validated map codes", () => {
    const res = validateGpt55LabelReads(
      [
        { text: "H 104", x: 0.25, y: 0.25 },
        { text: "street", x: 0.5, y: 0.5 },
        { text: "X-999", x: 0.75, y: 0.75 },
      ],
      fakeGeo(),
      ["H-104", "P-5"],
    );

    expect(res.codePoints.map((p) => p.code)).toEqual(["H-104"]);
    expect(res.nCodeLike).toBe(2);
    expect(res.nValidated).toBe(1);
    expect(res.rejectSamples).toContain("not-code-like:1");
    expect(res.rejectSamples).toContain("not-in-dictionary:1");
  });

  it("rejects canonical dictionary collisions instead of choosing one", () => {
    const res = validateGpt55LabelReads(
      [{ text: "H 104", x: 0.25, y: 0.25 }],
      fakeGeo(),
      ["H-104", "H104"],
    );

    expect(res.codePoints).toHaveLength(0);
    expect(res.rejectSamples).toEqual(["ambiguous-dict-code:1"]);
  });
});
