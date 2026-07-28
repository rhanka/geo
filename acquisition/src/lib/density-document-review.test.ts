import { describe, expect, it } from "vitest";

import {
  assembleWaybackPdfRanges,
  hasDatedFinalAdoption,
  reviewNativeDensityDocument,
} from "./density-document-review.js";

describe("native density document review", () => {
  it("should surface verbatim density text only as review-required", () => {
    const review = reviewNativeDensityDocument(Buffer.from(
      JSON.stringify({
        owner: "Municipalité de Ville Test",
        legal: "Règlement numéro 2024-12 adopté le 4 mars 2024",
        zone: "H-12",
        norme: "Densité nette : 24 logements / hectare",
      }),
    ), "", { municipalityName: "Ville Test" });
    expect(review.disposition).toBe("candidate_review_required");
    expect(review.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "densite",
        verbatim: expect.stringContaining("24 logements / hectare"),
      }),
    ]));
    expect(review.normValueHits).toEqual(expect.arrayContaining([
      expect.objectContaining({ rawValues: ["24"], unit: "densite-explicite" }),
    ]));
    expect(review.dateSignals[0]).toContain("2024-12");
    expect(review.identitySignals[0]).toContain("Municipalité de Ville Test");
  });

  it("should exclude a project even when it carries a density value", () => {
    const review = reviewNativeDensityDocument(Buffer.from(
      "<html>Premier projet de règlement — zone H-12 — 24 log./ha</html>",
    ));
    expect(review.disposition).toBe("project_excluded");
    expect(review.hits).toEqual([]);
    expect(review.normValueHits).toEqual([]);
  });

  it("should not mistake a dated final adoption chronology for a project", () => {
    const text = [
      "Municipalité de La Minerve",
      "Adoption du projet de règlement : 2 avril 2024",
      "Adoption du règlement : 3 juin 2024",
      "Entrée en vigueur : 7 août 2024",
      "ZONE RT-06",
      "Densité d’occupation au sol maximale : 10 logements à l’hectare",
    ].join("\n");
    const review = reviewNativeDensityDocument(
      Buffer.from(`<html>${text}</html>`),
      "https://municipalite.example/reglement.pdf",
    );

    expect(hasDatedFinalAdoption(text)).toBe(true);
    expect(review.disposition).toBe("candidate_review_required");
  });

  it("should recognize the municipal 'Règlement adopté le' chronology variant", () => {
    const text = [
      "MUNICIPALITÉ DE NOTRE-DAME-DE-LOURDES",
      "Adoption du projet de règlement : 18 janvier 2023",
      "Règlement adopté le : 13 février 2023",
      "Entrée en vigueur le : 13 avril 2023",
      "Zone H-16",
      "Densité maximale : 2",
    ].join("\n");
    const review = reviewNativeDensityDocument(
      Buffer.from(`<html>${text}</html>`),
      "https://municipalite.example/reglement.pdf",
    );

    expect(hasDatedFinalAdoption(text)).toBe(true);
    expect(review.disposition).toBe("candidate_review_required");
  });

  it("should keep a project marker in the source URL absolute", () => {
    const text = [
      "Adoption du règlement : 3 juin 2024",
      "Entrée en vigueur : 7 août 2024",
      "ZONE RT-06",
      "Densité maximale : 10 logements à l’hectare",
    ].join("\n");
    const review = reviewNativeDensityDocument(
      Buffer.from(`<html>${text}</html>`),
      "https://municipalite.example/projet-de-reglement.pdf",
    );

    expect(review.disposition).toBe("project_excluded");
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
