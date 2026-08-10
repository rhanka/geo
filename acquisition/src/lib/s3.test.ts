import { describe, expect, it, vi } from "vitest";

import {
  copyObjectIfMatch,
  objectHead,
  putBytesIfAbsentOrEqual,
  putStream,
  STREAM_PART_BYTES,
} from "./s3.js";

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
    // `toEqual` sur deux Buffers de 8 MiB parcourt 8 millions d'elements a
    // travers la machinerie d'egalite profonde de vitest : le test sortait a
    // 36 s pour un timeout de 5 s, et l'assertion n'etait jamais atteinte.
    // `Buffer.equals` compare exactement les memes octets, sans ce detour --
    // l'assertion n'est pas affaiblie, elle cesse d'etre le goulot.
    expect(Buffer.concat(uploaded).equals(Buffer.concat([first, second]))).toBe(true);
    expect(completed).toEqual({
      Parts: [
        { ETag: "etag-1", PartNumber: 1 },
        { ETag: "etag-2", PartNumber: 2 },
      ],
    });
  });
});

describe("putBytesIfAbsentOrEqual", () => {
  it("should accept a pre-existing immutable object only after an exact readback", async () => {
    async function* body(): AsyncIterable<Buffer> {
      yield Buffer.from("same");
    }
    const s3 = {
      send: vi.fn()
        .mockRejectedValueOnce({ name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } })
        .mockResolvedValueOnce({ Body: body() }),
    };
    await expect(putBytesIfAbsentOrEqual(s3 as never, "registry/worklist.json", "same"))
      .resolves.toBe("existing-equal");
  });

  it("should reject a pre-existing immutable object with different bytes", async () => {
    async function* body(): AsyncIterable<Buffer> {
      yield Buffer.from("other");
    }
    const s3 = {
      send: vi.fn()
        .mockRejectedValueOnce({ name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } })
        .mockResolvedValueOnce({ Body: body() }),
    };
    await expect(putBytesIfAbsentOrEqual(s3 as never, "registry/worklist.json", "expected"))
      .rejects.toThrow(/immutable S3 object collision/);
  });
});

describe("copyObjectIfMatch", () => {
  it("copies a backup only from the ETag revision observed during preflight", async () => {
    const sent: Array<{ input: Record<string, unknown> }> = [];
    const s3 = { send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      expect(command.constructor.name).toBe("CopyObjectCommand");
      sent.push({ input: command.input });
      return {};
    }) };

    await copyObjectIfMatch(
      s3 as never,
      "normalized/ca-qc-zonage/qc-zonage-alpha.geojson",
      "normalized/ca-qc-zonage/_replaced/run-1/flat.geojson",
      "\"etag-before\"",
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]!.input).toMatchObject({
      CopySourceIfMatch: "\"etag-before\"",
      Key: "normalized/ca-qc-zonage/_replaced/run-1/flat.geojson",
    });
  });
});
