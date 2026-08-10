import { describe, expect, it } from "vitest";

import { deriveCapturedNormesSourceAbsenceReceipt } from "./captured-normes-source-absence-publish.js";

const directory = {
  $schema: "qc-municipal-directory/v1",
  generatedAt: "2026-06-16T00:52:48.516Z",
  source: {
    name: "MAMH — Répertoire des municipalités du Québec",
    dataset: "repertoire-des-municipalites-du-quebec",
    datasetUrl: "https://www.donneesquebec.ca/recherche/dataset/repertoire-des-municipalites-du-quebec",
    resourceUrl: "https://donneesouvertes.affmunqc.net/repertoire/MUN.csv",
    license: "cc-by-4.0",
    field: "mweb",
    joinKey: "nfd-normalized-name",
  },
  stats: { registryTotal: 1, matched: 1, withWebsite: 0, unmatched: 0 },
  entries: {
    "city-absence": {
      slug: "city-absence",
      name: "City Absence",
      mamhCode: "12345",
      mamhName: "City Absence",
      designation: "Municipalité",
      website: null,
      source: "mamh-repertoire",
      verifiedAt: "2026-06-15",
    },
    "city-with-site": {
      slug: "city-with-site",
      name: "City With Site",
      mamhCode: "54321",
      mamhName: "City With Site",
      designation: "Municipalité",
      website: "https://city.example",
      source: "mamh-repertoire",
      verifiedAt: "2026-06-15",
    },
  },
  repoCopyNote: "Versioned copy",
};

describe("deriveCapturedNormesSourceAbsenceReceipt", () => {
  it("should content-address a MAMH null-website declaration", () => {
    const bytes = Buffer.from(`${JSON.stringify(directory)}\n`);
    const result = deriveCapturedNormesSourceAbsenceReceipt(bytes, "city-absence");
    expect(result.key).toMatch(/^registry\/normes-captured-source-absence-receipts\/city-absence\/[a-f0-9]{64}\.json$/);
    expect(result.receipt.entry.website).toBeNull();
    expect(result.receipt.directory_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("should reject a directory entry that declares a website", () => {
    const withWebsite = structuredClone(directory);
    withWebsite.entries["city-absence"]!.website = "https://city.example" as never;
    expect(() => deriveCapturedNormesSourceAbsenceReceipt(Buffer.from(JSON.stringify(withWebsite)), "city-absence")).toThrow();
  });
});
