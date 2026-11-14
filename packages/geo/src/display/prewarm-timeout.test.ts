/**
 * Regression for the 2026-11 preprod prewarm hang: after collection #420 the
 * Job sat for ~5 h at 0 CPU with no log line — one store call never settled and
 * nothing bounded a collection. These tests pin that a collection whose store
 * call never resolves is recorded `failed` / `timeout`, its work is aborted
 * (no pointer flip), and the sweep moves on; a re-run then completes it.
 */

import { describe, expect, it } from "vitest";

import type { ByteStream, ObjectStat, PutOptions, Store } from "../storage/index.js";

import { currentKey } from "./mirror.js";
import { parsePrewarmArgs, runPrewarmCli } from "./prewarm-cli.js";
import { DEFAULT_COLLECTION_TIMEOUT_MS, prewarmDisplayMirrors } from "./prewarm.js";

const never = <T>(): Promise<T> => new Promise<T>(() => {});

/** In-memory store with switchable hangs (a stalled S3 call never settles). */
class HangingStore implements Store {
  readonly objects = new Map<string, Uint8Array>();
  /** Keys whose `stat` never settles. */
  hangStat = new Set<string>();
  /** Key prefix whose `put` never settles (honours `signal` when `honourSignal`). */
  hangPutUnder: string | undefined;
  honourSignal = true;
  /** Signals seen by hanging puts. */
  readonly putSignals: AbortSignal[] = [];
  #writes = 0;
  readonly #etags = new Map<string, string>();

  async put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void> {
    if (this.hangPutUnder !== undefined && key.startsWith(this.hangPutUnder)) {
      if (opts?.signal) this.putSignals.push(opts.signal);
      if (this.honourSignal && opts?.signal) {
        const signal = opts.signal;
        return new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return never();
    }
    this.objects.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body.slice());
    this.#etags.set(key, `"e${++this.#writes}"`);
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    return this.objects.get(key);
  }
  async getStream(key: string): Promise<ByteStream | undefined> {
    const body = this.objects.get(key);
    if (!body) return undefined;
    return (async function* () {
      yield body;
    })();
  }
  async stat(key: string): Promise<ObjectStat | undefined> {
    if (this.hangStat.has(key)) return never();
    const body = this.objects.get(key);
    return body ? { etag: this.#etags.get(key)!, size: body.byteLength } : undefined;
  }
  async has(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  async list(prefix = ""): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

const SQUARE = [
  [-73.1234567, 45.1234567],
  [-73.1134567, 45.1234567],
  [-73.1134567, 45.1334567],
  [-73.1234567, 45.1234567],
];

function fc(n: number): string {
  const features = Array.from({ length: n }, (_, i) => ({
    type: "Feature",
    id: `f${i}`,
    geometry: { type: "Polygon", coordinates: [SQUARE] },
    properties: { i },
  }));
  return JSON.stringify({ type: "FeatureCollection", features });
}

const A = { collection: "qc-zonage-a", sourceKey: "ca-qc-zonage/qc-zonage-a.geojson" };
const B = { collection: "qc-zonage-b", sourceKey: "ca-qc-zonage/qc-zonage-b.geojson" };

async function twoSources(): Promise<HangingStore> {
  const store = new HangingStore();
  await store.put(A.sourceKey, fc(2));
  await store.put(B.sourceKey, fc(2));
  return store;
}

describe("prewarm per-collection deadline", () => {
  it("records a never-settling store call as failed/timeout and moves on to the next collection", async () => {
    const store = await twoSources();
    store.hangStat.add(A.sourceKey);
    const seen: Array<{ collection: string; action: string; reason?: string }> = [];

    const started = Date.now();
    const report = await prewarmDisplayMirrors(store, [A, B], {
      collectionTimeoutMs: 50,
      onResult: (r) => seen.push({ collection: r.collection, action: r.action, ...(r.reason ? { reason: r.reason } : {}) }),
    });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(seen).toEqual([
      { collection: "qc-zonage-a", action: "failed", reason: "timeout" },
      { collection: "qc-zonage-b", action: "built", reason: "no-mirror" },
    ]);
    expect(report.counts).toMatchObject({ failed: 1, built: 1 });
    expect(report.failures[0]).toMatchObject({ collection: "qc-zonage-a", reason: "timeout" });
    expect(report.failures[0]!.error).toMatch(/deadline exceeded \(50 ms\)/);
  });

  it("aborts a build stalled in an upload: the signal reaches the store and no pointer is flipped", async () => {
    const store = await twoSources();
    store.hangPutUnder = "_display/qc-zonage-a/";

    const report = await prewarmDisplayMirrors(store, [A, B], { collectionTimeoutMs: 50 });

    expect(report.counts).toMatchObject({ failed: 1, built: 1 });
    expect(store.putSignals.length).toBeGreaterThan(0);
    expect(store.putSignals.every((s) => s.aborted)).toBe(true);
    expect(store.objects.has(currentKey("qc-zonage-a"))).toBe(false);
    expect(store.objects.has(currentKey("qc-zonage-b"))).toBe(true);
  });

  it("moves on even when the stalled call ignores the abort signal", async () => {
    const store = await twoSources();
    store.hangPutUnder = "_display/qc-zonage-a/";
    store.honourSignal = false;

    const report = await prewarmDisplayMirrors(store, [A, B], { collectionTimeoutMs: 50 });

    expect(report.counts).toMatchObject({ failed: 1, built: 1 });
    expect(store.objects.has(currentKey("qc-zonage-a"))).toBe(false);
  });

  it("stays resumable: a re-run after the stall builds the timed-out collection and skips the done one", async () => {
    const store = await twoSources();
    store.hangStat.add(A.sourceKey);
    await prewarmDisplayMirrors(store, [A, B], { collectionTimeoutMs: 50 });

    store.hangStat.clear();
    const rerun = await prewarmDisplayMirrors(store, [A, B], { collectionTimeoutMs: 50 });
    expect(rerun.counts).toMatchObject({ built: 1, fresh: 1, failed: 0 });
  });

  it("does not fail a collection that finishes within its deadline", async () => {
    const store = await twoSources();
    const report = await prewarmDisplayMirrors(store, [A, B], { collectionTimeoutMs: 60_000 });
    expect(report.counts).toMatchObject({ built: 2, failed: 0 });
  });
});

describe("prewarm CLI --collection-timeout-ms", () => {
  it("defaults to 20 min and accepts 0 (disabled); rejects a negative or non-integer value", () => {
    expect(DEFAULT_COLLECTION_TIMEOUT_MS).toBe(1_200_000);
    expect(parsePrewarmArgs(["--store", "s3://b/p"]).collectionTimeoutMs).toBe(1_200_000);
    expect(parsePrewarmArgs(["--store", "s3://b/p", "--collection-timeout-ms", "0"]).collectionTimeoutMs).toBe(0);
    expect(() => parsePrewarmArgs(["--store", "s3://b/p", "--collection-timeout-ms", "-1"])).toThrow(/non-negative/);
    expect(() => parsePrewarmArgs(["--store", "s3://b/p", "--collection-timeout-ms", "1.5"])).toThrow(/non-negative/);
  });

  it("reports the stalled collection as failed/timeout, completes the others and exits 1", async () => {
    const store = await twoSources();
    store.hangStat.add(A.sourceKey);
    const lines: string[] = [];
    const code = await runPrewarmCli(
      ["--store", "mem:", "--collections", "qc-zonage-a,qc-zonage-b", "--collection-timeout-ms", "50"],
      { createStore: () => store, out: (l) => lines.push(l) },
    );
    expect(code).toBe(1);
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed[0]).toMatchObject({ start: { collectionTimeoutMs: 50 } });
    expect(parsed.find((p) => p["collection"] === "qc-zonage-a")).toMatchObject({ action: "failed", reason: "timeout" });
    expect(parsed.find((p) => p["collection"] === "qc-zonage-b")).toMatchObject({ action: "built" });
    expect(parsed.at(-1)).toMatchObject({ summary: { failed: ["qc-zonage-a"] } });
  });
});
