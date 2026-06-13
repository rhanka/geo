import { describe, expect, it } from "vitest";
import {
  isCountryCode,
  isSubdivisionCode,
  makeGeoId,
  parseGeoId,
} from "./admin.js";

describe("makeGeoId", () => {
  it("slugifies and lowercases segments joined by '/'", () => {
    expect(makeGeoId("CA", "QC", "region", "06")).toBe("ca/qc/region/06");
  });

  it("strips diacritics and non-alphanumerics", () => {
    expect(makeGeoId("CA", "QC", "Montréal (Ville)")).toBe("ca/qc/montreal-ville");
  });

  it("accepts numbers and drops empty segments", () => {
    expect(makeGeoId("ca", "", 6)).toBe("ca/6");
  });

  it("round-trips through parseGeoId", () => {
    expect(parseGeoId(makeGeoId("ca", "qc", "mrc", "660"))).toEqual([
      "ca",
      "qc",
      "mrc",
      "660",
    ]);
  });
});

describe("ISO code guards", () => {
  it("validates ISO 3166-1 alpha-2 country codes", () => {
    expect(isCountryCode("CA")).toBe(true);
    expect(isCountryCode("ca")).toBe(false);
    expect(isCountryCode("CAN")).toBe(false);
  });

  it("validates ISO 3166-2 subdivision codes", () => {
    expect(isSubdivisionCode("CA-QC")).toBe(true);
    expect(isSubdivisionCode("FR-IDF")).toBe(true);
    expect(isSubdivisionCode("CA_QC")).toBe(false);
  });
});
