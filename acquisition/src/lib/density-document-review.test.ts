import { describe, expect, it } from "vitest";

import {
  assembleWaybackPdfRanges,
  reviewNativeDensityDocument,
} from "./density-document-review.js";

describe("native density document review", () => {
  it("should surface verbatim density text only as review-required", () => {
    const review = reviewNativeDensityDocument(Buffer.from(
      JSON.stringify({ zone: "H-12", norme: "Densité nette : 24 logements / hectare" }),
    ));
    expect(review.disposition).toBe("candidate_review_required");
    expect(review.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "densite",
        verbatim: expect.stringContaining("24 logements / hectare"),
      }),
    ]));
  });

  it("should exclude a project even when it carries a density value", () => {
    const review = reviewNativeDensityDocument(Buffer.from(
      "<html>Premier projet de règlement — zone H-12 — 24 log./ha</html>",
    ));
    expect(review.disposition).toBe("project_excluded");
    expect(review.hits).toEqual([]);
  });

  it("should keep a failed native XLS conversion inconclusive instead of guessing", () => {
    const review = reviewNativeDensityDocument(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      "",
      { xlsToXlsx: () => { throw new Error("corrupt-biff"); } },
    );
    expect(review).toMatchObject({
      disposition: "native_parse_blocked",
      blocker: "xls-native-convert:corrupt-biff",
    });
  });

  it("should assemble only contiguous Wayback ranges with an explicit last part", () => {
    const first = Buffer.alloc(1_048_576);
    first.write("%PDF-1.7");
    const complete = assembleWaybackPdfRanges(first, [
      { start: 1_048_576, end: 1_048_578, last: true, bytes: Buffer.from("abc") },
    ]);
    expect(complete.bytes?.length).toBe(1_048_579);
    expect(complete.blocker).toBeNull();

    expect(assembleWaybackPdfRanges(first, [
      { start: 1_048_577, end: 1_048_579, last: true, bytes: Buffer.from("abc") },
    ])).toMatchObject({ bytes: null, blocker: "wayback-range-gap-at-1048576" });
    expect(assembleWaybackPdfRanges(first, [
      { start: 1_048_576, end: 1_048_578, last: false, bytes: Buffer.from("abc") },
    ])).toMatchObject({ bytes: null, blocker: "wayback-ranges-incomplete" });
  });
});
