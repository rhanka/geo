import { describe, expect, it } from "vitest";

import {
  documentMagic,
  isExcludedDocument,
  sigMetadataUrls,
  waybackRangeRequests,
} from "./density-document-discovery-run.js";
import type { DensityDiscoveryTarget } from "../../packages/qc-sources/src/sources/density-document-discovery.js";

const target: DensityDiscoveryTarget = {
  slug: "ville-test",
  name: "Ville Test",
  mamhCode: "12345",
  website: "https://ville.example",
  excludedSourceUrl: "https://ville.example/old.pdf",
  excludedSourceSha256: "a".repeat(64),
  excludedSourceStorageKey: "sources/qc-zonage-grilles/ville-test.pdf",
  baselineSnapshot: "2026-07-20",
};

describe("density document discovery cluster runner", () => {
  it("should identify captured document containers without interpreting their content", () => {
    expect(documentMagic(new TextEncoder().encode("%PDF-1.7"))).toBe("pdf");
    expect(documentMagic(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).toBe("zip");
    expect(documentMagic(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe("ole");
    expect(documentMagic(new TextEncoder().encode("<html>"))).toBe("text");
  });

  it("should reject a mirror when its captured SHA equals the old document", () => {
    const result = {
      line: { sha256: `sha256:${"a".repeat(64)}` },
    } as never;
    expect(isExcludedDocument(result, target)).toBe(true);
    expect(isExcludedDocument({
      line: { sha256: `sha256:${"b".repeat(64)}` },
    } as never, target)).toBe(false);
  });

  it("should derive ArcGIS metadata only from IDs and service URLs present verbatim", () => {
    const urls = sigMetadataUrls(
      JSON.stringify({
        item: "0123456789abcdef0123456789abcdef",
        service: "https://services1.arcgis.com/abc/ArcGIS/rest/services/Zonage/FeatureServer/0",
      }),
      "https://www.arcgis.com",
    );
    expect(urls).toEqual(expect.arrayContaining([
      "https://www.arcgis.com/sharing/rest/content/items/0123456789abcdef0123456789abcdef?f=json",
      "https://www.arcgis.com/sharing/rest/content/items/0123456789abcdef0123456789abcdef/data?f=json",
      "https://services1.arcgis.com/abc/ArcGIS/rest/services/Zonage/FeatureServer/0?f=pjson",
    ]));
  });

  it("should plan bounded Wayback ranges after the truncated first MiB", () => {
    expect(waybackRangeRequests(2_500_000)).toEqual([
      { start: 1_048_576, end: 2_097_151, last: false },
      { start: 2_097_152, end: 2_499_999, last: true },
    ]);
    expect(waybackRangeRequests(1_048_576)).toEqual([]);
    expect(waybackRangeRequests(null)).toHaveLength(64);
  });
});
