import { describe, expect, it } from "vitest";

import {
  buildCasInventory,
  casObjectKey,
  planCasCopies,
  reconcileCasInventory,
  serializeCasInventory,
  type CasInventory,
  type CasTargetEntry,
} from "./cas-inventory.js";

describe("casObjectKey", () => {
  it("is content-addressed under the bascule prefix (dedup by construction)", () => {
    expect(casObjectKey("deadbeef")).toBe("geo-objects/cas/deadbeef");
    expect(casObjectKey("deadbeef", "geo-objects/cas")).toBe(casObjectKey("deadbeef"));
  });
});

describe("buildCasInventory", () => {
  it("dedups by sha256, sorts byte-order, and totals bytes", () => {
    const inv = buildCasInventory("c1", [
      { sourceKey: "raw/a/cas/bbb", sha256: "bbb", size: 20 },
      { sourceKey: "raw/a/cas/aaa", sha256: "aaa", size: 10 },
      { sourceKey: "raw/b/cas/aaa", sha256: "aaa", size: 10 }, // dup sha → collapsed
    ]);
    expect(inv.count).toBe(2);
    expect(inv.totalBytes).toBe(30);
    expect(inv.entries.map((e) => e.sha256)).toEqual(["aaa", "bbb"]); // sorted
    expect(inv.entries[0]!.sourceKey).toBe("raw/a/cas/aaa"); // first seen wins
    expect(inv.setHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("has a deterministic set hash that changes with the set", () => {
    const a = buildCasInventory("c1", [{ sourceKey: "k", sha256: "aaa", size: 1 }]);
    const b = buildCasInventory("c2", [{ sourceKey: "k2", sha256: "aaa", size: 1 }]);
    const c = buildCasInventory("c1", [{ sourceKey: "k", sha256: "bbb", size: 1 }]);
    expect(a.setHash).toBe(b.setHash); // set hash ignores cycleId + sourceKey
    expect(a.setHash).not.toBe(c.setHash); // different sha set
  });

  it("handles the empty set", () => {
    const inv = buildCasInventory("c0", []);
    expect(inv.count).toBe(0);
    expect(inv.totalBytes).toBe(0);
    expect(inv.setHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("serializeCasInventory", () => {
  it("is deterministic, newline-terminated, and round-trips", () => {
    const inv = buildCasInventory("c1", [{ sourceKey: "raw/a/cas/aaa", sha256: "aaa", size: 5 }]);
    const s = serializeCasInventory(inv);
    expect(s.endsWith("\n")).toBe(true);
    expect(serializeCasInventory(inv)).toBe(s);
    expect(JSON.parse(s).setHash).toBe(inv.setHash);
  });
});

describe("planCasCopies", () => {
  const inv = buildCasInventory("c1", [
    { sourceKey: "raw/a/cas/aaa", sha256: "aaa", size: 1 },
    { sourceKey: "raw/a/cas/bbb", sha256: "bbb", size: 1 },
    { sourceKey: "raw/a/cas/ccc", sha256: "ccc", size: 1 },
  ]);

  it("copies only the sha256s absent from the backup (dedup)", () => {
    expect(planCasCopies(inv, new Set(["bbb"]))).toEqual(["aaa", "ccc"]);
  });

  it("copies nothing when the backup already holds the whole set", () => {
    expect(planCasCopies(inv, new Set(["aaa", "bbb", "ccc"]))).toEqual([]);
  });

  it("copies everything against an empty backup", () => {
    expect(planCasCopies(inv, new Set())).toEqual(["aaa", "bbb", "ccc"]);
  });
});

describe("reconcileCasInventory", () => {
  const inv: CasInventory = buildCasInventory("c1", [
    { sourceKey: "raw/a/cas/aaa", sha256: "aaa", size: 10 },
    { sourceKey: "raw/a/cas/bbb", sha256: "bbb", size: 20 },
  ]);

  it("passes when every sha is present with matching size", () => {
    const target = new Map<string, CasTargetEntry>([
      ["geo-objects/cas/aaa", { size: 10, versionId: "v1" }],
      ["geo-objects/cas/bbb", { size: 20 }], // versioning off: no version-id, still fine (QUALIF 3)
    ]);
    const r = reconcileCasInventory(inv, target);
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(2);
    expect(r.missing).toEqual([]);
    expect(r.sizeMismatch).toEqual([]);
  });

  it("fails closed on a missing object", () => {
    const target = new Map<string, CasTargetEntry>([["geo-objects/cas/aaa", { size: 10 }]]);
    const r = reconcileCasInventory(inv, target);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["bbb"]);
  });

  it("fails closed on a size mismatch", () => {
    const target = new Map<string, CasTargetEntry>([
      ["geo-objects/cas/aaa", { size: 10 }],
      ["geo-objects/cas/bbb", { size: 999 }],
    ]);
    const r = reconcileCasInventory(inv, target);
    expect(r.ok).toBe(false);
    expect(r.sizeMismatch).toEqual([{ sha256: "bbb", expected: 20, actual: 999 }]);
  });
});
