import { describe, expect, it } from "vitest";

import { invertedKey, looseIndex, looseKey } from "./fold-norms-to-zonage.js";

describe("invertedKey", () => {
  it("restores the municipal order read in the source grids", () => {
    // amherst serves `10-F`; its grid writes `10F`. Our norms hold `F-10`.
    expect(invertedKey("F-10")).toBe(looseKey("10-F"));
    // saint-basile-le-grand's grid writes `ZONE: 102-C` verbatim.
    expect(invertedKey("C-102")).toBe(looseKey("102-C"));
    // sayabec serves `1 R`, a number then a letter suffix per its by-law.
    expect(invertedKey("R-1")).toBe(looseKey("1 R"));
  });

  it("refuses to guess when the code does not have exactly two segments", () => {
    expect(invertedKey("114-A-ILOT")).toBeNull();
    expect(invertedKey("C1")).toBeNull();
    expect(invertedKey("")).toBeNull();
  });
});

describe("looseKey", () => {
  it("removes the separators that only differ in FORM", () => {
    expect(looseKey("A-10")).toBe("A10");
    expect(looseKey("Ru 11")).toBe("RU11");
    expect(looseKey("vil.10")).toBe("VIL10");
  });

  it("never reorders segments", () => {
    // `10-F` and `F-10` stay distinct: claiming they are the same zone is a
    // semantic assertion that has to be READ in the source grid, never assumed.
    expect(looseKey("10-F")).not.toBe(looseKey("F-10"));
  });
});

describe("looseIndex", () => {
  it("indexes codes that stay distinct without their separator", () => {
    const index = looseIndex(["A-10", "RU-11", "VIL-10"]);
    expect(index?.get("A10")).toBe("A-10");
    expect(index?.get("VIL10")).toBe("VIL-10");
  });

  it("REFUSES when relaxing would collide two distinct zones", () => {
    // A municipality serving both `A-10` and `A10` as different zones: folding
    // one's density onto the other would fabricate a densifying effect.
    expect(looseIndex(["A-10", "A10"])).toBeNull();
  });

  it("does not treat a repeated identical code as a collision", () => {
    expect(looseIndex(["A-10", "A-10"])).not.toBeNull();
  });

  it("ignores empty codes rather than colliding them", () => {
    const index = looseIndex(["", "   ", "A-1"]);
    expect(index).not.toBeNull();
    expect(index?.size).toBe(1);
  });
});
