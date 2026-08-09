import { describe, expect, it } from "vitest";

import {
  legalDateFollowUps,
  legalDateFragments,
  legalDateSourceHint,
  legalDateTextState,
} from "./legal-date-capture-review.js";

describe("legal date capture review", () => {
  it("should retain only linked legal-date discovery targets without fetching them", () => {
    const targets = legalDateFollowUps(`
      <a href="/avis-public-entree-en-vigueur-reglement-148-2023.pdf">avis</a>
      <a href="https://cdn.example.org/certificat-conformite.pdf">certificat</a>
      <a href="/nouvelles">nouvelle</a>
    `, "https://ormstown.example/urbanisme");

    expect(targets).toEqual([
      {
        url: "https://ormstown.example/avis-public-entree-en-vigueur-reglement-148-2023.pdf",
        hint: "avis-public-candidate",
        external_host: false,
      },
      {
        url: "https://cdn.example.org/certificat-conformite.pdf",
        hint: "certificat-mrc-candidate",
        external_host: true,
      },
    ]);
  });

  it("should read legal targets from a sitemap without treating it as proof", () => {
    expect(legalDateFollowUps(`
      <urlset><url><loc>https://mrc.example/avis-public-entree-en-vigueur.pdf</loc></url></urlset>
    `, "https://mrc.example/sitemap.xml")).toEqual([
      {
        url: "https://mrc.example/avis-public-entree-en-vigueur.pdf",
        hint: "avis-public-candidate",
        external_host: false,
      },
    ]);
  });

  it("should retain a MRC minute as ambiguous instead of a legal-date conclusion", () => {
    expect(legalDateSourceHint("Procès-verbal de la séance du conseil de la MRC")).toBe("pv-mrc-ambiguous");
    expect(legalDateFragments([
      "MRC du Test",
      "PROCÈS-VERBAL de la séance du conseil",
      "Le règlement de zonage numéro 148-2023 est conforme.",
    ].join("\n"))).toEqual(expect.arrayContaining([
      expect.objectContaining({ hint: "pv-mrc-ambiguous", page: null }),
    ]));
  });

  it("should distinguish an absent PDF text layer from a textual miss", () => {
    expect(legalDateTextState(null, "pdf-without-native-text-layer")).toBe("native-text-absent");
    expect(legalDateTextState(null, "pdftotext-exit-1:broken")).toBe("extractor-error");
    expect(legalDateTextState("Règlement de zonage", null)).toBe("native-text");
    expect(legalDateFragments("Règlement de zonage sans date imprimée")).toEqual([
      expect.objectContaining({ hint: "legal-date-context" }),
    ]);
  });
});
