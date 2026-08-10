import { describe, expect, it } from "vitest";

import {
  avisPublicsTextAdapter,
  detectAvisPublicsDocument,
} from "./zoning-events-source-avis-publics.js";

const source = {
  city_slug: "coaticook",
  url: "https://www.coaticook.ca/upload/DOCUMENTS/PV/PV20260209.pdf",
};

const text = [
  "PROCÈS-VERBAL de la séance ordinaire du conseil municipal de la ville de",
  "Coaticook tenue le lundi 9 février 2026 à compter de 19 h 30.",
  "",
  "15.7 PPCMOI - Adoption du premier projet de résolution visant",
  "à permettre la construction d'un bâtiment résidentiel de douze logements",
  "au 103-123, rue Saint-Marc (zone RD-104)",
].join("\n");

describe("detectAvisPublicsDocument", () => {
  it("should emit a source-verbatim PPCMOI with date and raw zone mention from the PDF text", () => {
    const candidates = detectAvisPublicsDocument(source, text);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      source_ref: source.url,
      url_pdf: source.url,
      type: "ppcmoi",
      date_iso: "2026-02-09",
      zone_mentions: [{ mention_brute: "RD-104", page: 1 }],
    });
    expect(candidates[0]?.extrait_brut).toContain("PPCMOI - Adoption du premier projet");
    expect(candidates[0]?.detection_anchor).toMatch(/^avis-publics:[a-f0-9]{64}$/u);
  });

  it("should drop a marker when the document does not carry a date instead of taking one from its URL", () => {
    expect(detectAvisPublicsDocument(source, "PPCMOI - zone RD-104")).toEqual([]);
  });

  it("should collapse a table-of-contents repeat into the source resolution carrying the same PPCMOI reference", () => {
    const duplicated = [
      "Séance du 9 février 2026",
      "3.1.1 PPCMOI 2026-0042 - zone RD-104",
      "",
      "Résolution 2026-02-38263",
      "3.1.1 Adoption d'une résolution PPCMOI 2026-0042 - zone RD-104",
    ].join("\n");
    const candidates = detectAvisPublicsDocument(source, duplicated);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.extrait_brut).toContain("Résolution 2026-02-38263");
  });

  it("should name a textless source without emitting a synthetic candidate", async () => {
    const adapter = avisPublicsTextAdapter({
      sources: [source],
      readText: async () => ({ text: "   " }),
    });
    await expect(adapter.detect("coaticook")).resolves.toEqual([]);
    expect(adapter.observations).toEqual([expect.objectContaining({
      state: "scan-sans-couche-texte",
      candidates_detected: 0,
    })]);
  });
});
