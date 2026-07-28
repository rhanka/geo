import { describe, expect, it } from "vitest";

import { reviewNativeDensityDocument } from "./density-document-review.js";

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

  it("should keep an old XLS binary inconclusive instead of guessing", () => {
    const review = reviewNativeDensityDocument(Buffer.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]));
    expect(review).toMatchObject({
      disposition: "native_parse_blocked",
      blocker: "legacy-xls-native-parser-unavailable",
    });
  });
});
