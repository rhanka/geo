import { describe, expect, it } from "vitest";

import { buildServedCanonicalIds, serializeServedCanonicalIds } from "./served-canonical-ids.js";
import {
  collectionFeaturesToRefs,
  municipalSlugFromNormalizedKey,
} from "./served-ids-mapping.js";

describe("municipalSlugFromNormalizedKey", () => {
  it("strips the served family prefix from every canonical layout", () => {
    // zones — flat and nested (geo-api serves the subfolder; same slug either way)
    expect(municipalSlugFromNormalizedKey("normalized/ca-qc-zonage/qc-zonage-westmount.geojson")).toBe("westmount");
    expect(
      municipalSlugFromNormalizedKey("normalized/ca-qc-zonage/qc-zonage-westmount/qc-zonage-westmount.geojson"),
    ).toBe("westmount");
    // lots — enriched (served) and cadastre (clipped source) fold to the same slug
    expect(municipalSlugFromNormalizedKey("normalized/qc-lots/qc-lots-laval.geojson")).toBe("laval");
    expect(municipalSlugFromNormalizedKey("normalized/qc-cadastre-lots/laval.geojson")).toBe("laval");
  });

  it("keeps a hyphenated slug and a bare grid slug intact", () => {
    expect(municipalSlugFromNormalizedKey("normalized/qc-cadastre-lots/saint-cyprien--les-etchemins.geojson")).toBe(
      "saint-cyprien--les-etchemins",
    );
    expect(municipalSlugFromNormalizedKey("normalized/ca-qc-zonage/abercorn.geojson")).toBe("abercorn");
  });

  it("norms prefix wins over the shorter zonage prefix", () => {
    expect(municipalSlugFromNormalizedKey("normalized/qc-zonage-norms-laval.geojson")).toBe("laval");
  });
});

describe("collectionFeaturesToRefs", () => {
  it("reads zone_code for a zones collection", () => {
    const refs = collectionFeaturesToRefs("normalized/ca-qc-zonage/qc-zonage-westmount.geojson", "zones", [
      { properties: { zone_code: "C408" } },
      { properties: { zone_code: "H-1" } },
    ]);
    expect(refs.lots).toEqual([]);
    expect(refs.zones).toEqual([
      { citySlug: "westmount", zoneCode: "C408" },
      { citySlug: "westmount", zoneCode: "H-1" },
    ]);
  });

  it("reads NO_LOT with a no_lot fallback for a lots collection", () => {
    const refs = collectionFeaturesToRefs("normalized/qc-lots/qc-lots-laval.geojson", "lots", [
      { properties: { NO_LOT: "1 234 567" } },
      { properties: { no_lot: "7 654 321" } }, // fallback lowercase column
      { properties: {} }, // no lot column at all → blank ref (dropped downstream)
      { properties: null },
    ]);
    expect(refs.zones).toEqual([]);
    expect(refs.lots).toEqual([
      { citySlug: "laval", noLot: "1 234 567" },
      { citySlug: "laval", noLot: "7 654 321" },
      { citySlug: "laval", noLot: undefined },
      { citySlug: "laval", noLot: undefined },
    ]);
  });

  it("feeds buildServedCanonicalIds to yield immo tokens, blanks skipped", () => {
    const zoneRefs = collectionFeaturesToRefs("normalized/ca-qc-zonage/qc-zonage-westmount.geojson", "zones", [
      { properties: { zone_code: "C408" } },
      { properties: { zone_code: null } }, // out-of-polygon / null code → skipped
    ]);
    const lotRefs = collectionFeaturesToRefs("normalized/qc-lots/qc-lots-laval.geojson", "lots", [
      { properties: { NO_LOT: "1 234 567" } },
      { properties: { NO_LOT: "   " } }, // blank → skipped
    ]);
    const ids = buildServedCanonicalIds({ zones: zoneRefs.zones, lots: lotRefs.lots });
    expect(ids).toEqual(["ogc:lots:laval:1234567", "ogc:zones:westmount:C-408"]);
    expect(serializeServedCanonicalIds(ids)).toBe("ogc:lots:laval:1234567\nogc:zones:westmount:C-408\n");
  });
});
