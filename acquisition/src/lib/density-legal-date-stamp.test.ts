import { describe, expect, it } from "vitest";

import { stampDensityLegalDateRows } from "./density-legal-date-stamp.js";

const row = {
  zone_code: "2 Rec",
  densite_value: 8.8,
  densite_source_url: "https://municipalite.example/grille.pdf",
  densite_source_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  densite_source_storage_key: "raw/grille/cas/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf",
};

const stamp = {
  zoneCode: "2 Rec",
  legalDate: "2012-11-08",
  legalDateEvidence: "Certificat de conformité : 8 novembre 2012; ENTRÉE EN VIGUEUR : 8 novembre 2012",
};

describe("stampDensityLegalDateRows", () => {
  it("stamps only the exact existing zone and preserves density provenance", () => {
    const result = stampDensityLegalDateRows([row, { ...row, zone_code: "2 REC" }], [stamp]);

    expect(result).toMatchObject({ stamped: 1, unchanged: 0 });
    expect(result.rows).toEqual([
      { ...row, densite_legal_date: stamp.legalDate, densite_legal_date_evidence: stamp.legalDateEvidence },
      { ...row, zone_code: "2 REC" },
    ]);
  });

  it("rejects a zone that would require any normalization", () => {
    expect(() => stampDensityLegalDateRows([row], [{ ...stamp, zoneCode: "2 REC" }]))
      .toThrow("expected one row, found 0");
  });

  it("refuses to stamp a density without immutable density provenance", () => {
    const { densite_source_storage_key: _missing, ...withoutStorage } = row;
    expect(() => stampDensityLegalDateRows([withoutStorage], [stamp]))
      .toThrow("immutable density provenance missing");
  });

  it("accepts the original row-level provenance of a base density grid", () => {
    const { densite_source_url: _url, densite_source_sha256: _sha, densite_source_storage_key: _key, ...legacy } = row;
    expect(stampDensityLegalDateRows([
      { ...legacy, _source_url: "https://municipalite.example/grille.pdf", _methode: "native", _snapshot: "2026-07-12" },
    ], [stamp])).toMatchObject({ stamped: 1 });
  });

  it("is idempotent only for the exact same legal citation", () => {
    const dated = { ...row, densite_legal_date: stamp.legalDate, densite_legal_date_evidence: stamp.legalDateEvidence };
    expect(stampDensityLegalDateRows([dated], [stamp])).toMatchObject({ stamped: 0, unchanged: 1 });
    expect(() => stampDensityLegalDateRows([dated], [{ ...stamp, legalDateEvidence: "autre" }]))
      .toThrow("existing legal date conflicts");
  });
});
