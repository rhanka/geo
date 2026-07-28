import { describe, expect, it } from "vitest";

import { mergeDensityNormRows, type DensityNormPatch } from "./density-document-deposit.js";

const patch: DensityNormPatch = {
  zoneCode: "A-1",
  value: 4,
  unit: "logements/terrain",
  raw: "4",
  proof: "nombre de logements / terrain (max.) 4",
  page: 7,
  sourceUrl: "https://www.example.municipal/annexe-b.pdf",
  method: "native-text/density-document-verbatim",
  snapshot: "2026-07-28",
  legalDate: "2026-06-01",
  legalDateEvidence: "Document municipal: mise à jour 2026-06-01",
};

describe("mergeDensityNormRows", () => {
  it("enriches density without changing existing norms or row provenance", () => {
    const existing = [{
      zone_code: "A1",
      hauteur_max_value: 11,
      hauteur_max_raw: "11",
      _source_url: "https://www.example.municipal/old-grid.pdf",
      _methode: "mistral-vision",
    }];
    const result = mergeDensityNormRows(existing, [patch]);
    expect(result).toMatchObject({ inserted: 0, enriched: 1, unchanged: 0 });
    expect(result.rows[0]).toMatchObject({
      zone_code: "A1",
      hauteur_max_value: 11,
      _source_url: "https://www.example.municipal/old-grid.pdf",
      densite_value: 4,
      densite_unit: "logements/terrain",
      densite_raw: "4",
      densite_confidence: 1,
      densite_source_url: patch.sourceUrl,
      densite_proof: patch.proof,
      densite_legal_date: patch.legalDate,
      densite_legal_date_evidence: patch.legalDateEvidence,
      densite_page_source: "PAGE 7 ZONE A-1",
    });
  });

  it("inserts an evidence-bound row when the zone is absent", () => {
    const result = mergeDensityNormRows([], [patch]);
    expect(result).toMatchObject({ inserted: 1, enriched: 0, unchanged: 0 });
    expect(result.rows[0]).toMatchObject({
      zone_code: "A-1",
      densite_value: 4,
      densite_source_url: patch.sourceUrl,
      _source_url: patch.sourceUrl,
    });
  });

  it("refuses a conflict with an already published density", () => {
    expect(() =>
      mergeDensityNormRows(
        [{ zone_code: "A-1", densite_value: 3, densite_unit: "logements/terrain" }],
        [patch],
      ),
    ).toThrow(/existing density conflict/);
  });

  it("preserves unrelated historical duplicate codes while enriching the target", () => {
    const result = mergeDensityNormRows(
      [
        { zone_code: "(2)", hauteur_max_value: 8 },
        { zone_code: "(2)", hauteur_max_value: 10 },
        { zone_code: "A-1", superficie_min_value: 1_500 },
      ],
      [patch],
    );
    expect(result).toMatchObject({ inserted: 0, enriched: 1, unchanged: 0 });
    expect(result.rows).toHaveLength(3);
    expect(result.rows.filter((row) => row["zone_code"] === "(2)")).toEqual([
      { zone_code: "(2)", hauteur_max_value: 8 },
      { zone_code: "(2)", hauteur_max_value: 10 },
    ]);
    expect(result.rows[2]).toMatchObject({ zone_code: "A-1", densite_value: 4 });
  });

  it("refuses to choose when the targeted zone itself is duplicated", () => {
    expect(() =>
      mergeDensityNormRows(
        [{ zone_code: "A-1" }, { zone_code: "A1" }],
        [patch],
      ),
    ).toThrow(/duplicate existing canonical zone_code targeted/);
  });

  it("refuses divergent duplicate patches and missing proof", () => {
    expect(() =>
      mergeDensityNormRows([], [patch, { ...patch, value: 5 }]),
    ).toThrow(/divergent density patches/);
    expect(() =>
      mergeDensityNormRows([], [{ ...patch, proof: "" }]),
    ).toThrow(/verbatim evidence missing/);
    expect(() =>
      mergeDensityNormRows([], [{ ...patch, legalDateEvidence: "" }]),
    ).toThrow(/dated legal evidence missing/);
  });
});
