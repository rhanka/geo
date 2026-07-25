import { describe, expect, it, vi } from "vitest";

import { objectHead } from "./s3.js";

describe("objectHead", () => {
  it("should return missing only for an explicit S3 404", async () => {
    const s3 = { send: vi.fn().mockRejectedValue({ name: "NotFound", $metadata: { httpStatusCode: 404 } }) };
    await expect(objectHead(s3 as never, "registry/qc-pv/a/index.json")).resolves.toEqual({ exists: false });
  });

  it("should fail closed for a non-404 S3 read error", async () => {
    const denied = new Error("access denied");
    const s3 = { send: vi.fn().mockRejectedValue(denied) };
    await expect(objectHead(s3 as never, "registry/qc-pv/a/index.json")).rejects.toBe(denied);
  });
});
