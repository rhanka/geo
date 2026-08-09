import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { CaptureReceipt } from "./zone-provenance-quality.js";
import { verifyRawCapturePayload } from "./zone-provenance-raw-capture.js";

const bytes = Buffer.from("the same captured bytes");
const digest = createHash("sha256").update(bytes).digest("hex");
const storageKey = `raw/zones-arcgis/cas/${digest}.json`;
const firstUrl = "https://first.example.test/zones.geojson";
const secondUrl = "https://second.example.test/zones.geojson";
const firstRetrievedAt = "2026-07-26T10:00:00.000Z";
const secondRetrievedAt = "2026-07-26T11:00:00.000Z";

function receipt(overrides: Partial<CaptureReceipt> = {}): CaptureReceipt {
  return {
    manifest_key: "capture/_runs/zones-20260726T110000Z-0/manifest.jsonl",
    line_index: 7,
    storage_key: storageKey,
    url: secondUrl,
    retrieved_at: secondRetrievedAt,
    sha256: `sha256:${digest}`,
    ...overrides,
  };
}

function firstFetchSidecar(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceUrl: firstUrl,
    sha256: digest,
    fetchedAt: firstRetrievedAt,
    storageKey,
    provenance: { version: "capturedFetch/1", userAgent: "test", viaObscura: false },
    ...overrides,
  };
}

describe("verifyRawCapturePayload", () => {
  it("does not equate the receipt date with the sidecar date of the first deduplicated fetch", () => {
    const sidecar = firstFetchSidecar();

    expect(sidecar.fetchedAt).not.toBe(receipt().retrieved_at);
    expect(verifyRawCapturePayload(receipt(), bytes, sidecar)).toMatchObject({ verified: true, reason: null });
  });

  it("accepte la seconde capture dédupliquée : manifeste du second fetch, sidecar du premier", () => {
    const result = verifyRawCapturePayload(receipt(), bytes, firstFetchSidecar());

    expect(result).toMatchObject({ verified: true, reason: null });
    expect(result.observation.sidecar).toMatchObject({
      sourceUrl: firstUrl,
      fetchedAt: firstRetrievedAt,
      sha256: digest,
      storageKey,
    });
    expect(result.observation.receipt).toMatchObject({
      url: secondUrl,
      retrieved_at: secondRetrievedAt,
      sha256: `sha256:${digest}`,
    });
  });

  it("refuse des octets CAS qui ne rehachent pas au SHA du manifeste", () => {
    const otherBytes = Buffer.from("tampered bytes");
    const actual = createHash("sha256").update(otherBytes).digest("hex");

    expect(verifyRawCapturePayload(receipt(), otherBytes, firstFetchSidecar())).toMatchObject({
      verified: false,
      reason: `cas-sha-mismatch:sha256:${actual}`,
    });
  });

  it.each([
    ["le SHA du sidecar", firstFetchSidecar({ sha256: "0".repeat(64) }), "capture-meta-sha256-does-not-match-manifest"],
    ["la clé du sidecar", firstFetchSidecar({ storageKey: "raw/zones-arcgis/cas/not-this-one.json" }), "capture-meta-storage-key-does-not-match-manifest"],
    ["un sidecar rétro-rempli", firstFetchSidecar({ backfilled: true }), "capture-backfilled"],
  ])("conserve le refus quand %s ne prouve pas l'identité des octets", (_label, sidecar, reason) => {
    expect(verifyRawCapturePayload(receipt(), bytes, sidecar)).toMatchObject({ verified: false, reason });
  });
});
