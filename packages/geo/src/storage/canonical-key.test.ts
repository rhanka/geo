import { describe, expect, it } from "vitest";

import { canonicalServedIds, isCanonicalGeojsonKey, stemOf } from "./canonical-key.js";

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

describe("stemOf", () => {
  it("returns the basename without directory nor .geojson suffix", () => {
    expect(stemOf("normalized/ca-qc-sda/qc-lots-montreal.geojson")).toBe("qc-lots-montreal");
    expect(stemOf("abercorn.geojson")).toBe("abercorn");
  });
});

describe("canonicalServedIds", () => {
  it("derives the canonical served id SET (filter + stem + dedup flat/nested + sort)", () => {
    const keys = [
      "normalized/abercorn.geojson", // canonical
      "normalized/qc-zonage-x.geojson", // flat
      "normalized/qc-zonage-x/qc-zonage-x.geojson", // nested — SAME stem → collapses to one id
      "normalized/qc-lots-montreal.geojson", // canonical
      "normalized/_replaced/qc-zonage-x__flat.2026-08-21T00Z.geojson", // backup — excluded
      "normalized/qc-zonage-x.additive-prebackup.geojson", // prebackup — excluded
      "normalized/coherence.json", // non-geojson — excluded
    ];
    expect(canonicalServedIds(keys)).toEqual(["abercorn", "qc-lots-montreal", "qc-zonage-x"]);
  });

  it("is stable regardless of listing order (a SET, deduped + sorted)", () => {
    const a = canonicalServedIds(["normalized/b.geojson", "normalized/a.geojson", "normalized/a.geojson"]);
    const b = canonicalServedIds(["normalized/a.geojson", "normalized/b.geojson"]);
    expect(a).toEqual(["a", "b"]);
    expect(a).toEqual(b);
  });
});
