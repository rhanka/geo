import { describe, expect, it } from "vitest";
import { classifyReglementNote } from "./reglement-double-millesime-readiness";

describe("classifyReglementNote", () => {
  it("should retain the exact prior zoning number from a replacement clause", () => {
    const result = classifyReglementNote(
      "Ce règlement remplace le Règlement de zonage URB-Z2009.",
      2017,
    );

    expect(result.bucket).toBe("ANCIEN_VERBATIM");
    expect(result.ancienNumeroVerbatim).toBe("URB-Z2009");
    expect(result.noteSpan?.text).toBe("remplace le Règlement de zonage URB-Z2009");
  });

  it("should keep an amendment list in the current-only bucket", () => {
    const result = classifyReglementNote(
      "Les X...Y listés p2 sont les AMENDEMENTS postérieurs, sans clause de remplacement.",
      2011,
    );

    expect(result.bucket).toBe("EN_VIGUEUR_SEUL");
    expect(result.ancienNumeroVerbatim).toBeNull();
  });

  it("should flag a replacement signal without a named prior base as ambiguous", () => {
    const result = classifyReglementNote(
      "Le présent règlement abroge et remplace les dispositions antérieures.",
      2024,
    );

    expect(result.bucket).toBe("REZONAGE_AMBIGU");
    expect(result.ancienNumeroVerbatim).toBeNull();
  });

  it("should not treat an amended article as a replaced prior base", () => {
    const result = classifyReglementNote(
      "Remplacement de l'article 155 du règlement de zonage numéro 771.",
      2014,
    );

    expect(result.bucket).toBe("REZONAGE_AMBIGU");
    expect(result.ancienNumeroVerbatim).toBeNull();
  });

  it("should not treat the current number as an older regulation", () => {
    const result = classifyReglementNote(
      "Le règlement remplace le règlement numéro 771.",
      2014,
      "771",
    );

    expect(result.bucket).toBe("REZONAGE_AMBIGU");
    expect(result.ancienNumeroVerbatim).toBeNull();
  });

  it("should expose a null millésime as an orthogonal flag", () => {
    const result = classifyReglementNote(
      "Ce règlement remplace le Règlement de zonage URB-Z2009.",
      null,
    );

    expect(result.bucket).toBe("ANCIEN_VERBATIM");
    expect(result.millesimeNull).toBe(true);
  });
});
