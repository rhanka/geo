import { describe, expect, it } from "vitest";

import {
  densityDocumentDisposition,
  validateHistoricalCorroboration,
} from "./density-document-reference-policy.js";

const publishable = {
  documentAnchored: true,
  projectExcluded: false,
  legalDate: "2024-10-10",
  parsedNorms: 9,
  matchedNorms: 9,
  corroborationOnly: false,
} as const;

describe("densityDocumentDisposition", () => {
  it("should keep an older matched grid as corroboration when a newer reference exists", () => {
    expect(densityDocumentDisposition({
      ...publishable,
      legalDate: "2017",
      corroborationOnly: true,
    })).toBe("corroboration-only");
  });

  it("should keep a current dated and matched grid publishable", () => {
    expect(densityDocumentDisposition(publishable)).toBe("publishable");
  });

  it("should exclude an undated grid before considering corroboration", () => {
    expect(densityDocumentDisposition({
      ...publishable,
      legalDate: null,
      corroborationOnly: true,
    })).toBe("excluded-undated");
  });

  it("should exclude a project before considering a dated match", () => {
    expect(densityDocumentDisposition({
      ...publishable,
      projectExcluded: true,
    })).toBe("excluded-project");
  });

  it("should refuse an unanchored document before overlap checks", () => {
    expect(densityDocumentDisposition({
      ...publishable,
      documentAnchored: false,
      matchedNorms: 0,
    })).toBe("refused-unanchored");
  });

  it("should refuse a document with no parsed density", () => {
    expect(densityDocumentDisposition({
      ...publishable,
      parsedNorms: 0,
      matchedNorms: 0,
    })).toBe("refused-no-publishable-density");
  });

  it("should refuse a parsed document with no SIG overlap", () => {
    expect(densityDocumentDisposition({
      ...publishable,
      matchedNorms: 0,
    })).toBe("refused-no-sig-overlap");
  });
});

describe("validateHistoricalCorroboration", () => {
  const reference = {
    id: "current",
    slug: "alpha",
    owner: "Ville Alpha",
    legalDate: "2024-10-10",
    norms: [
      { zoneCode: "A-1", value: 2, unit: "logements/batiment" },
      { zoneCode: "A-2", value: 4, unit: "logements/batiment" },
    ],
  } as const;

  it("should prove an exact older subset against the newer reference", () => {
    expect(validateHistoricalCorroboration({
      ...reference,
      id: "historical",
      legalDate: "2017",
      norms: [reference.norms[1]],
    }, reference, true)).toMatchObject({
      comparedNorms: 1,
      exactMatches: 1,
      exactMatchRequired: true,
    });
  });

  it("should refuse a divergent historical reading", () => {
    expect(() => validateHistoricalCorroboration({
      ...reference,
      id: "historical",
      legalDate: "2017",
      norms: [{ zoneCode: "A-1", value: 3, unit: "logements/batiment" }],
    }, reference, true)).toThrow("lecture divergente");
  });

  it("should refuse a historical reading absent from the newer reference", () => {
    expect(() => validateHistoricalCorroboration({
      ...reference,
      id: "historical",
      legalDate: "2017",
      norms: [{ zoneCode: "A-3", value: 1, unit: "logements/batiment" }],
    }, reference, true)).toThrow("lecture unique");
  });

  it("should refuse a date that is not strictly anterior", () => {
    expect(() => validateHistoricalCorroboration({
      ...reference,
      id: "historical",
      legalDate: "2024",
    }, reference, true)).toThrow("non antérieure");
  });

  it("should refuse a document owned by another municipality", () => {
    expect(() => validateHistoricalCorroboration({
      ...reference,
      id: "historical",
      owner: "Ville homonyme",
      legalDate: "2017",
    }, reference, true)).toThrow("propriétaire différent");
  });

  it("should refuse a document assigned to another served collection", () => {
    expect(() => validateHistoricalCorroboration({
      ...reference,
      id: "historical",
      slug: "alpha-homonyme",
      legalDate: "2017",
    }, reference, true)).toThrow("collection différente");
  });

  it("should refuse an undated historical document", () => {
    expect(() => validateHistoricalCorroboration({
      ...reference,
      id: "historical",
      legalDate: null,
    }, reference, true)).toThrow("non datée");
  });
});
