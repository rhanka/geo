import { describe, expect, it } from "vitest";

import { foldExactDensityLegalDate } from "./density-legal-date-served-fold.js";

const stamp = {
  zoneCode: "2 Rec",
  legalDate: "2012-11-08",
  legalDateEvidence: "Certificat de conformité : 8 novembre 2012",
};

describe("foldExactDensityLegalDate", () => {
  it("updates only literal zone_code equality", () => {
    const features = [
      { properties: { zone_code: "2 Rec", densite_value: 8.8 } },
      { properties: { zone_code: "2 REC", densite_value: 8.8 } },
    ];
    expect(foldExactDensityLegalDate(features, stamp)).toEqual({ matched: 1, changed: 2 });
    expect(features[0]!.properties).toMatchObject({ densite_legal_date: "2012-11-08" });
    expect(features[1]!.properties).not.toHaveProperty("densite_legal_date");
  });

  it("refuses a conflicting date instead of replacing it", () => {
    expect(() => foldExactDensityLegalDate([
      { properties: { zone_code: "2 Rec", densite_value: 8.8, densite_legal_date: "2014-01-01" } },
    ], stamp)).toThrow("served legal date conflicts");
  });

  it("reports no match rather than relaxing an absent code", () => {
    const features = [{ properties: { zone_code: "2 REC", densite_value: 8.8 } }];
    expect(foldExactDensityLegalDate(features, stamp)).toEqual({ matched: 0, changed: 0 });
    expect(features[0]!.properties).not.toHaveProperty("densite_legal_date");
  });
});
