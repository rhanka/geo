import { describe, expect, it } from "vitest";

import {
  documentedNoDocumentReason,
  foundDensityDocuments,
  originalDocumentHost,
} from "./density-document-final-report.js";

const candidate = {
  url: "https://ville.example/annexe.pdf",
  retrievedAt: "2026-07-28T06:00:00.000Z",
  disposition: "candidate_review_required",
  normValueHits: [{
    page: 4,
    zoneCodes: ["H-1"],
    rawValues: ["25"],
    unit: "logements/hectare",
    verbatim: "Densité nette Maximum 25",
  }],
  dateSignals: ["Mise à jour juillet 2026"],
};

describe("density document final report", () => {
  it("counts a native numeric passage with its dated URL and verbatim", () => {
    expect(foundDensityDocuments([candidate], new Map())).toEqual([{
      url: candidate.url,
      captureDate: "2026-07-28",
      documentDateSignals: ["Mise à jour juillet 2026"],
      verbatimDensityPassages: ["Densité nette Maximum 25"],
    }]);
  });

  it("excludes project paths and manually reviewed layout false positives", () => {
    expect(foundDensityDocuments(
      [{ ...candidate, url: "https://ville.example/projets-reglements/grille.pdf" }],
      new Map(),
    )).toEqual([]);
    expect(foundDensityDocuments(
      [candidate],
      new Map([[candidate.url, "date alignée après une cellule vide"]]),
    )).toEqual([]);
  });

  it("keeps a blocked capture distinct from a measured absence", () => {
    expect(documentedNoDocumentReason(
      "capture_or_native_parse_blocked",
      "recherche inconclusive",
      ["pdf-without-native-text-layer"],
    )).toContain("pdf-without-native-text-layer");
  });

  it("verifies the original municipal owner behind a Wayback URL", () => {
    expect(originalDocumentHost(
      "https://web.archive.org/web/20240101id_/http://www.ville.example/docs/grille.pdf",
    )).toBe("ville.example");
    expect(originalDocumentHost("https://www.ville.example/grille.pdf")).toBe("ville.example");
  });
});
