/**
 * `geo fetch --out <store-uri>` routing. Verifies that a store URI (`s3://…`,
 * `fs:…`) routes the write through the {@link Store} path (ADR-0012), a bare
 * path keeps the legacy local-fs path, and that no real S3 client / network is
 * ever constructed (an injected store + injected `createStore` keep it hermetic).
 */

import type { PutOptions, Store } from "@sentropic/geo-storage";
import { describe, expect, it, vi } from "vitest";

import { fetchSource } from "./fetch.js";

/** In-memory {@link Store} recording every put. */
class MemoryStore implements Store {
  readonly puts: Array<{ key: string; contentType?: string }> = [];
  async put(key: string, _body: Uint8Array | string, opts?: PutOptions): Promise<void> {
    this.puts.push(opts?.contentType !== undefined ? { key, contentType: opts.contentType } : { key });
  }
  async get(): Promise<Uint8Array | undefined> {
    return undefined;
  }
  async has(): Promise<boolean> {
    return false;
  }
  async list(): Promise<string[]> {
    return this.puts.map((p) => p.key);
  }
}

function fakeAcquire() {
  return vi.fn(async (_m: unknown, id: string) => ({
    meta: {
      sourceId: "ca-qc/sda",
      datasetId: id,
      title: id,
      license: { id: "cc-by-4.0", title: "CC BY 4.0", redistributable: true, attributionRequired: true },
      attribution: "© test",
      crs: "EPSG:4326" as const,
      fetchedAt: new Date().toISOString(),
      count: 1,
    },
    collection: { type: "FeatureCollection" as const, features: [] },
  }));
}

describe("fetch --out store routing", () => {
  it("routes an injected store, writing <sourceSlug>/<id> keys with content types", async () => {
    const store = new MemoryStore();
    const acquire = fakeAcquire();
    const result = await fetchSource(
      "ca-qc/sda",
      "qc-regions",
      { out: "s3://geo-data/normalized" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { acquire: acquire as any, store },
    );

    expect(result.outDir).toBe("s3://geo-data/normalized");
    expect(result.datasets[0]?.geojsonPath).toBe("ca-qc-sda/qc-regions.geojson");
    expect(result.datasets[0]?.metaPath).toBe("ca-qc-sda/qc-regions.meta.json");
    expect(store.puts.map((p) => p.key)).toEqual([
      "ca-qc-sda/qc-regions.geojson",
      "ca-qc-sda/qc-regions.meta.json",
    ]);
    expect(store.puts[0]?.contentType).toBe("application/geo+json");
  });

  it("builds the store from an s3:// URI via createStore and applies its prefix", async () => {
    const store = new MemoryStore();
    const createStore = vi.fn(() => store);
    const acquire = fakeAcquire();

    const result = await fetchSource(
      "ca-qc/sda",
      "qc-regions",
      { out: "s3://geo-data/normalized/v1" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { acquire: acquire as any, createStore: createStore as any },
    );

    expect(createStore).toHaveBeenCalledWith("s3://geo-data/normalized/v1");
    // The s3 prefix is applied to the store keys.
    expect(result.datasets[0]?.geojsonPath).toBe("normalized/v1/ca-qc-sda/qc-regions.geojson");
    expect(store.puts.map((p) => p.key)).toContain("normalized/v1/ca-qc-sda/qc-regions.geojson");
  });

  it("routes an fs: URI through the store path (no prefix)", async () => {
    const store = new MemoryStore();
    const createStore = vi.fn(() => store);
    const acquire = fakeAcquire();

    await fetchSource(
      "ca-qc/sda",
      "qc-regions",
      { out: "fs:./out" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { acquire: acquire as any, createStore: createStore as any },
    );

    expect(createStore).toHaveBeenCalledWith("fs:./out");
    expect(store.puts.map((p) => p.key)).toEqual([
      "ca-qc-sda/qc-regions.geojson",
      "ca-qc-sda/qc-regions.meta.json",
    ]);
  });

  it("keeps a bare --out path on the legacy local-fs write path", async () => {
    const acquire = fakeAcquire();
    const writeNormalized = vi.fn(async (_d: unknown, dir: string) => ({
      geojsonPath: `${dir}/x.geojson`,
      metaPath: `${dir}/x.meta.json`,
    }));
    const createStore = vi.fn();

    const result = await fetchSource(
      "ca-qc/sda",
      "qc-regions",
      { out: "/tmp/geo-out" },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        acquire: acquire as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        writeNormalized: writeNormalized as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createStore: createStore as any,
      },
    );

    expect(createStore).not.toHaveBeenCalled();
    expect(writeNormalized).toHaveBeenCalledTimes(1);
    expect(result.outDir).toBe("/tmp/geo-out");
    expect(result.datasets[0]?.geojsonPath).toBe("/tmp/geo-out/x.geojson");
  });
});
