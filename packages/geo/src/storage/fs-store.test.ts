import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FsStore } from "./fs-store.js";

const decoder = new TextDecoder();

describe("FsStore", () => {
  let root: string;
  let store: FsStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "geo-storage-fs-"));
    store = new FsStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("puts then gets a round-trip, creating nested directories", async () => {
    await store.put("ca-qc/qc-regions.geojson", '{"type":"FeatureCollection"}');
    const bytes = await store.get("ca-qc/qc-regions.geojson");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(decoder.decode(bytes)).toBe('{"type":"FeatureCollection"}');
  });

  it("stores raw bytes unchanged", async () => {
    const body = new Uint8Array([0, 1, 2, 250, 255]);
    await store.put("blob.bin", body);
    const out = await store.get("blob.bin");
    expect(out).toEqual(body);
  });

  it("get returns undefined for a missing key", async () => {
    expect(await store.get("nope.json")).toBeUndefined();
  });

  it("has reflects existence", async () => {
    expect(await store.has("a/b.txt")).toBe(false);
    await store.put("a/b.txt", "x");
    expect(await store.has("a/b.txt")).toBe(true);
  });

  it("lists keys recursively, relative to root, slash-separated and sorted", async () => {
    await store.put("ca-qc/r.geojson", "1");
    await store.put("ca-qc/r.meta.json", "2");
    await store.put("fr/communes.geojson", "3");
    expect(await store.list()).toEqual([
      "ca-qc/r.geojson",
      "ca-qc/r.meta.json",
      "fr/communes.geojson",
    ]);
  });

  it("filters list by prefix", async () => {
    await store.put("ca-qc/r.geojson", "1");
    await store.put("fr/communes.geojson", "2");
    expect(await store.list("ca-qc/")).toEqual(["ca-qc/r.geojson"]);
  });

  it("list on an empty store is empty", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("deletes a key (and is a no-op when missing)", async () => {
    await store.put("gone.txt", "x");
    expect(await store.has("gone.txt")).toBe(true);
    await store.delete("gone.txt");
    expect(await store.has("gone.txt")).toBe(false);
    await store.delete("gone.txt"); // no throw
  });
});
