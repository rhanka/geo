import { describe, expect, it } from "vitest";

import {
  isTrivialContiguousSequence,
  nonAdmissibleCodes,
  numericDictSet,
  validateNumericRelaxation,
} from "./numeric-codes.js";

/** val-dor: 619 numeric zone codes 100..1000 with gaps (real grille). */
const valDorDict = ((): string[] => {
  const raw = [] as number[];
  for (let n = 100; n <= 1000; n++) raw.push(n);
  // drop ~30% at random-but-deterministic spots to reproduce real gaps
  return raw.filter((n) => n % 7 !== 0 || n === 100).map(String);
})();

const actonDict = ["101", "102", "103", "104", "105"]; // grille zone 101 à 105
const sainteJulienneDict = ["1", "2", "3", "4", "5"]; // degenerate 1..N (OBJECTID-like)

describe("numeric-codes: isTrivialContiguousSequence (OBJECTID fingerprint)", () => {
  it("flags a contiguous run starting at 1", () => {
    expect(isTrivialContiguousSequence([1, 2, 3, 4, 5])).toBe(true);
  });
  it("flags a contiguous run starting at 0", () => {
    expect(isTrivialContiguousSequence([0, 1, 2, 3])).toBe(true);
  });
  it("does NOT flag a contiguous run starting in the hundreds (acton-vale)", () => {
    expect(isTrivialContiguousSequence([101, 102, 103, 104, 105])).toBe(false);
  });
  it("does NOT flag a set with gaps (val-dor)", () => {
    expect(isTrivialContiguousSequence([100, 101, 103, 200, 636])).toBe(false);
  });
});

describe("numeric-codes: numericDictSet", () => {
  it("keeps only 1–4 digit pure-numeric codes", () => {
    const s = numericDictSet(["100", "H-101", "605-Cb", "1000", "12345", "REC-a"]);
    expect([...s].sort()).toEqual(["100", "1000"]);
  });
  it("keeps subdivision-suffixed numeric codes (saint-come 105-1, 503-1)", () => {
    const s = numericDictSet(["105", "105-1", "105-2", "503-1", "608-1"]);
    expect([...s].sort()).toEqual(["105", "105-1", "105-2", "503-1", "608-1"]);
  });
  it("still refuses a suffix that is not a 1–2 digit subdivision", () => {
    // `1234-5678` is a cadastral lot shape, never a zone code
    expect([...numericDictSet(["1234-5678", "12345-1"])]).toEqual([]);
  });
});

describe("numeric-codes: validateNumericRelaxation", () => {
  it("passes val-dor (619 numeric, gaps) when extracted ⊆ dict", () => {
    // all of these survive the `% 7` gap filter above (i.e. really in the dict)
    const extracted = ["100", "101", "200", "300", "515", "1000"];
    const inDict = numericDictSet(valDorDict);
    expect(extracted.every((c) => inDict.has(c))).toBe(true);
    const r = validateNumericRelaxation({ distinctExtracted: extracted, dictCodes: valDorDict });
    expect(r.ok).toBe(true);
    expect(r.numericInDict).toBe(6);
  });

  it("passes acton-vale (101..105, contiguous but min>1)", () => {
    const r = validateNumericRelaxation({ distinctExtracted: ["101", "102", "103"], dictCodes: actonDict });
    expect(r.ok).toBe(true);
  });

  it("REJECTS sainte-julienne (dict is a trivial 1..5 sequence)", () => {
    const r = validateNumericRelaxation({ distinctExtracted: ["1", "2", "3"], dictCodes: sainteJulienneDict });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/trivial contiguous 1\.\.N/);
  });

  it("REJECTS a fabricated OBJECTID range even against a real dict", () => {
    // extracted looks like feature indices 1..30, none in the val-dor dict
    const fabricated = Array.from({ length: 30 }, (_, i) => String(i + 1));
    const r = validateNumericRelaxation({ distinctExtracted: fabricated, dictCodes: valDorDict });
    expect(r.ok).toBe(false);
    // caught by the overlap guard (none of 1..30 are in the 100..1000 dict)
    expect(r.reason).toMatch(/auto-generated|trivial/);
  });

  it("REJECTS when the dict has < 3 numeric codes", () => {
    const r = validateNumericRelaxation({ distinctExtracted: ["100"], dictCodes: ["100", "H-1"] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/only 1 pure-numeric/);
  });

  it("REJECTS when extracted numeric codes are mostly outside the dict (weak overlap)", () => {
    const r = validateNumericRelaxation({
      distinctExtracted: ["100", "999", "888", "777"], // only 100 in dict
      dictCodes: actonDict,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/auto-generated/);
  });

  it("passes a pure-lettered build (no numeric codes to guard)", () => {
    const r = validateNumericRelaxation({ distinctExtracted: ["H-101", "C-2", "A-3"], dictCodes: valDorDict });
    expect(r.ok).toBe(true);
    expect(r.numericInDict).toBe(0);
  });
});

describe("numeric-codes: nonAdmissibleCodes (build gate)", () => {
  const numericDict = numericDictSet(valDorDict);
  it("admits lettered codes and dict-backed numeric codes", () => {
    expect(nonAdmissibleCodes(["H-101", "100", "515", "C-2"], numericDict)).toEqual([]);
  });
  it("rejects a numeric code that is NOT in the dict", () => {
    expect(nonAdmissibleCodes(["100", "99999"], numericDict)).toEqual(["99999"]);
  });
  it("rejects a numeric code (7) absent from the val-dor dict (dropped by gaps)", () => {
    // 105 % 7 == 0 → removed from dict → not admissible
    expect(nonAdmissibleCodes(["105"], numericDict)).toEqual(["105"]);
  });

  describe("subdivision-suffixed numeric codes (saint-come 206-1990)", () => {
    // the real saint-come shape: numeric zones split by amendment
    const stComeDict = numericDictSet(["105", "105-1", "105-2", "403-1", "411-1", "503-1", "608-1", "829"]);

    it("admits a dict-backed subdivision code (105-1) — the ABORT this fixes", () => {
      expect(nonAdmissibleCodes(["105", "105-1", "105-2", "411-1", "829"], stComeDict)).toEqual([]);
    });

    it("STILL rejects a subdivision-shaped code absent from the dict", () => {
      // the dict guard is the whole safety story: shape alone admits nothing
      expect(nonAdmissibleCodes(["105-9", "777-1"], stComeDict)).toEqual(["105-9", "777-1"]);
    });

    it("STILL rejects an old-cadastre lot number (12-3) absent from the dict", () => {
      // `\d{1,4}-\d{1,2}` also matches an old cadastral lot; only the dict separates them
      expect(nonAdmissibleCodes(["12-3"], stComeDict)).toEqual(["12-3"]);
    });

    it("REJECTS a trivial 1..N run even when suffixed codes are dict-backed", () => {
      // the OBJECTID fingerprint is judged on the bare integers, unchanged
      const r = validateNumericRelaxation({
        distinctExtracted: ["1", "2", "3", "4", "5"],
        dictCodes: ["1", "2", "3", "4", "5", "1-1"],
      });
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/trivial contiguous 1\.\.N/);
    });

    it("passes the real saint-come set (gaps, hundreds base, suffixed subdivisions)", () => {
      const r = validateNumericRelaxation({
        distinctExtracted: ["105", "105-1", "105-2", "411-1", "829"],
        dictCodes: ["105", "105-1", "105-2", "403-1", "411-1", "503-1", "608-1", "829"],
      });
      expect(r.ok).toBe(true);
    });
  });
});
