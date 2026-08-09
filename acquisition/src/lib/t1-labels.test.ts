import { describe, expect, it } from "vitest";

import type { GeoRef } from "./t1-georef.js";
import { extractLabelsFromWords, filterExtractedLabelsByDict, type RawLabel } from "./t1-labels.js";

const PAGE_W = 1000;
const PAGE_H = 1000;

function geo(): GeoRef {
  return {
    bbox: [0, 0, PAGE_W, PAGE_H],
    pageW: PAGE_W,
    pageH: PAGE_H,
    proj4def: "test",
    crsName: "test",
    corners: [],
    maxResidualM: 0,
    scaleMPerPt: 1,
    pageToLonLat: (x, y) => [x, y],
    topLeftToLonLat: (x, y) => [x, PAGE_H - y],
  };
}

function word(
  text: string,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
  blockId: number,
  lineId: number,
): RawLabel {
  return {
    text,
    pageX: (xMin + xMax) / 2,
    pageY: (yMin + yMax) / 2,
    xMin,
    yMin,
    xMax,
    yMax,
    blockId,
    lineId,
  };
}

function codes(words: RawLabel[], opts: Parameters<typeof extractLabelsFromWords>[4] = {}): string[] {
  return extractLabelsFromWords(words, PAGE_W, PAGE_H, geo(), opts).codePoints.map((p) => p.code);
}

describe("t1-labels zone-code parser", () => {
  it("preserves Carignan compound codes split across stacked PDF words", () => {
    const got = codes([
      word("MN2-", 100, 100, 130, 116, 1, 1),
      word("A-153", 101, 109, 133, 125, 1, 2),
      word("H-", 200, 100, 220, 116, 2, 3),
      word("MN1-046", 201, 112, 245, 128, 2, 4),
    ]);

    expect(got).toEqual(["MN2-A-153", "MN1-046"]);
    expect(got).not.toContain("H-MN1-046");
  });

  it("keeps Brossard multipart codes and rejects standalone suffix fragments", () => {
    const got = codes([
      word("Ha-100", 100, 100, 150, 116, 1, 1),
      word("Mc-662-S4", 200, 100, 260, 116, 2, 2),
      word("2-S", 300, 100, 320, 116, 3, 3),
      word("7-S", 340, 100, 360, 116, 4, 4),
      word("26", 400, 100, 420, 116, 5, 5),
      word("Pb", 421, 100, 440, 116, 5, 5),
      word("Co-", 500, 100, 520, 116, 6, 6),
      word("506", 501, 112, 521, 128, 6, 7),
      word("Ho", 522, 112, 542, 128, 6, 7),
      word("A10", 600, 100, 605, 104, 7, 8),
    ]);

    expect(got).toEqual(["Ha-100", "Mc-662-S4", "Co-506"]);
  });

  it("preserves Mont-Royal H prefixes split from suffix labels", () => {
    const got = codes([
      word("H", 100, 138, 118, 156, 1, 1),
      word("511-E", 110, 100, 150, 135, 1, 1),
      word("H", 200, 100, 218, 126, 2, 2),
      word("530-A", 219, 101, 260, 124, 2, 2),
      word("535-C", 300, 100, 340, 116, 3, 3),
    ]);

    expect(got).toEqual(["H-511-E", "H-530-A"]);
  });

  it("rejects pure-numeric labels by default (anti-#74)", () => {
    const got = codes([
      word("100", 100, 100, 140, 116, 1, 1),
      word("515", 200, 100, 240, 116, 2, 2),
      word("H-101", 300, 100, 340, 116, 3, 3),
    ]);
    // numerics dropped; only the lettered code survives
    expect(got).toEqual(["H-101"]);
  });

  it("admits dict-backed pure-numeric labels under the numeric relaxation", () => {
    const numericDict = new Set(["100", "515", "300"]);
    const got = codes(
      [
        word("100", 100, 100, 140, 116, 1, 1),
        word("515", 200, 100, 240, 116, 2, 2),
        word("999", 300, 100, 340, 116, 3, 3), // NOT in dict → dropped
        word("H-101", 400, 100, 440, 116, 4, 4),
      ],
      { numericDict },
    );
    expect(got.sort()).toEqual(["100", "515", "H-101"]);
    expect(got).not.toContain("999");
  });

  it("rejects NUMBER-DOMINANCE composite labels without a dict", () => {
    // matane prints "503 A" as two tokens. With no authoritative dict there is
    // nothing to bound the join → it must NOT be read as a zone code.
    const got = codes([
      word("503", 100, 100, 130, 116, 1, 1),
      word("A", 132, 100, 142, 116, 1, 1),
      word("5", 200, 100, 210, 116, 2, 2),
      word("C", 212, 100, 222, 116, 2, 2),
    ]);
    expect(got).toEqual([]);
  });

  it("admits dict-backed NUMBER-DOMINANCE composites, split or already joined", () => {
    const compositeDict = new Set(["503-A", "5-C", "17-R"]);
    const got = codes(
      [
        word("503", 100, 100, 130, 116, 1, 1), // split pair → joined
        word("A", 132, 100, 142, 116, 1, 1),
        word("5", 200, 100, 210, 116, 2, 2), // short composite (ZONE_CODE_RE alone rejects it)
        word("C", 212, 100, 222, 116, 2, 2),
        word("17-R", 300, 100, 340, 116, 3, 3), // already joined by pdftotext
        word("841", 400, 100, 430, 116, 4, 4), // NOT in dict → dropped
        word("X", 432, 100, 442, 116, 4, 4),
      ],
      { compositeDict },
    );
    expect(got.sort()).toEqual(["17-R", "5-C", "503-A"]);
    expect(got).not.toContain("841-X");
  });

  it("rejects hierarchical-vocation cadran codes without a vocation dict", () => {
    // Austin prints `1.1-RV`, `2.9-AF1`, `1.8.A-RUpe`. Digit-leading with a dotted
    // cadran prefix → ZONE_CODE_RE alone must NOT read them as zone codes.
    const got = codes([
      word("1.1-RV", 100, 100, 150, 116, 1, 1),
      word("2.9-AF1", 200, 100, 250, 116, 2, 2),
      word("1.8.A-RUpe", 300, 100, 360, 116, 3, 3),
    ]);
    expect(got).toEqual([]);
  });

  it("admits legend-vocation-gated hierarchical cadran codes (austin family)", () => {
    const vocationDict = new Set(["RV", "AF1", "RUPE", "CON", "AF2C", "A"]);
    const got = codes(
      [
        word("1.1-RV", 100, 100, 150, 116, 1, 1),
        word("2.9-AF1", 200, 100, 250, 116, 2, 2),
        word("1.8.A-RUpe", 300, 100, 360, 116, 3, 3), // PAE subseq letter in prefix
        word("4.4-AF2c", 400, 100, 450, 116, 4, 4), // vocation with trailing digit+attr
        word("2.1-CON", 500, 100, 550, 116, 5, 5),
        word("4.3-A", 600, 100, 640, 116, 6, 6), // single-letter vocation
        word("1.5-ZZ", 700, 100, 740, 116, 7, 7), // vocation NOT in legend → dropped
        word("5848029", 800, 100, 860, 116, 8, 8), // cadastral lot number → dropped
      ],
      { vocationDict },
    );
    expect(got.sort()).toEqual(["1.1-RV", "1.8.A-RUpe", "2.1-CON", "2.9-AF1", "4.3-A", "4.4-AF2c"]);
    expect(got).not.toContain("1.5-ZZ");
    expect(got).not.toContain("5848029");
  });

  it("masks Saint-Lambert title-box revision pseudo-codes", () => {
    const revisionRows = Array.from({ length: 12 }, (_, i) =>
      word(`V${i + 1}`, 520, 235 + i * 12, 535, 247 + i * 12, 1, i + 1),
    );
    const got = codes(
      [
        ...revisionRows,
        word("H-101", 100, 100, 140, 116, 2, 20),
      ],
      { excludeRegions: [{ fx0: 0.50, fy0: 0.20, fx1: 0.56, fy1: 0.40 }] },
    );

    expect(got).toEqual(["H-101"]);
  });

  it("keeps only dictionary-attested text labels and restores canonical spelling", () => {
    const extracted = extractLabelsFromWords(
      [
        word("rv-269", 100, 100, 150, 116, 1, 1),
        word("NAD83", 200, 100, 250, 116, 2, 2),
        word("Id1", 300, 100, 330, 116, 3, 3),
      ],
      PAGE_W,
      PAGE_H,
      geo(),
    );

    const filtered = filterExtractedLabelsByDict(extracted, ["RV-269", "AF-35"]);

    expect(filtered.codePoints.map((point) => point.code)).toEqual(["RV-269"]);
    expect(filtered.dictRejected).toBe(2);
    expect(filtered.nCodeLike).toBe(1);
  });
});
