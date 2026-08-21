import { describe, expect, it } from "vitest";

import { OVH_S3_STREAM_BUFFER_BYTES, ovhSafeS3ClientOptions } from "./s3-client-config.js";

describe("ovhSafeS3ClientOptions", () => {
  it("disables aws-chunked flexible checksums (WHEN_REQUIRED) so OVH/Scaleway writes are accepted", () => {
    const o = ovhSafeS3ClientOptions();
    expect(o.requestChecksumCalculation).toBe("WHEN_REQUIRED");
    expect(o.responseChecksumValidation).toBe("WHEN_REQUIRED");
  });

  it("buffers the request stream above the OVH 8192-byte chunk floor", () => {
    expect(OVH_S3_STREAM_BUFFER_BYTES).toBeGreaterThanOrEqual(8192);
    expect(ovhSafeS3ClientOptions().requestStreamBufferSize).toBe(OVH_S3_STREAM_BUFFER_BYTES);
  });

  it("returns a fresh object each call (no shared-mutable config leak)", () => {
    expect(ovhSafeS3ClientOptions()).not.toBe(ovhSafeS3ClientOptions());
    expect(ovhSafeS3ClientOptions()).toEqual(ovhSafeS3ClientOptions());
  });
});
