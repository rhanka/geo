/**
 * The read-only feature-size scan (feature-size-scan.ts): byte counts agree
 * with the serving cap of #448, the per-collection buckets and the summary are
 * right, and nothing is ever written to the store.
 */

import { describe, expect, it } from "vitest";

import {
  FeatureTooLargeError,
  parseFeatureCollectionStream,
  scanFeatureByteSizes,
  SERVING_MAX_FEATURE_BYTES,
} from "../api/providers/collection-loader.js";
import type { ByteStream, Store } from "../storage/index.js";

import { readOnlyStore, scanFeatureSizes } from "./feature-size-scan.js";
import { runFeatureSizeScanCli } from "./feature-size-scan-cli.js";

const MiB = 1024 * 1024;
const encoder = new TextEncoder();

class MemStore implements Store {
  readonly objects = new Map<string, Uint8Array>();
  writes = 0;
  chunk = 4096;

  seed(key: string, body: string): void {
    this.objects.set(key, encoder.encode(body));
  }
  async put(): Promise<void> {
    this.writes++;
  }
  async delete(): Promise<void> {
    this.writes++;
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    return this.objects.get(key);
  }
  async getStream(key: string): Promise<ByteStream | undefined> {
    const body = this.objects.get(key);
    if (!body) return undefined;
    const size = this.chunk;
    return (async function* () {
      for (let i = 0; i < body.byteLength; i += size) yield body.subarray(i, i + size);
    })();
  }
  async has(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  async list(prefix = ""): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

/** A Feature whose JSON text is exactly `bytes` long. */
function featureOfBytes(bytes: number): string {
  const head = '{"type":"Feature","properties":{"pad":"';
  const tail = '"},"geometry":null}';
  return `${head}${"x".repeat(bytes - head.length - tail.length)}${tail}`;
}

function collection(features: readonly string[], envelope = ""): string {
  return `{"type":"FeatureCollection"${envelope},"features":[${features.join(",")}]}`;
}

async function* chunks(text: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = encoder.encode(text);
  for (let i = 0; i < bytes.byteLength; i += size) yield bytes.subarray(i, i + size);
}

describe("scanFeatureByteSizes", () => {
  it("reports each Feature's exact JSON byte length across arbitrary chunk boundaries", async () => {
    const features = [
      { type: "Feature", properties: { s: 'brace } { and "quote" \\ end', n: 1 }, geometry: null },
      { type: "Feature", properties: { label: "é ü 漢字" }, geometry: { type: "Point", coordinates: [1, 2] } },
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
    ].map((f) => JSON.stringify(f));
    // A `features` string inside the envelope must not be taken for the key.
    const text = collection(features, ',"name":"features","crs":{"features":"x"}');
    const expected = features.map((f) => encoder.encode(f).byteLength);
    for (const size of [1, 3, 7, 64, 1 << 16]) {
      const seen: number[] = [];
      const { features: n } = await scanFeatureByteSizes(chunks(text, size), (i, bytes) => {
        expect(i).toBe(seen.length);
        seen.push(bytes);
      });
      expect(n).toBe(3);
      expect(seen).toEqual(expected);
    }
  });

  it("counts exactly what the serving cap compares (refused iff bytes > cap)", async () => {
    const text = collection([featureOfBytes(1000)]);
    const seen: number[] = [];
    await scanFeatureByteSizes(chunks(text, 97), (_, bytes) => seen.push(bytes));
    expect(seen).toEqual([1000]);
    const drain = async (cap: number): Promise<void> => {
      for await (const _ of parseFeatureCollectionStream(chunks(text, 97), { maxFeatureBytes: cap })) void _;
    };
    await expect(drain(1000)).resolves.toBeUndefined();
    await expect(drain(999)).rejects.toBeInstanceOf(FeatureTooLargeError);
  });

  it("handles an empty collection and rejects a truncated one", async () => {
    await expect(scanFeatureByteSizes(chunks(collection([]), 5), () => {})).resolves.toEqual({ features: 0 });
    await expect(scanFeatureByteSizes(chunks('{"type":"FeatureCollection","features":[{"a":1}', 5), () => {})).rejects.toThrow(
      /did not terminate/,
    );
  });
});

describe("readOnlyStore", () => {
  it("reads through and refuses every write", async () => {
    const mem = new MemStore();
    mem.seed("a.geojson", "x");
    const ro = readOnlyStore(mem);
    expect(await ro.get("a.geojson")).toEqual(encoder.encode("x"));
    expect(await ro.list("")).toEqual(["a.geojson"]);
    await expect(ro.put("b", "y")).rejects.toThrow(/read-only/);
    await expect(ro.delete!("a.geojson")).rejects.toThrow(/read-only/);
    expect(mem.writes).toBe(0);
  });
});

describe("feature-size scan (store)", () => {
  /** Two small collections, one with a 9 MiB Feature, one with a Feature just over the 16 MiB cap. */
  function seededStore(): MemStore {
    const store = new MemStore();
    store.chunk = 1 << 20;
    store.seed("normalized/qc-zonage-small.geojson", collection([featureOfBytes(200), featureOfBytes(300)]));
    store.seed("normalized/qc-zonage-nine.geojson", collection([featureOfBytes(100), featureOfBytes(9 * MiB)]));
    store.seed(
      "normalized/qc-zonage-big.geojson",
      collection([featureOfBytes(SERVING_MAX_FEATURE_BYTES + 1), featureOfBytes(100), featureOfBytes(SERVING_MAX_FEATURE_BYTES)]),
    );
    store.seed("normalized/qc-regions.geojson", collection([featureOfBytes(100)]));
    store.seed("normalized/qc-zonage-broken.geojson", '{"type":"FeatureCollection","features":[');
    // Not served (underscore segment): never scanned.
    store.seed("normalized/_display/qc-zonage-big/v1/index.json", "{}");
    return store;
  }

  it("buckets per collection, lists offenders largest first, and writes nothing", async () => {
    const store = seededStore();
    const sources = [
      { collection: "qc-zonage-big", sourceKey: "normalized/qc-zonage-big.geojson" },
      { collection: "qc-zonage-nine", sourceKey: "normalized/qc-zonage-nine.geojson" },
      { collection: "qc-zonage-small", sourceKey: "normalized/qc-zonage-small.geojson" },
    ];
    const results: Record<string, unknown>[] = [];
    const report = await scanFeatureSizes(store, sources, { onResult: (r) => results.push(r as never) });
    const big = results.find((r) => r["collection"] === "qc-zonage-big")!;
    expect(big).toMatchObject({
      features: 3,
      maxFeatureBytes: SERVING_MAX_FEATURE_BYTES + 1,
      maxFeatureIndex: 0,
      over8MiB: 2,
      over16MiB: 1,
      over32MiB: 0,
      over64MiB: 0,
    });
    expect(results.find((r) => r["collection"] === "qc-zonage-small")).toMatchObject({ features: 2, maxFeatureBytes: 300, over8MiB: 0 });
    expect(report.scanned).toBe(3);
    expect(report.failed).toEqual([]);
    expect(report.offenders.over8MiB.map((o) => o.collection)).toEqual(["qc-zonage-big", "qc-zonage-nine"]);
    expect(report.offenders.over16MiB).toEqual([{ collection: "qc-zonage-big", maxFeatureBytes: SERVING_MAX_FEATURE_BYTES + 1, count: 1 }]);
    expect(report.offenders.over32MiB).toEqual([]);
    expect(store.writes).toBe(0);
  });

  it("CLI: one JSON line per served collection, a summary last, exit 1 on an unreadable source", async () => {
    const store = seededStore();
    const lines: string[] = [];
    const code = await runFeatureSizeScanCli(["--store", "mem://x"], { createStore: () => store, out: (l) => lines.push(l) });
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed[0]).toHaveProperty("start");
    const rows = parsed.filter((p) => "collection" in p);
    expect(rows.map((r) => r["collection"]).sort()).toEqual(["qc-regions", "qc-zonage-big", "qc-zonage-broken", "qc-zonage-nine", "qc-zonage-small"]);
    expect(rows.find((r) => r["collection"] === "qc-zonage-broken")).toHaveProperty("error");
    const summary = parsed.at(-1)!["summary"] as Record<string, unknown>;
    expect(summary).toMatchObject({ total: 5, scanned: 4, failed: ["qc-zonage-broken"] });
    expect((summary["over16MiB"] as { collection: string }[]).map((o) => o.collection)).toEqual(["qc-zonage-big"]);
    expect(code).toBe(1);
    expect(store.writes).toBe(0);
  });

  it("CLI: --collections / --display-only narrow the scan; a clean scan exits 0", async () => {
    const store = seededStore();
    const lines: string[] = [];
    const code = await runFeatureSizeScanCli(["--store", "mem://x", "--display-only", "--collections", "qc-zonage-small,qc-regions"], {
      createStore: () => store,
      out: (l) => lines.push(l),
    });
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    // qc-regions is served but not a display collection: reported missing under --display-only.
    expect(parsed.find((p) => p["collection"] === "qc-regions")).toMatchObject({ error: "not a served lots/zonage collection" });
    expect(code).toBe(1);

    const clean: string[] = [];
    expect(await runFeatureSizeScanCli(["--store", "mem://x", "--collections", "qc-zonage-small"], { createStore: () => store, out: (l) => clean.push(l) })).toBe(0);
    expect(await runFeatureSizeScanCli(["--collections", "a"], { createStore: () => store, out: () => {} })).toBe(2);
  });
});
