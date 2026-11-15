import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { S3Store } from "./s3-store.js";

interface RecordedCommand {
  name: string;
  input: Record<string, unknown>;
}

/**
 * A fake S3Client that records every command's class name + input and replies
 * from an in-memory object map. `send` returns SDK-shaped responses so the
 * store's body coercion + 404 handling are exercised hermetically (no network).
 */
function fakeClient(initial: Record<string, Uint8Array> = {}): {
  client: S3Client;
  commands: RecordedCommand[];
  objects: Map<string, Uint8Array>;
} {
  const objects = new Map<string, Uint8Array>(Object.entries(initial));
  const commands: RecordedCommand[] = [];

  const notFound = (): never => {
    throw Object.assign(new Error("Not Found"), {
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
  };

  const send = async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = command.constructor.name;
    const input = command.input;
    commands.push({ name, input });

    switch (name) {
      case "PutObjectCommand": {
        const body = input["Body"];
        const bytes =
          typeof body === "string" ? new TextEncoder().encode(body) : (body as Uint8Array);
        objects.set(input["Key"] as string, bytes);
        return {};
      }
      case "GetObjectCommand": {
        const bytes = objects.get(input["Key"] as string);
        if (bytes === undefined) return notFound();
        return { Body: { transformToByteArray: async () => bytes } };
      }
      case "HeadObjectCommand": {
        if (!objects.has(input["Key"] as string)) return notFound();
        return {};
      }
      case "ListObjectsV2Command": {
        const prefix = (input["Prefix"] as string | undefined) ?? "";
        const Contents = [...objects.keys()]
          .filter((k) => k.startsWith(prefix))
          .map((Key) => ({ Key }));
        return { Contents, IsTruncated: false };
      }
      case "DeleteObjectCommand": {
        objects.delete(input["Key"] as string);
        return {};
      }
      default:
        throw new Error(`unexpected command ${name}`);
    }
  };

  return { client: { send } as unknown as S3Client, commands, objects };
}

const decoder = new TextDecoder();

describe("S3Store", () => {
  it("put targets the configured bucket and prefixes the key", async () => {
    const { client, commands, objects } = fakeClient();
    const store = new S3Store({ bucket: "geo-data", prefix: "normalized", client });

    await store.put("ca-qc/r.geojson", "{}", { contentType: "application/geo+json" });

    const put = commands.find((c) => c.name === "PutObjectCommand");
    expect(put?.input).toMatchObject({
      Bucket: "geo-data",
      Key: "normalized/ca-qc/r.geojson",
      ContentType: "application/geo+json",
    });
    expect(objects.has("normalized/ca-qc/r.geojson")).toBe(true);
  });

  it("round-trips put → get, returning the original bytes", async () => {
    const { client } = fakeClient();
    const store = new S3Store({ bucket: "b", prefix: "p", client });
    await store.put("k.json", '{"ok":true}');
    const bytes = await store.get("k.json");
    expect(decoder.decode(bytes)).toBe('{"ok":true}');
  });

  it("get returns undefined on a 404 NotFound", async () => {
    const { client } = fakeClient();
    const store = new S3Store({ bucket: "b", client });
    expect(await store.get("missing")).toBeUndefined();
  });

  it("has reflects HeadObject success/404", async () => {
    const { client } = fakeClient();
    const store = new S3Store({ bucket: "b", prefix: "p", client });
    expect(await store.has("x")).toBe(false);
    await store.put("x", "y");
    expect(await store.has("x")).toBe(true);
  });

  it("list strips the prefix and sorts keys", async () => {
    const { client, commands } = fakeClient();
    const store = new S3Store({ bucket: "b", prefix: "normalized", client });
    await store.put("fr/c.geojson", "1");
    await store.put("ca-qc/r.geojson", "2");

    expect(await store.list()).toEqual(["ca-qc/r.geojson", "fr/c.geojson"]);

    await store.list("ca-qc/");
    const lastList = [...commands].reverse().find((c) => c.name === "ListObjectsV2Command");
    expect(lastList?.input["Prefix"]).toBe("normalized/ca-qc/");
  });

  it("works without a prefix (keys unchanged)", async () => {
    const { client, commands } = fakeClient();
    const store = new S3Store({ bucket: "b", client });
    await store.put("top.json", "1");
    const put = commands.find((c) => c.name === "PutObjectCommand");
    expect(put?.input["Key"]).toBe("top.json");
    expect(await store.list()).toEqual(["top.json"]);
  });

  it("getRange sends one ranged GetObject and never reads the whole object", async () => {
    const body = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const commands: RecordedCommand[] = [];
    const client = {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        commands.push({ name: command.constructor.name, input: command.input });
        const key = command.input["Key"];
        if (key !== "p/a.pmtiles") throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
        const m = /^bytes=(\d+)-(\d+)$/.exec(String(command.input["Range"]));
        const start = Number(m![1]);
        if (start >= body.length) throw Object.assign(new Error("InvalidRange"), { name: "InvalidRange", $metadata: { httpStatusCode: 416 } });
        const end = Math.min(Number(m![2]), body.length - 1);
        return { Body: { transformToByteArray: async () => body.slice(start, end + 1) }, ContentRange: `bytes ${start}-${end}/${body.length}` };
      },
    } as unknown as S3Client;
    const store = new S3Store({ bucket: "b", prefix: "p", client });
    expect(Array.from((await store.getRange("a.pmtiles", 2, 3))!)).toEqual([2, 3, 4]);
    expect(commands[0]).toEqual({ name: "GetObjectCommand", input: { Bucket: "b", Key: "p/a.pmtiles", Range: "bytes=2-4" } });
    expect(Array.from((await store.getRange("a.pmtiles", 8, 16384))!)).toEqual([8, 9]);
    expect((await store.getRange("a.pmtiles", 40, 4))!.length).toBe(0);
    expect(await store.getRange("missing", 0, 4)).toBeUndefined();
  });

  it("getRange keeps the requested slice when the server ignores Range", async () => {
    const { client } = fakeClient({ "p/a.bin": Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) });
    const store = new S3Store({ bucket: "b", prefix: "p", client });
    expect(Array.from((await store.getRange("a.bin", 5, 2))!)).toEqual([5, 6]);
  });

  it("putFile streams the file in one PutObject with its length and content type", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "s3-putfile-"));
    try {
      const path = join(dir, "a.pmtiles");
      const content = new Uint8Array(200_000).map((_, i) => i & 255);
      await writeFile(path, content);
      const received: Array<{ input: Record<string, unknown>; body: Buffer }> = [];
      const client = {
        send: async (command: { input: Record<string, unknown> }) => {
          const chunks: Buffer[] = [];
          for await (const c of command.input["Body"] as AsyncIterable<Buffer>) chunks.push(c);
          received.push({ input: command.input, body: Buffer.concat(chunks) });
          return {};
        },
      } as unknown as S3Client;
      const store = new S3Store({ bucket: "b", prefix: "p", client });
      await store.putFile("_tiles/x/v/x.pmtiles", path, { contentType: "application/vnd.pmtiles" });
      expect(received).toHaveLength(1);
      expect(received[0]!.input).toMatchObject({ Bucket: "b", Key: "p/_tiles/x/v/x.pmtiles", ContentLength: 200_000, ContentType: "application/vnd.pmtiles" });
      expect(received[0]!.body.equals(Buffer.from(content))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("deletes a key", async () => {
    const { client, objects } = fakeClient();
    const store = new S3Store({ bucket: "b", prefix: "p", client });
    await store.put("d", "x");
    expect(objects.has("p/d")).toBe(true);
    await store.delete("d");
    expect(objects.has("p/d")).toBe(false);
  });
});
