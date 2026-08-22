import { describe, expect, it } from "vitest";

import { availableSlots, DEFAULT_PER_JOB_COST, type PerJobCost } from "./quota.js";
import type { QuotaHeadroom } from "./ports.js";

// Generous headroom so a specific dimension can be made the binding constraint.
const ROOMY: QuotaHeadroom = {
  pods: 100,
  requestsCpuMilli: 100_000,
  requestsMemoryBytes: 1_000_000 * 1024 ** 2,
  limitsCpuMilli: 100_000,
  limitsMemoryBytes: 1_000_000 * 1024 ** 2,
};

describe("availableSlots", () => {
  it("is bounded by maxActiveJobs minus what's already active", () => {
    expect(availableSlots(4, ROOMY, { maxActiveJobs: 6 })).toBe(2);
    expect(availableSlots(6, ROOMY, { maxActiveJobs: 6 })).toBe(0);
    expect(availableSlots(10, ROOMY, { maxActiveJobs: 6 })).toBe(0); // never negative
  });

  it("is bounded by pods AFTER reserving the served-API slot", () => {
    const headroom: QuotaHeadroom = { ...ROOMY, pods: 4 };
    // 4 pods - 1 reserved = 3 available, 1 pod/job
    expect(availableSlots(0, headroom, { maxActiveJobs: 100, reservePods: 1 })).toBe(3);
    // reserve everything → zero
    expect(availableSlots(0, { ...ROOMY, pods: 1 }, { maxActiveJobs: 100, reservePods: 1 })).toBe(0);
  });

  it("is bounded by the tightest quota dimension (memory requests here)", () => {
    const perJob: PerJobCost = { ...DEFAULT_PER_JOB_COST, requestsMemoryBytes: 500 * 1024 ** 2 };
    const headroom: QuotaHeadroom = { ...ROOMY, requestsMemoryBytes: 1200 * 1024 ** 2 };
    // floor(1200Mi / 500Mi) = 2, tighter than pods/cpu/maxActive
    expect(availableSlots(0, headroom, { maxActiveJobs: 100, perJob })).toBe(2);
  });

  it("binds on pods (single-pod cost) against a 6-pod quota with 1 reserved", () => {
    // pods: (6 - 1 reserved) / 1 per job = 5 ; maxActive 100-2=98 ; cpu/mem roomy → min = 5.
    expect(availableSlots(2, { ...ROOMY, pods: 6 }, { maxActiveJobs: 100, reservePods: 1 })).toBe(5);
  });

  it("rejects invalid inputs (fail-closed on garbage)", () => {
    expect(() => availableSlots(-1, ROOMY, { maxActiveJobs: 6 })).toThrow();
    expect(() => availableSlots(1.5, ROOMY, { maxActiveJobs: 6 })).toThrow();
    expect(() => availableSlots(0, ROOMY, { maxActiveJobs: 0 })).toThrow();
    expect(() => availableSlots(0, { ...ROOMY, pods: Number.NaN }, { maxActiveJobs: 6 })).toThrow();
  });
});
