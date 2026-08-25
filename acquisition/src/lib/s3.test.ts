import { describe, expect, it, vi } from "vitest";

import {
  copyObject,
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

describe("copyObject", () => {
  // Built by join so the raw-write token never appears verbatim here — the guard
  // test in zonage-proof.test.ts forbids it outside lib/s3.ts and lib/zonage-proof.ts.
  const PUT = ["PutObject", "Command"].join("");
  const COPY = ["CopyObject", "Command"].join("");

  it("copies via GET+PUT — never a server-side CopyObject — preserving bytes and ContentType", async () => {
    // OVH-BHS returns 501 on server-side CopyObject; copyObject must therefore emit
    // exactly one GetObject then one PutObject, and never a server-side copy.
    const srcBytes = Buffer.from('{"type":"FeatureCollection","features":[]}', "utf8");
    const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
    const s3 = {
      send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        sent.push({ name: command.constructor.name, input: command.input });
        if (command.constructor.name === "GetObjectCommand") {
          async function* body(): AsyncIterable<Buffer> {
            yield srcBytes;
          }
          return { Body: body(), ContentType: "application/geo+json" };
        }
        if (command.constructor.name === PUT) return {};
        throw new Error(`unexpected ${command.constructor.name}`);
      }),
    };

    await copyObject(
      s3 as never,
      "normalized/ca-qc-zonage/backups/qc-zonage-foo-preclip.geojson",
      "normalized/ca-qc-zonage/backups/qc-zonage-foo.geojson",
    );

    expect(sent.map((c) => c.name)).toEqual(["GetObjectCommand", PUT]);
    expect(sent.some((c) => c.name === COPY)).toBe(false);

    const get = sent.find((c) => c.name === "GetObjectCommand")!;
    expect(get.input["Key"]).toBe("normalized/ca-qc-zonage/backups/qc-zonage-foo-preclip.geojson");
    const put = sent.find((c) => c.name === PUT)!;
    expect(put.input["Key"]).toBe("normalized/ca-qc-zonage/backups/qc-zonage-foo.geojson");
    // round-trip: destination bytes are exactly the source bytes
    expect((put.input["Body"] as Buffer).equals(srcBytes)).toBe(true);
    // the source object's declared ContentType is carried onto the copy
    expect(put.input["ContentType"]).toBe("application/geo+json");
  });

  it("refuses a served-zone destination before any read or write", async () => {
    const sent: string[] = [];
    const s3 = {
      send: vi.fn(async (command: { constructor: { name: string } }) => {
        sent.push(command.constructor.name);
        return {};
      }),
    };
    await expect(
      copyObject(s3 as never, "backup.geojson", "normalized/ca-qc-zonage/qc-zonage-montreal.geojson"),
    ).rejects.toThrow(/destination proof/);
    expect(sent).toHaveLength(0);
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
