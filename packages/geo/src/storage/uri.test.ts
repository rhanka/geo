import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { FsStore } from "./fs-store.js";
import { S3Store } from "./s3-store.js";
import { createStore, parseStoreUri } from "./uri.js";

describe("parseStoreUri", () => {
  it("parses s3://bucket/prefix", () => {
    expect(parseStoreUri("s3://geo-data/normalized/v1")).toEqual({
      kind: "s3",
      bucket: "geo-data",
      prefix: "normalized/v1",
    });
  });

  it("parses s3://bucket with no prefix", () => {
    expect(parseStoreUri("s3://geo-data")).toEqual({ kind: "s3", bucket: "geo-data" });
    expect(parseStoreUri("s3://geo-data/")).toEqual({ kind: "s3", bucket: "geo-data" });
  });

  it("throws for an s3 URI with no bucket", () => {
    expect(() => parseStoreUri("s3:///prefix")).toThrow(/missing bucket/);
  });

  it("parses fs:<path>", () => {
    expect(parseStoreUri("fs:./data/normalized")).toEqual({
      kind: "fs",
      path: "./data/normalized",
    });
  });

  it("treats a bare path as fs", () => {
    expect(parseStoreUri("/var/data")).toEqual({ kind: "fs", path: "/var/data" });
    expect(parseStoreUri("data/normalized")).toEqual({ kind: "fs", path: "data/normalized" });
  });
});

describe("createStore", () => {
  it("builds an FsStore for a bare path", () => {
    const store = createStore("/tmp/geo");
    expect(store).toBeInstanceOf(FsStore);
    expect((store as FsStore).root).toBe("/tmp/geo");
  });

  it("builds an FsStore for fs:<path>", () => {
    const store = createStore("fs:./out");
    expect(store).toBeInstanceOf(FsStore);
    expect((store as FsStore).root).toBe("./out");
  });

  it("builds an S3Store with an injected client (hermetic)", () => {
    const client = { send: async () => ({}) } as unknown as S3Client;
    const store = createStore("s3://bucket/pre", { client });
    expect(store).toBeInstanceOf(S3Store);
    expect((store as S3Store).bucket).toBe("bucket");
    expect((store as S3Store).prefix).toBe("pre");
  });
});
