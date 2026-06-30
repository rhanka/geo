import { describe, expect, it } from "vitest";

import type { GeoRef } from "./t1-georef.js";
import { extractLabelsFromWords, type RawLabel } from "./t1-labels.js";

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
});
