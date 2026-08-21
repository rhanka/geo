import { describe, expect, it } from "vitest";

import { isCanonicalGeojsonKey } from "./canonical-key.js";

describe("isCanonicalGeojsonKey — index/mirror admission (ADR-0027)", () => {
  it("admits canonical flat + nested keys across ALL families (not just qc-zonage)", () => {
    for (const k of [
      "normalized/abercorn.geojson", // bare municipal slug
      "normalized/ca-qc-sda/qc-lots-montreal.geojson", // qc-lots (source-namespaced)
      "normalized/qc-zonage-beaupre.geojson", // qc-zonage flat
      "normalized/qc-zonage-x/qc-zonage-x.geojson", // nested layout
      "normalized/qc-zonage-norms-laval.geojson",
      "normalized/qc-tod-brossard.geojson",
      "normalized/qc-zoning-events-saint-eustache.geojson",
    ]) {
      expect(isCanonicalGeojsonKey(k)).toBe(true);
    }
  });

  it("admits `--` homonym slugs (double hyphen is canonical, not the `__` junk marker)", () => {
    expect(isCanonicalGeojsonKey("normalized/saint-cyprien--les-etchemins.geojson")).toBe(true);
  });

  it("excludes any path segment starting with `_` (operator backups)", () => {
    expect(isCanonicalGeojsonKey("normalized/_replaced/qc-zonage-beaupre__flat.2026-08-21T00Z.geojson")).toBe(false);
    expect(isCanonicalGeojsonKey("normalized/_zone-source-fold-backups/2026-08-20/qc-lots-y.geojson")).toBe(false);
  });

  it("excludes stems containing `__` or `.` (misdeposit/prebackup/sidecar/ts-infix)", () => {
    expect(isCanonicalGeojsonKey("normalized/qc-zonage-x__flat.2026.geojson")).toBe(false);
    expect(isCanonicalGeojsonKey("normalized/qc-zonage-x.additive-prebackup.geojson")).toBe(false);
    expect(isCanonicalGeojsonKey("normalized/qc-zonage-x.contour-auto-preclip.geojson")).toBe(false);
    expect(isCanonicalGeojsonKey("normalized/qc-zonage-x.2026-08-21T00Z.geojson")).toBe(false);
  });

  it("excludes non-.geojson keys (manifests, meta sidecars)", () => {
    expect(isCanonicalGeojsonKey("normalized/coherence.json")).toBe(false);
    expect(isCanonicalGeojsonKey("normalized/qc-zonage-x.meta.json")).toBe(false);
  });
});
