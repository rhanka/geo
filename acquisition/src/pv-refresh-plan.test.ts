import { describe, expect, it } from "vitest";

import {
  MAX_PV_REFRESH_BATCH,
  buildPvRefreshPlan,
  isCompatibleGenericPvManifest,
  pvManifestFingerprint,
  pvRefreshRunnerArgs,
} from "./pv-refresh-plan-lib.js";

const base = {
  asOf: "2026-07-18T00:00:00.000Z",
  refreshAfterDays: 183,
  limit: 10,
  delayMs: 2_000,
  windowDays: 183,
  cities: {
    alpha: { pv: { status: "done" as const } },
    bravo: { pv: { status: "planned" as const } },
    charlie: { pv: { status: "to-research" as const } },
  },
  configuredSources: [
    { slug: "bravo", sourceId: "pv-bravo", pvIndexUrl: "https://bravo.test/pv" },
    { slug: "alpha", sourceId: "pv-alpha", pvIndexUrl: "https://alpha.test/pv" },
  ],
};

describe("buildPvRefreshPlan", () => {
  it("should select missing configured sources before stale manifests deterministically", () => {
    const plan = buildPvRefreshPlan({
      ...base,
      inventory: [
        { key: "registry/qc-pv/outside/index.json", lastModified: "2025-01-01T00:00:00.000Z" },
        { key: "registry/qc-pv/alpha/index.json", lastModified: "2025-01-01T00:00:00.000Z" },
      ],
    });

    expect(plan.coverage).toMatchObject({
      municipalities: 3,
      s3VerifiedPresent: 1,
      matrixDone: 1,
      s3UnknownSlugs: ["outside"],
    });
    expect(plan.residual).toEqual({ total: 2, configuredMissing: ["bravo"], unconfiguredMissing: ["charlie"] });
    expect(plan.selected).toEqual([
      expect.objectContaining({ slug: "bravo", action: "deposit-missing" }),
      expect.objectContaining({ slug: "alpha", action: "revalidate-older-manifest", expectedLastModified: "2025-01-01T00:00:00.000Z" }),
    ]);
    expect(pvRefreshRunnerArgs(plan, true)).toEqual([
      "npx", "tsx", "acquisition/src/pv-index-run.ts", "--slugs", "bravo,alpha",
      "--refresh-before", "2026-01-16T00:00:00.000Z", "--delay-ms", "2000",
      "--window-days", "183", "--dry-run",
    ]);
  });

  it("should reject unsafe batch and rate settings before any runner is emitted", () => {
    expect(() => buildPvRefreshPlan({ ...base, limit: MAX_PV_REFRESH_BATCH + 1, inventory: [] })).toThrow(/limit/);
    expect(() => buildPvRefreshPlan({ ...base, delayMs: 999, inventory: [] })).toThrow(/delayMs/);
  });

  it("should make generic manifest writes semantic and refuse another source URL", () => {
    const first = {
      slug: "alpha", sourceId: "pv-alpha", pvIndexUrl: "https://alpha.test/pv", windowDays: 183, userAgent: "ua",
      _generatedAt: "2026-01-01T00:00:00Z", _refreshAdapter: "pv-index-run/v1", _note: "PV index discovered by pv-index-run.ts (generic PV adapter). test", entries: [{ url: "https://alpha.test/b.pdf", title: "B" }, { url: "https://alpha.test/a.pdf", title: "A" }],
    };
    const reordered = { ...first, _generatedAt: "2026-07-01T00:00:00Z", entries: [...first.entries].reverse() };
    expect(pvManifestFingerprint(first)).toBe(pvManifestFingerprint(reordered));
    expect(isCompatibleGenericPvManifest(first, { slug: "alpha", sourceId: "pv-alpha", pvIndexUrl: "https://alpha.test/pv" })).toBe(true);
    expect(isCompatibleGenericPvManifest(first, { slug: "alpha", sourceId: "pv-alpha", pvIndexUrl: "https://other.test/pv" })).toBe(false);
    expect(isCompatibleGenericPvManifest({ ...first, _refreshAdapter: "pv-dom-deposit/v1" }, { slug: "alpha", sourceId: "pv-alpha", pvIndexUrl: "https://alpha.test/pv" })).toBe(false);
    const legacy = { ...first } as Record<string, unknown>;
    delete legacy._refreshAdapter;
    expect(isCompatibleGenericPvManifest(legacy, { slug: "alpha", sourceId: "pv-alpha", pvIndexUrl: "https://alpha.test/pv" })).toBe(false);
    expect(isCompatibleGenericPvManifest(legacy, { slug: "alpha", sourceId: "pv-alpha", pvIndexUrl: "https://alpha.test/pv" }, true)).toBe(true);
  });
});
