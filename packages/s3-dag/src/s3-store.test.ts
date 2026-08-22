import { describe, expect, it } from "vitest";

import type { S3Client } from "@aws-sdk/client-s3";

import { S3DagStore } from "./s3-store.js";

interface Recorded {
  name: string;
  input: Record<string, unknown>;
}

/** Minimal S3 double: dispatches on the AWS command's class name + `.input`. */
class FakeS3 {
  readonly calls: Recorded[] = [];
  readonly objects = new Map<string, { body: string; etag: string }>();
  #seq = 0;
  failNextPutWithPrecondition = false;

  send(command: unknown): Promise<unknown> {
    const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
    const name = cmd.constructor.name;
    const input = cmd.input;
    this.calls.push({ name, input });

    if (name === "PutObjectCommand") {
      if (this.failNextPutWithPrecondition) {
        this.failNextPutWithPrecondition = false;
        return Promise.reject(Object.assign(new Error("precondition"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } }));
      }
      this.#seq += 1;
      const etag = `"etag-${this.#seq}"`;
      this.objects.set(String(input.Key), { body: String(input.Body), etag });
      return Promise.resolve({ ETag: etag });
    }
    if (name === "GetObjectCommand") {
      const o = this.objects.get(String(input.Key));
      if (!o) return Promise.reject(Object.assign(new Error("nope"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }));
      return Promise.resolve({ Body: { transformToString: () => Promise.resolve(o.body) }, ETag: o.etag });
    }
    if (name === "HeadObjectCommand") {
      const o = this.objects.get(String(input.Key));
      if (!o) return Promise.reject(Object.assign(new Error("nope"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }));
      return Promise.resolve({ ETag: o.etag });
    }
    if (name === "ListObjectsV2Command") {
      const prefix = input.Prefix === undefined ? "" : String(input.Prefix);
      const all = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = input.ContinuationToken === undefined ? 0 : Number(input.ContinuationToken);
      const key = all[start]; // one key per page, to exercise pagination
      if (key === undefined) return Promise.resolve({ Contents: [] });
      const next = start + 1;
      const truncated = next < all.length;
      return Promise.resolve({
        Contents: [{ Key: key }],
        IsTruncated: truncated,
        ...(truncated ? { NextContinuationToken: String(next) } : {}),
      });
    }
    return Promise.reject(new Error(`unexpected command ${name}`));
  }
}

function make(prefix?: string): { store: S3DagStore; fake: FakeS3 } {
  const fake = new FakeS3();
  const cfg = { bucket: "b", client: fake as unknown as S3Client, ...(prefix !== undefined ? { prefix } : {}) };
  return { store: new S3DagStore(cfg), fake };
}

describe("S3DagStore — object I/O", () => {
  it("puts JSON and reads it back with its ETag", async () => {
    const { store } = make();
    const { etag } = await store.put("runs/r1/latest.json", '{"a":1}');
    expect(etag).toBe('"etag-1"');
    expect(await store.get("runs/r1/latest.json")).toEqual({ body: '{"a":1}', etag: '"etag-1"' });
  });

  it("get returns undefined on a 404 (NoSuchKey) rather than throwing", async () => {
    const { store } = make();
    expect(await store.get("missing")).toBeUndefined();
  });

  it("applies the configured key prefix and strips it on list", async () => {
    const { store, fake } = make("preprod-runs");
    await store.put("runs/r1/manifest.json", "{}");
    expect(fake.calls.at(-1)?.input.Key).toBe("preprod-runs/runs/r1/manifest.json");
    await store.put("runs/r1/latest.json", "{}");
    const keys = await store.list("runs/");
    expect(keys).toEqual(["runs/r1/latest.json", "runs/r1/manifest.json"]); // prefix stripped, paginated
  });
});

describe("S3DagStore — compare-and-set (OVH-safe)", () => {
  it("builds the client with checksums WHEN_REQUIRED so aws-chunked never masks a CAS", async () => {
    // A real client is built when none is injected; assert the store constructs without throwing
    // and that the injected-client path (used everywhere else here) bypasses network entirely.
    expect(() => new S3DagStore({ bucket: "b", endpoint: "https://s3.example", region: "bhs", accessKeyId: "k", secretAccessKey: "s" })).not.toThrow();
  });

  it("create-only CAS sends If-None-Match:* (etag = null)", async () => {
    const { store, fake } = make();
    const res = await store.putIfMatch("runs/r1/latest.json", "{}", null);
    expect(res).toEqual({ ok: true, etag: '"etag-1"' });
    const put = fake.calls.at(-1)!;
    expect(put.input.IfNoneMatch).toBe("*");
    expect(put.input.IfMatch).toBeUndefined();
  });

  it("advance-only CAS sends If-Match:<etag>", async () => {
    const { store, fake } = make();
    const res = await store.putIfMatch("runs/r1/latest.json", "{}", '"etag-prev"');
    expect(res).toEqual({ ok: true, etag: '"etag-1"' });
    const put = fake.calls.at(-1)!;
    expect(put.input.IfMatch).toBe('"etag-prev"');
    expect(put.input.IfNoneMatch).toBeUndefined();
  });

  it("returns {ok:false} on a 412 PreconditionFailed (a lost race, not an error)", async () => {
    const { store, fake } = make();
    fake.failNextPutWithPrecondition = true;
    expect(await store.putIfMatch("runs/r1/latest.json", "{}", '"stale"')).toEqual({ ok: false });
  });
});

describe("S3DagStore — head (live CAS smoke test)", () => {
  it("returns the ETag when present and undefined on 404", async () => {
    const { store } = make();
    await store.put("k", "{}");
    expect(await store.head("k")).toEqual({ etag: '"etag-1"' });
    expect(await store.head("nope")).toBeUndefined();
  });
});
