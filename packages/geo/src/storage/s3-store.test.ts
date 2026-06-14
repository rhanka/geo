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

  it("deletes a key", async () => {
    const { client, objects } = fakeClient();
    const store = new S3Store({ bucket: "b", prefix: "p", client });
    await store.put("d", "x");
    expect(objects.has("p/d")).toBe(true);
    await store.delete("d");
    expect(objects.has("p/d")).toBe(false);
  });
});
