import { describe, expect, it } from "vitest";

import {
  assertCompleteAllCoverage,
  deriveFallbackSourceLinks,
  parseSourceLinkExport,
  patchFeatures,
  verifyPatchedFeatures,
  type ZoneSourceLink,
} from "./fold-zone-source-provenance-to-zonage.js";

const link: ZoneSourceLink = {
  slug: "example",
  collectionKey: "normalized/ca-qc-zonage/qc-zonage-example.geojson",
  url: null,
  level: "orphan",
  evidenceRef: "q:0:i",
};

describe("fold-zone-source-provenance-to-zonage", () => {
  it("should derive the retained fallback links without promoting incomplete identities", () => {
    const links = deriveFallbackSourceLinks();
    expect(links).toHaveLength(871);
    expect(links.filter((entry) => entry.url !== null)).toHaveLength(529);
    expect(links.filter((entry) => entry.level === "historical-verified")).toHaveLength(27);
    expect(links.filter((entry) => entry.level === "legacy-traceable")).toHaveLength(700);
    expect(links.filter((entry) => entry.level === "candidate")).toHaveLength(32);
    expect(links.filter((entry) => entry.level === "orphan")).toHaveLength(112);
    expect(links.find((entry) => entry.slug === "adstock")).toMatchObject({
      url: "https://geoserver.geocentralis.com/geoserver/ows#evb:zonage_municipal[id_municipalite=31056]",
      level: "legacy-traceable",
    });
    expect(links.find((entry) => entry.slug === "armagh")).toMatchObject({ url: null, level: "candidate" });
  });

  it("should preserve a source-link export URL verbatim", () => {
    const links = parseSourceLinkExport({
      rows: [{
        slug: "trois-rivieres",
        collection_key: "normalized/ca-qc-zonage/qc-zonage-trois-rivieres.geojson",
        provenance_state: "historical-verified",
        retained_source_url: "https://example.test/plan%20de%20zonage.pdf#feuille-1",
        evidence_ref: "h:0:i",
      }],
    });
    expect(links[0]).toMatchObject({ url: "https://example.test/plan%20de%20zonage.pdf#feuille-1", level: "historical-verified" });
    expect(() => assertCompleteAllCoverage(links)).toThrow("complete 871-collection provenance manifest");
    expect(() => parseSourceLinkExport({ rows: [{
      slug: "example",
      collection_key: "normalized/ca-qc-zonage/qc-zonage-example.geojson",
      provenance_state: "orphan",
      evidence_ref: "q:0:i",
    }] })).toThrow("missing retained_source_url");
  });

  it("should add literal null plus level idempotently and strip only its two fields", () => {
    const collection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { zone: "R-1", unrelated: true } },
        { type: "Feature", properties: null },
      ],
    };
    expect(patchFeatures(collection, link, false)).toMatchObject({ changed: true, changedProperties: 4 });
    verifyPatchedFeatures(collection, link, false);
    expect(collection.features[0]!.properties).toMatchObject({
      unrelated: true,
      zone_source_url: null,
      zone_source_level: "orphan",
    });
    expect(patchFeatures(collection, link, false)).toMatchObject({ changed: false, changedProperties: 0 });
    expect(patchFeatures(collection, link, true)).toMatchObject({ changed: true, changedProperties: 4 });
    verifyPatchedFeatures(collection, link, true);
    expect(collection.features[0]!.properties).toEqual({ zone: "R-1", unrelated: true });
  });
});
