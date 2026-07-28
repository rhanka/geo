import { describe, expect, it } from "vitest";

import {
  buildDocumentGap,
  measureServedDensity,
  type GapIngestReport,
} from "./density-document-served-gap.js";

function report(disposition: string, corrected = false): GapIngestReport {
  return {
    contract: "density-document-norm-ingest/v2",
    slug: "alpha",
    deposited: !corrected,
    documents: [{
      id: "historical",
      disposition,
      source: { url: "https://alpha.example/2017.pdf", legalDate: "2017" },
      crossValidation: { matchedNorms: 1, missingInSig: [] },
      ...(corrected ? {
        corroboration: {
          referenceDocumentId: "current",
          exactMatchRequired: true,
          comparedNorms: 1,
          exactMatches: 1,
        },
      } : {}),
      norms: [{ zoneCode: "A-1", value: 2, unit: "log/terrain" }],
    }, {
      id: "current",
      disposition: "publishable",
      source: { url: "https://alpha.example/2024.pdf", legalDate: "2024" },
      crossValidation: { matchedNorms: 1, missingInSig: [] },
      norms: [{ zoneCode: "A-1", value: 2, unit: "log/terrain" }],
    }],
    norms: [{
      zoneCode: "A-1",
      value: 2,
      unit: "log/terrain",
      sourceUrl: "https://alpha.example/2024.pdf",
    }],
  };
}

describe("buildDocumentGap", () => {
  it("should close an older identical publishable document as corroboration", () => {
    const result = buildDocumentGap([report("publishable")], [report("corroboration-only", true)]);
    expect(result.before).toEqual({
      documentCount: 2,
      publishableDocuments: 2,
      directlySelectedDocuments: 1,
      gapDocuments: 1,
      gapCollections: 1,
    });
    expect(result.after).toMatchObject({
      publishableDocuments: 1,
      corroborationOnlyDocuments: 1,
      remainingGapDocuments: 0,
    });
  });

  it("should refuse a correction without executable exact-match proof", () => {
    expect(() => buildDocumentGap(
      [report("publishable")],
      [report("corroboration-only")],
    )).toThrow("correction exacte non prouvée");
  });
});

describe("measureServedDensity", () => {
  it("should count only finite polygons joined to the exact sourced norm", () => {
    const norms = {
      features: [{
        properties: {
          zone_code: "A-1",
          densite_value: 2,
          densite_unit: "log/terrain",
          densite_source_url: "https://alpha.example/2024.pdf",
        },
      }],
    };
    const zonage = {
      features: [
        { properties: { zone_code: "A-1", densite_value: 2, densite_unit: "log/terrain" } },
        { properties: { zone_code: "A-2", densite_value: null, densite_unit: null } },
        { properties: { zone_code: "A-3" } },
      ],
    };
    expect(measureServedDensity(norms, zonage)).toEqual({
      polygons: 3,
      finiteDensityPolygons: 1,
      sourceMatchedDensityPolygons: 1,
      sourceUrls: ["https://alpha.example/2024.pdf"],
      unmatchedDensityZoneCodes: [],
    });
  });

  it("should not count undefined versus null as density", () => {
    expect(measureServedDensity(
      { features: [{ properties: { zone_code: "A-1", densite_value: null } }] },
      { features: [{ properties: { zone_code: "A-1" } }] },
    ).finiteDensityPolygons).toBe(0);
  });
});
