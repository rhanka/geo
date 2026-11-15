/**
 * Regression for the 2026-11 preprod prewarm OOMKills (exit 137, three pods in
 * a row on collection #1535 `qc-zonage-montreal-pum-2050-intensification-affectation`,
 * a 4.8 MB source): one 5 729-edge ring whose vertices crowd into one grid cell
 * made the ring check keep 12.7 M pair keys in a `Set` (~630 MB of heap).
 * These tests pin that the ring check stays bounded and unchanged in verdict,
 * and that a source over the builder's budgets fails cleanly (`too-large` in
 * the prewarm, 503 `DisplayUnavailable` in the API) instead of OOM-killing.
 */

import { describe, expect, it } from "vitest";

import type { Position } from "@sentropic/geo-core";

import { createApp } from "../api/app.js";
import { FeatureTooLargeError, parseFeatureCollectionStream } from "../api/providers/collection-loader.js";
import { StoreProvider } from "../api/providers/store-provider.js";
import type { ByteStream, ObjectStat, Store } from "../storage/index.js";

import { buildDisplayMirror, currentKey, DisplayTooLargeError } from "./mirror.js";
import { prewarmDisplayMirrors } from "./prewarm.js";
import { isSimpleRing, RING_PAIR_BUDGET, RingTooComplexError } from "./ring.js";

class MemStore implements Store {
  readonly objects = new Map<string, { body: Uint8Array; etag: string }>();
  sourceReads = 0;
  #writes = 0;

  async put(key: string, body: Uint8Array | string): Promise<void> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body.slice();
    this.objects.set(key, { body: bytes, etag: `"e${++this.#writes}"` });
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    return this.objects.get(key)?.body;
  }
  async getStream(key: string): Promise<ByteStream | undefined> {
    const o = this.objects.get(key);
    if (!o) return undefined;
    if (key.endsWith(".geojson")) this.sourceReads++;
    return (async function* () {
      for (let i = 0; i < o.body.byteLength; i += 4096) yield o.body.subarray(i, i + 4096);
    })();
  }
  async stat(key: string): Promise<ObjectStat | undefined> {
    const o = this.objects.get(key);
    return o ? { etag: o.etag, size: o.body.byteLength } : undefined;
  }
  async has(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
  async list(prefix = ""): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

/**
 * A SIMPLE ring shaped like the culprit: a 1000 x 1000 square whose 4 long
 * edges set the bbox (hence the grid), plus a `crowd`-vertex zigzag squeezed
 * into [0.5, 0.9] x [0.01, 2] — every zigzag edge lands in grid cell (0, 0).
 */
function crowdedRing(crowd: number): Position[] {
  const ring: Position[] = [[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 2]];
  for (let i = 0; i <= crowd; i++) ring.push([i % 2 === 0 ? 0.5 : 0.9, 2 - (1.99 * i) / crowd]);
  ring.push([0, 0]);
  return ring;
}

/** Reference: every non-adjacent pair, no grid. */
function bruteSimple(ring: readonly Position[]): boolean {
  const n = ring.length - 1;
  if (n < 3) return false;
  const orient = (a: Position, b: Position, c: Position): number => {
    const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  };
  const on = (a: Position, b: Position, p: Position): boolean =>
    Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a, b, c, d] = [ring[i]!, ring[i + 1]!, ring[j]!, ring[j + 1]!];
      const o1 = orient(a, b, c);
      const o2 = orient(a, b, d);
      const o3 = orient(c, d, a);
      const o4 = orient(c, d, b);
      if (o1 !== o2 && o3 !== o4) return false;
      if ((o1 === 0 && on(a, b, c)) || (o2 === 0 && on(a, b, d)) || (o3 === 0 && on(c, d, a)) || (o4 === 0 && on(c, d, b))) return false;
    }
  }
  return true;
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fc(geometry: unknown): string {
  return JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", id: "z1", geometry, properties: { zone: "A" } }] });
}

describe("isSimpleRing — bounded memory, unchanged verdict", () => {
  it("checks a crowded ring without per-pair bookkeeping (the #1535 shape)", () => {
    const ring = crowdedRing(5000); // ~12.5 M candidate pairs in one cell
    const heapBefore = process.memoryUsage().heapUsed;
    expect(isSimpleRing(ring)).toBe(true);
    // The Set-based version grew the heap by ~600 MB here; the grid is typed arrays.
    expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(64 * 2 ** 20);
    expect(isSimpleRing(ring, { gridEntryBudget: 0 })).toBe(true); // sweep path agrees
  });

  it("still finds a contact inside the crowded cell", () => {
    const ring = crowdedRing(2000);
    // Pull one zigzag vertex onto a non-adjacent zigzag edge's vertex: a self-touch.
    ring[10] = [...ring[20]!] as Position;
    expect(isSimpleRing(ring)).toBe(false);
    expect(isSimpleRing(ring, { gridEntryBudget: 0 })).toBe(false);
  });

  it("agrees with the all-pairs reference on random rings, grid and sweep paths", () => {
    const random = rng(42);
    for (let t = 0; t < 400; t++) {
      const n = 4 + Math.floor(random() * 40);
      // Small integer coordinates: exact orientations, many collinear/touching cases.
      const span = 3 + Math.floor(random() * 30);
      const ring: Position[] = Array.from({ length: n }, () => [Math.floor(random() * span), Math.floor(random() * span)]);
      ring.push([...ring[0]!] as Position);
      const expected = bruteSimple(ring);
      expect(isSimpleRing(ring), `case ${t}`).toBe(expected);
      expect(isSimpleRing(ring, { gridEntryBudget: 0 }), `case ${t} sweep`).toBe(expected);
    }
    // And on simple star-shaped rings (sorted by angle), long spanning edges included.
    for (let t = 0; t < 50; t++) {
      const n = 10 + Math.floor(random() * 500);
      const ring: Position[] = Array.from({ length: n }, (_, i) => {
        const a = (2 * Math.PI * i) / n;
        const r = 1 + random() * 100;
        return [r * Math.cos(a), r * Math.sin(a)];
      });
      ring.push([...ring[0]!] as Position);
      const expected = bruteSimple(ring);
      expect(isSimpleRing(ring)).toBe(expected);
      expect(isSimpleRing(ring, { gridEntryBudget: 0 })).toBe(expected);
    }
  });

  it("refuses, before comparing, a ring whose candidate pairs exceed the budget", () => {
    const ring = crowdedRing(20000); // ~2e8 pairs in one cell > 2^27
    const t0 = Date.now();
    expect(() => isSimpleRing(ring)).toThrow(RingTooComplexError);
    expect(Date.now() - t0).toBeLessThan(2000); // counted, not compared
    expect(RING_PAIR_BUDGET).toBe(2 ** 27);
  });
});

describe("parseFeatureCollectionStream — maxFeatureBytes", () => {
  async function* chunks(text: string, size: number): AsyncGenerator<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    for (let i = 0; i < bytes.byteLength; i += size) yield bytes.subarray(i, i + size);
  }
  const small = { type: "Feature", id: "a", geometry: null, properties: {} };
  const big = { type: "Feature", id: "b", geometry: null, properties: { blob: "x".repeat(5000) } };
  const text = JSON.stringify({ type: "FeatureCollection", features: [small, big, small] });

  it("yields features under the budget and throws on the first one over it, whatever the chunking", async () => {
    for (const size of [7, 64, 4096, 1 << 20]) {
      const seen: unknown[] = [];
      const run = async (): Promise<void> => {
        for await (const f of parseFeatureCollectionStream(chunks(text, size), { maxFeatureBytes: 1000 })) seen.push(f.id);
      };
      const error = await run().then(() => undefined, (e: unknown) => e);
      expect(error, `chunk ${size}`).toBeInstanceOf(FeatureTooLargeError);
      expect((error as FeatureTooLargeError).featureIndex).toBe(1);
      expect(seen).toEqual(["a"]);
    }
  });

  it("is unbounded by default", async () => {
    const ids: unknown[] = [];
    for await (const f of parseFeatureCollectionStream(chunks(text, 64))) ids.push(f.id);
    expect(ids).toEqual(["a", "b", "a"]);
  });
});

describe("too-large sources fail cleanly", () => {
  const crowded = { type: "Polygon", coordinates: [crowdedRing(20000)] };

  it("buildDisplayMirror throws DisplayTooLargeError and never flips the pointer", async () => {
    const store = new MemStore();
    await store.put("s.geojson", fc(crowded));
    const error = await buildDisplayMirror(store, "c", "s.geojson").then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(DisplayTooLargeError);
    expect((error as DisplayTooLargeError).reason).toBe("too-large");
    expect((error as DisplayTooLargeError).sourceEtag).toBe('"e1"');
    expect(await store.has(currentKey("c"))).toBe(false);

    await store.put("big.geojson", fc({ type: "Polygon", coordinates: [crowdedRing(10)] }));
    await expect(buildDisplayMirror(store, "d", "big.geojson", { maxFeatureBytes: 100 })).rejects.toThrow(DisplayTooLargeError);
  });

  it("the prewarm records failed / too-large and moves on", async () => {
    const store = new MemStore();
    await store.put("a.geojson", fc(crowded));
    await store.put("b.geojson", fc({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }));
    const report = await prewarmDisplayMirrors(store, [
      { collection: "qc-zonage-a", sourceKey: "a.geojson" },
      { collection: "qc-zonage-b", sourceKey: "b.geojson" },
    ]);
    expect(report.counts).toMatchObject({ failed: 1, built: 1 });
    expect(report.failures[0]).toMatchObject({ collection: "qc-zonage-a", action: "failed", reason: "too-large" });
  });

  it("the API answers 503 DisplayUnavailable, and replays the refusal without rebuilding until the source changes", async () => {
    const store = new MemStore();
    await store.put("qc-zonage/x.geojson", fc(crowded));
    await store.put("qc-zonage/x.meta.json", JSON.stringify({ datasetId: "qc-zonage-x", license: "cc-by-4.0" }));
    const app = createApp(new StoreProvider(store, "", { display: { cacheMs: 0 } }));
    const ask = async (): Promise<Response> => app.request("/collections/qc-zonage-x/items?profile=display", { headers: { "Accept-Encoding": "br" } });

    const first = await ask();
    expect(first.status).toBe(503);
    expect(((await first.json()) as { code: string }).code).toBe("DisplayUnavailable");
    const reads = store.sourceReads;
    const again = await ask();
    expect(again.status).toBe(503);
    expect(store.sourceReads).toBe(reads); // refusal replayed: no second build

    await store.put("qc-zonage/x.geojson", fc({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }));
    const fixed = await ask();
    expect(fixed.status).toBe(200);
  });
});
