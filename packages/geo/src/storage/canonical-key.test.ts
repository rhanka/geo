import { describe, expect, it } from "vitest";

import { isCanonicalGeojsonKey, servedCollectionId, servedDatasetIds, stemOf } from "./canonical-key.js";

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

describe("servedCollectionId", () => {
  it("uses datasetId when present, else the stem", () => {
    expect(servedCollectionId("abercorn", "qc-lots-abercorn")).toBe("qc-lots-abercorn");
    expect(servedCollectionId("abercorn", undefined)).toBe("abercorn");
  });
});

describe("servedDatasetIds (the ONE served-id rule, shared serving⇄stamp)", () => {
  it("keeps stem-colliding DISTINCT datasets separate (abercorn zonage vs qc-lots-abercorn) — no data-loss merge", () => {
    const entries = [
      { key: "normalized/abercorn.geojson" }, // zonage, no datasetId → id "abercorn"
      { key: "normalized/qc-cadastre-lots/abercorn.geojson", datasetId: "qc-lots-abercorn" }, // lots
    ];
    expect(servedDatasetIds(entries)).toEqual(["abercorn", "qc-lots-abercorn"]);
  });

  it("STAMP-SET == SERVED-SET by construction (same fn both sides, incl. datasetId != stem)", () => {
    const entries = [
      { key: "normalized/qc-zonage-x.geojson", datasetId: undefined },
      { key: "normalized/ca-qc-sda/regions.geojson", datasetId: "ca-qc-regions" }, // datasetId != stem
      { key: "normalized/qc-cadastre-lots/abercorn.geojson", datasetId: "qc-lots-abercorn" },
      { key: "normalized/abercorn.geojson", datasetId: undefined }, // stem collision with the lots one
      { key: "normalized/_replaced/qc-zonage-x__flat.2026.geojson", datasetId: undefined }, // junk — excluded
    ];
    const stampSet = servedDatasetIds(entries);
    // "serving-side" recompute: same servedCollectionId per canonical key, deduped + sorted.
    const servedSet = [
      ...new Set(
        entries
          .filter((e) => isCanonicalGeojsonKey(e.key))
          .map((e) => servedCollectionId(stemOf(e.key), e.datasetId)),
      ),
    ].sort();
    expect(stampSet).toEqual(servedSet);
    expect(stampSet).toEqual(["abercorn", "ca-qc-regions", "qc-lots-abercorn", "qc-zonage-x"]);
  });

  it("dedups flat + nested of the same collection (same served id)", () => {
    const entries = [
      { key: "normalized/qc-zonage-x.geojson" },
      { key: "normalized/qc-zonage-x/qc-zonage-x.geojson" }, // nested, same stem, no datasetId → same id
    ];
    expect(servedDatasetIds(entries)).toEqual(["qc-zonage-x"]);
  });

  it("excludes non-canonical keys even if they carry a datasetId (rejected on the raw key)", () => {
    const entries = [
      { key: "normalized/qc-zonage-x.geojson" },
      { key: "normalized/_replaced/x__flat.2026.geojson", datasetId: "should-be-ignored" },
      { key: "normalized/x.additive-prebackup.geojson", datasetId: "ignored" },
      { key: "normalized/coherence.json" },
    ];
    expect(servedDatasetIds(entries)).toEqual(["qc-zonage-x"]);
  });
});
