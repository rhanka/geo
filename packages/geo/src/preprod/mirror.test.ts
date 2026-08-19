/**
 * Pure tests for the preprod mirror logic — proves full-mirror selection + the
 * coherence manifest build WITHOUT any live S3 (§5/§6.1, ADR-0027 §7 A5).
 */

import { describe, expect, it } from "vitest";

import {
  buildCoherenceManifest,
  coherenceManifestKeyFor,
  computeSetHash,
  destKeyForMirror,
  planFullMirror,
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
