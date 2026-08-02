import { describe, expect, it } from "vitest";

import { cptaqDossierAdapter } from "./zoning-events-source-cptaq.js";

describe("cptaqDossierAdapter", () => {
  it("should emit only an explicit CPTAQ dossier anchored by its verbatim dossier number", async () => {
    const adapter = cptaqDossierAdapter({
      sources: [{
        city_slug: "coaticook",
        category: "cptaq",
        dossier_url: "https://www.cptaq.gouv.qc.ca/dossiers/372876",
        dossier_number: "372876",
        date_iso: "2026-01-29",
        extrait_brut: "Dossier 372876 — exclusion de la zone agricole, zone RD-104.",
        zone_mentions: [{ mention_brute: "RD-104", page: 2 }],
      }],
    });

    await expect(adapter.detect("coaticook")).resolves.toEqual([expect.objectContaining({
      source_ref: "https://www.cptaq.gouv.qc.ca/dossiers/372876",
      detection_anchor: "372876",
      type: "cptaq",
      date_iso: "2026-01-29",
      zone_mentions: [{ mention_brute: "RD-104", page: 2 }],
    })]);
  });

  it("should drop a dossier with no proof span or no verbatim dossier anchor", async () => {
    const adapter = cptaqDossierAdapter({
      sources: [
        {
          city_slug: "coaticook",
          category: "cptaq",
          dossier_url: "https://www.cptaq.gouv.qc.ca/dossiers/372876",
          dossier_number: "372876",
          date_iso: "2026-01-29",
          extrait_brut: "   ",
        },
        {
          city_slug: "coaticook",
          category: "cptaq",
          dossier_url: "https://www.cptaq.gouv.qc.ca/dossiers/372877",
          dossier_number: "372877",
          date_iso: "2026-01-29",
          extrait_brut: "Dossier 372876 — exclusion de la zone agricole.",
        },
      ],
    });

    await expect(adapter.detect("coaticook")).resolves.toEqual([]);
    expect(adapter.observations).toEqual([
      expect.objectContaining({ state: "dossier-cptaq-drop-sans-span" }),
      expect.objectContaining({ state: "dossier-cptaq-drop-ancre-non-verbatim" }),
    ]);
  });
});
