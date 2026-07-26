import { describe, expect, it, vi } from "vitest";

import { objectHead, putStream, STREAM_PART_BYTES } from "./s3.js";

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

describe("putStream", () => {
  it("uploads a bounded stream as explicit-length multipart parts", async () => {
    const first = Buffer.alloc(STREAM_PART_BYTES - 3, 0x61);
    const second = Buffer.alloc(10, 0x62);
    const uploaded: Buffer[] = [];
    let completed: { Parts?: Array<{ ETag?: string; PartNumber?: number }> } | undefined;
    const s3 = {
      send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        if (command.constructor.name === "CreateMultipartUploadCommand") return { UploadId: "upload-1" };
        if (command.constructor.name === "UploadPartCommand") {
          const body = command.input["Body"] as Buffer;
          uploaded.push(body);
          expect(command.input["ContentLength"]).toBe(body.byteLength);
          return { ETag: `etag-${String(command.input["PartNumber"])}` };
        }
        if (command.constructor.name === "CompleteMultipartUploadCommand") {
          completed = command.input["MultipartUpload"] as typeof completed;
          return {};
        }
        throw new Error(`unexpected ${command.constructor.name}`);
      }),
    };
    async function* stream(): AsyncIterable<Uint8Array> {
      yield first;
      yield second;
    }

    await putStream(s3 as never, "capture/_runs/test/spool/body", stream(), "application/pdf");

    expect(uploaded.map((part) => part.byteLength)).toEqual([STREAM_PART_BYTES, 7]);
    expect(Buffer.concat(uploaded)).toEqual(Buffer.concat([first, second]));
    expect(completed).toEqual({
      Parts: [
        { ETag: "etag-1", PartNumber: 1 },
        { ETag: "etag-2", PartNumber: 2 },
      ],
    });
  });
});
