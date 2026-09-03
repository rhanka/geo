/**
 * Pure tests for the preprod mirror logic — proves full-mirror selection + the
 * coherence manifest build WITHOUT any live S3 (§5/§6.1, ADR-0027 §7 A5).
 */

import { describe, expect, it } from "vitest";

import {
  buildCoherenceManifest,
  coherenceManifestKeyFor,
  computeSetHash,
  DEFAULT_MAX_DELETE_FRACTION,
  destKeyForMirror,
  isPreprodNativeCollectionId,
  isPreprodNativeKey,
  planFullMirror,
  PREPROD_NATIVE_FAMILIES,
  prodMirrorCollectionIds,
  pruneBoundExceeded,
} from "./mirror.js";

describe("destKeyForMirror", () => {
  it("remaps a source key to the same relative path under the dest prefix", () => {
    expect(destKeyForMirror("normalized/ca-qc-sda/qc-regions.geojson", "normalized", "normalized")).toBe(
      "normalized/ca-qc-sda/qc-regions.geojson",
    );
    expect(destKeyForMirror("normalized/abercorn.geojson", "normalized", "mirror")).toBe(
      "mirror/abercorn.geojson",
    );
  });

  it("tolerates slash-padded prefixes and an empty dest prefix", () => {
    expect(destKeyForMirror("normalized/x.geojson", "/normalized/", "")).toBe("x.geojson");
  });
});

describe("planFullMirror", () => {
  const srcPrefix = "normalized";
  const destPrefix = "normalized";
  const keys = [
    "normalized/abercorn.geojson", // bare-slug — a whitelist would drop this
    "normalized/qc-lots-montreal.geojson",
    "normalized/qc-zonage-x/qc-zonage-x.geojson", // nested layout
    "normalized/_replaced/qc-zonage-x__flat.2026.geojson", // operator backup — mirrored for byte-parity
    "normalized/ca-qc-sda/regions.meta.json",
  ];

  it("copies EVERY source object (full mirror, no whitelist)", () => {
    const plan = planFullMirror(keys, srcPrefix, destPrefix);
    expect(plan.copies.map((c) => c.srcKey).sort()).toEqual([...keys].sort());
    expect(plan.copies.every((c) => c.destKey === c.srcKey)).toBe(true); // same prefix → identity
    expect(plan.skipped).toEqual([]);
  });

  it("excludes a stray source coherence.json so the stamped manifest is not clobbered", () => {
    const plan = planFullMirror([...keys, "normalized/coherence.json"], srcPrefix, destPrefix);
    expect(plan.coherenceKey).toBe("normalized/coherence.json");
    expect(plan.copies.map((c) => c.srcKey)).not.toContain("normalized/coherence.json");
    expect(plan.skipped).toEqual(["normalized/coherence.json"]);
  });

  it("computes the coherence key under an empty prefix as the bare basename", () => {
    expect(coherenceManifestKeyFor("")).toBe("coherence.json");
    expect(coherenceManifestKeyFor("normalized")).toBe("normalized/coherence.json");
  });
});

describe("planFullMirror — prune (exact SERVED parity, preserves provenance)", () => {
  const srcPrefix = "normalized";
  const destPrefix = "normalized";
  const srcKeys = ["normalized/abercorn.geojson", "normalized/qc-lots-montreal.geojson"];

  it("prunes a CANONICAL surplus key (served-eligible, matches no source)", () => {
    const destKeys = [
      "normalized/abercorn.geojson", // mirrored — keep
      "normalized/qc-lots-montreal.geojson", // mirrored — keep
      "normalized/qc-zonage-stale.geojson", // canonical surplus (no source) — PRUNE
    ];
    const plan = planFullMirror(srcKeys, srcPrefix, destPrefix, destKeys);
    expect(plan.deletes).toEqual(["normalized/qc-zonage-stale.geojson"]);
  });

  it("PRESERVES all non-canonical provenance — never prunes backups/prebackups/sidecars/manifest", () => {
    const destKeys = [
      "normalized/abercorn.geojson", // mirrored
      "normalized/_replaced/qc-zonage-x__flat.2026-08-21T00Z.geojson", // backup — preserve
      "normalized/_zone-source-fold-backups/2026-08-20/qc-lots-y.geojson", // backup — preserve
      "normalized/qc-zonage-z.additive-prebackup.geojson", // prebackup — preserve
      "normalized/qc-zonage-w.contour-auto-preclip.geojson", // sidecar — preserve
      "normalized/coherence.json", // manifest — preserve
    ];
    const plan = planFullMirror(srcKeys, srcPrefix, destPrefix, destKeys);
    expect(plan.deletes).toEqual([]); // no canonical surplus; all non-canonical preserved
  });

  it("never prunes a canonical key already present in source", () => {
    const plan = planFullMirror(srcKeys, srcPrefix, destPrefix, ["normalized/abercorn.geojson"]);
    expect(plan.deletes).toEqual([]);
  });

  it("refuses to prune against an EMPTY source (mass-delete guard #1)", () => {
    const destKeys = ["normalized/anything.geojson", "normalized/else.geojson"];
    const plan = planFullMirror([], srcPrefix, destPrefix, destKeys);
    expect(plan.deletes).toEqual([]);
    expect(plan.copies).toEqual([]);
  });

  it("computes no deletes when no dest listing is supplied (add-only compat)", () => {
    expect(planFullMirror(srcKeys, srcPrefix, destPrefix).deletes).toEqual([]);
  });
});

describe("pruneBoundExceeded (safety bound #2)", () => {
  it("passes a normal prune (762/4647 ≈ 16% < 25%)", () => {
    expect(pruneBoundExceeded(762, 4647, DEFAULT_MAX_DELETE_FRACTION)).toBe(false);
  });

  it("trips a runaway prune (broken source would delete most of the dest)", () => {
    expect(pruneBoundExceeded(3000, 4000, DEFAULT_MAX_DELETE_FRACTION)).toBe(true);
  });

  it("never trips when there is nothing to delete; trips defensively on a known-empty dest", () => {
    expect(pruneBoundExceeded(0, 4647, DEFAULT_MAX_DELETE_FRACTION)).toBe(false);
    expect(pruneBoundExceeded(0, 0, DEFAULT_MAX_DELETE_FRACTION)).toBe(false);
    expect(pruneBoundExceeded(5, 0, DEFAULT_MAX_DELETE_FRACTION)).toBe(true);
  });
});

describe("computeSetHash", () => {
  it("is order- and duplicate-independent (hashes the SET of ids)", () => {
    const a = computeSetHash(["abercorn", "acton-vale", "qc-lots-montreal"]);
    const b = computeSetHash(["qc-lots-montreal", "abercorn", "acton-vale", "abercorn"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it("differs when the set differs (a drop+add keeping count equal)", () => {
    const base = computeSetHash(["a", "b", "c"]);
    const dropAdd = computeSetHash(["a", "b", "d"]); // same count, different set
    expect(dropAdd).not.toBe(base);
  });
});

describe("preprod-native families (ADR-0027 (b) exclude-from-parity)", () => {
  it("names CPTAQ as preprod-native — a committed list, not a silent substring filter", () => {
    expect(PREPROD_NATIVE_FAMILIES.map((f) => f.collectionId)).toEqual(["ca-qc-constraints"]);
    // each entry is auditable (key prefix + reason present)
    expect(PREPROD_NATIVE_FAMILIES.every((f) => f.keyPrefix.length > 0 && f.reason.length > 0)).toBe(true);
  });

  it("isPreprodNativeCollectionId matches the family root + its slug children, not siblings (fail-closed)", () => {
    expect(isPreprodNativeCollectionId("ca-qc-constraints")).toBe(true);
    expect(isPreprodNativeCollectionId("ca-qc-constraints-warden")).toBe(true);
    expect(isPreprodNativeCollectionId("ca-qc-constraints-saint-stanislas-de-kostka")).toBe(true);
    // NOT excluded — real prod-mirror / unknown families stay IN the parity check (never silently dropped)
    expect(isPreprodNativeCollectionId("ca-qc-sda")).toBe(false);
    expect(isPreprodNativeCollectionId("qc-zonage-abercorn")).toBe(false);
    expect(isPreprodNativeCollectionId("ca-qc-constraintsX")).toBe(false); // no "-" boundary → not a family child
  });

  it("prodMirrorCollectionIds drops preprod-native, keeps prod-mirror — CPTAQ transparent to parity", () => {
    const live = ["abercorn", "qc-lots-montreal", "ca-qc-constraints-warden", "ca-qc-constraints-sutton"];
    expect(prodMirrorCollectionIds(live)).toEqual(["abercorn", "qc-lots-montreal"]);
    // the parity hash over the mirror subset is UNCHANGED by CPTAQ's presence in the live set
    expect(computeSetHash(prodMirrorCollectionIds(live))).toBe(computeSetHash(["abercorn", "qc-lots-montreal"]));
  });

  it("isPreprodNativeKey matches served keys under the family prefix (mirror prune protection)", () => {
    expect(isPreprodNativeKey("normalized/ca-qc-constraints/ca-qc-constraints-warden.geojson")).toBe(true);
    expect(isPreprodNativeKey("normalized/ca-qc-constraints/ca-qc-constraints-sutton/ca-qc-constraints-sutton.geojson")).toBe(true);
    expect(isPreprodNativeKey("normalized/abercorn.geojson")).toBe(false);
  });

  it("planFullMirror never prunes a preprod-native canonical key — a re-sync must not wipe CPTAQ", () => {
    const srcKeys = ["normalized/abercorn.geojson"]; // prod source (no CPTAQ — CPTAQ is 0 in prod)
    const destKeys = [
      "normalized/abercorn.geojson", // mirrored — keep
      "normalized/ca-qc-constraints/ca-qc-constraints-warden.geojson", // preprod-native canonical — PRESERVE
      "normalized/qc-zonage-stale.geojson", // real canonical surplus — PRUNE
    ];
    const plan = planFullMirror(srcKeys, "normalized", "normalized", destKeys);
    expect(plan.deletes).toEqual(["normalized/qc-zonage-stale.geojson"]);
    expect(plan.deletes).not.toContain("normalized/ca-qc-constraints/ca-qc-constraints-warden.geojson");
  });
});

describe("buildCoherenceManifest", () => {
  it("builds the manifest and defaults prod_watermark to coherence_id", () => {
    const m = buildCoherenceManifest({
      coherenceId: "w-2026-08-18T00Z",
      servedCount: 3885,
      setHash: "deadbeef",
      generatedAt: "2026-08-18T00:00:00.000Z",
    });
    expect(m).toEqual({
      coherence_id: "w-2026-08-18T00Z",
      served_count: 3885,
      set_hash: "deadbeef",
      generated_at: "2026-08-18T00:00:00.000Z",
      prod_watermark: "w-2026-08-18T00Z",
    });
  });

  it("keeps an explicit prod_watermark", () => {
    const m = buildCoherenceManifest({
      coherenceId: "w-1",
      servedCount: 0,
      setHash: "h",
      generatedAt: "2026-08-18T00:00:00.000Z",
      prodWatermark: "snap-42",
    });
    expect(m.prod_watermark).toBe("snap-42");
  });

  it("fails closed on a missing/invalid served_count (completeness proof)", () => {
    expect(() =>
      buildCoherenceManifest({ coherenceId: "w", servedCount: Number.NaN, setHash: "h", generatedAt: "t" }),
    ).toThrow(/servedCount/);
    expect(() =>
      buildCoherenceManifest({ coherenceId: "w", servedCount: -1, setHash: "h", generatedAt: "t" }),
    ).toThrow(/servedCount/);
    expect(() =>
      buildCoherenceManifest({ coherenceId: "w", servedCount: 1.5, setHash: "h", generatedAt: "t" }),
    ).toThrow(/servedCount/);
  });

  it("fails closed on an empty set_hash (parity proof)", () => {
    expect(() =>
      buildCoherenceManifest({ coherenceId: "w", servedCount: 1, setHash: "", generatedAt: "t" }),
    ).toThrow(/setHash/);
  });

  it("fails closed on an empty coherenceId", () => {
    expect(() =>
      buildCoherenceManifest({ coherenceId: "", servedCount: 1, setHash: "h", generatedAt: "t" }),
    ).toThrow(/coherenceId/);
  });
});
