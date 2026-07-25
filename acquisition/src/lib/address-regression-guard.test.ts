import { describe, expect, it, vi } from "vitest";

import {
  AddressRegressionGuardError,
  guardedQcLotsUpload,
  readExistingStatsOrNull,
} from "./address-regression-guard.js";

describe("qc-lots address regression guard", () => {
  it("should block both canonical uploads when a zero-address candidate would erase existing addresses", async () => {
    const uploadGeoJson = vi.fn(async () => undefined);
    const uploadStats = vi.fn(async () => undefined);

    await expect(
      guardedQcLotsUpload({
        slug: "mont-tremblant",
        candidateAddressCount: 0,
        readExistingStats: async () => ({
          role: { num_with_adresse: 9_529 },
        }),
        uploadGeoJson,
        uploadStats,
      }),
    ).rejects.toThrow(
      "ADDRESS_REGRESSION_GUARD mont-tremblant: candidate output has 0 addresses and would replace 9529 existing addresses; uploads refused",
    );

    expect(uploadGeoJson).not.toHaveBeenCalled();
    expect(uploadStats).not.toHaveBeenCalled();
  });

  it("should allow both canonical uploads when --no-role has no existing product stats", async () => {
    const uploadGeoJson = vi.fn(async () => undefined);
    const uploadStats = vi.fn(async () => undefined);

    await guardedQcLotsUpload({
      slug: "new-municipality",
      candidateAddressCount: 0,
      readExistingStats: async () =>
        readExistingStatsOrNull(async () => {
          throw Object.assign(new Error("missing"), {
            Code: "NoSuchKey",
          });
        }),
      uploadGeoJson,
      uploadStats,
    });

    expect(uploadGeoJson).toHaveBeenCalledOnce();
    expect(uploadStats).toHaveBeenCalledOnce();
  });

  it("should block both uploads when existing stats cannot be checked reliably", async () => {
    const uploadGeoJson = vi.fn(async () => undefined);
    const uploadStats = vi.fn(async () => undefined);
    const unavailable = Object.assign(new Error("storage unavailable"), {
      name: "ServiceUnavailable",
      $metadata: { httpStatusCode: 503 },
    });

    let caught: unknown;
    try {
      await guardedQcLotsUpload({
        slug: "mont-tremblant",
        candidateAddressCount: 0,
        readExistingStats: async () =>
          readExistingStatsOrNull(async () => {
            throw unavailable;
          }),
        uploadGeoJson,
        uploadStats,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AddressRegressionGuardError);
    expect(caught).toMatchObject({
      message:
        "ADDRESS_REGRESSION_GUARD mont-tremblant: could not verify existing address stats (storage unavailable); uploads refused",
      cause: unavailable,
    });

    expect(uploadGeoJson).not.toHaveBeenCalled();
    expect(uploadStats).not.toHaveBeenCalled();
  });

  it("should not read previous stats when the candidate retains addresses", async () => {
    const readExistingStats = vi.fn(async () => ({
      role: { num_with_adresse: 1 },
    }));

    await guardedQcLotsUpload({
      slug: "role-enabled",
      candidateAddressCount: 1,
      readExistingStats,
      uploadGeoJson: async () => undefined,
      uploadStats: async () => undefined,
    });

    expect(readExistingStats).not.toHaveBeenCalled();
  });
});
