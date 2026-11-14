import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../api/app.js";
import { StoreProvider } from "../api/providers/store-provider.js";
import { preferServedKey, servedSourceKeys, type ByteStream, type ObjectStat, type Store } from "../storage/index.js";

import { currentKey, DISPLAY_PROFILE, parseManifest } from "./mirror.js";
import { parsePrewarmArgs, runPrewarmCli } from "./prewarm-cli.js";
import { listDisplaySources, prewarmDisplayMirrors, warmViaApi } from "./prewarm.js";
import {
  DISPLAY_PUBLISH_FAILED,
  displayMirrorFreshness,
  ensureDisplayMirror,
  isDisplayPublishedCollection,
  publishDisplayMirror,
  resolvePublishedCollection,
} from "./publish.js";

/** In-memory store; etag = global write counter, so a copied object gets a NEW etag. */
class MemStore implements Store {
  readonly objects = new Map<string, { body: Uint8Array; etag: string }>();
  puts = 0;
  failPutsUnder: string | undefined;
  #writes = 0;

  async put(key: string, body: Uint8Array | string): Promise<void> {
    if (this.failPutsUnder !== undefined && key.startsWith(this.failPutsUnder)) throw new Error("AccessDenied");
    this.puts++;
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    this.objects.set(key, { body: bytes, etag: `"e${++this.#writes}"` });
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    return this.objects.get(key)?.body;
  }
  async getStream(key: string): Promise<ByteStream | undefined> {
    const o = this.objects.get(key);
    if (!o) return undefined;
    return (async function* () {
      yield o.body;
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
  /** Copy every object to `into` (new etags, same bytes) — like a bucket mirror. */
  async copyTo(into: MemStore): Promise<void> {
    for (const [key, o] of this.objects) await into.put(key, o.body);
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

const meta = (datasetId: string): string => JSON.stringify({ datasetId, license: "cc-by-4.0" });

afterEach(() => vi.restoreAllMocks());

describe("isDisplayPublishedCollection", () => {
  it("keeps qc-lots-* and qc-zonage-* only, never qc-zonage-norms-*", () => {
    expect(isDisplayPublishedCollection("qc-lots-rawdon")).toBe(true);
    expect(isDisplayPublishedCollection("qc-zonage-rawdon")).toBe(true);
    expect(isDisplayPublishedCollection("qc-zonage-norms-rawdon")).toBe(false);
    expect(isDisplayPublishedCollection("rawdon")).toBe(false);
    expect(isDisplayPublishedCollection("qc-tod-montreal")).toBe(false);
  });
});

describe("served source selection (shared with the serving index)", () => {
  it("prefers nested over flat for one stem, else the later sorted key", () => {
    expect(preferServedKey("z/qc-zonage-a.geojson", "z/qc-zonage-a/qc-zonage-a.geojson")).toBe("z/qc-zonage-a/qc-zonage-a.geojson");
    expect(preferServedKey("qc-cadastre-lots/a.geojson", "qc-lots/qc-lots-a.geojson")).toBe("qc-lots/qc-lots-a.geojson");
    const map = servedSourceKeys([
      { key: "qc-lots/qc-lots-a.geojson" },
      { key: "qc-cadastre-lots/a.geojson", datasetId: "qc-lots-a" },
      { key: "ca-qc-zonage/qc-zonage-a/qc-zonage-a.geojson" },
      { key: "ca-qc-zonage/qc-zonage-a.geojson" },
      { key: "ca-qc-zonage/_replaced/qc-zonage-a.geojson" },
    ]);
    expect(Object.fromEntries(map)).toEqual({
      "qc-lots-a": "qc-lots/qc-lots-a.geojson",
      "qc-zonage-a": "ca-qc-zonage/qc-zonage-a/qc-zonage-a.geojson",
    });
  });

  it("matches what StoreProvider serves", async () => {
    const store = new MemStore();
    await store.put("ca-qc-zonage/qc-zonage-a.geojson", fc(1));
    await store.put("ca-qc-zonage/qc-zonage-a/qc-zonage-a.geojson", fc(2));
    const sources = await listDisplaySources(store);
    expect(sources).toEqual([{ collection: "qc-zonage-a", sourceKey: "ca-qc-zonage/qc-zonage-a/qc-zonage-a.geojson" }]);
    const res = await createApp(new StoreProvider(store)).request("/collections/qc-zonage-a/items");
    expect(((await res.json()) as { features: unknown[] }).features).toHaveLength(2);
  });
});

describe("publishDisplayMirror (writer hook)", () => {
  it("builds the mirror right after the write: present, current, and served without a build", async () => {
    const store = new MemStore();
    await store.put("qc-cadastre-lots/rawdon.meta.json", meta("qc-lots-rawdon"));
    await store.put("qc-cadastre-lots/rawdon.geojson", fc(3));

    const outcome = await publishDisplayMirror(store, "qc-cadastre-lots/rawdon.geojson", { log: () => {} });
    expect(outcome).toMatchObject({ status: "built", collection: "qc-lots-rawdon", sourceKey: "qc-cadastre-lots/rawdon.geojson" });

    const state = await displayMirrorFreshness(store, "qc-lots-rawdon", "qc-cadastre-lots/rawdon.geojson");
    expect(state.fresh).toBe(true);
    const pointer = parseManifest(new TextDecoder().decode(await store.get(currentKey("qc-lots-rawdon"))));
    expect(pointer?.profile).toBe(DISPLAY_PROFILE);

    // The first API request is served from the published version: no build, not stale.
    const putsBefore = store.puts;
    const app = createApp(new StoreProvider(store, "", { display: { cacheMs: 0 } }));
    const res = await app.request("/collections/qc-lots-rawdon/items?profile=display", { headers: { "Accept-Encoding": "br" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Geo-Display-Version")).toBe(pointer?.version);
    expect(res.headers.get("X-Geo-Display-Stale")).toBeNull();
    await res.arrayBuffer();
    expect(store.puts).toBe(putsBefore);
  });

  it("rebuilds after a rewrite of the source", async () => {
    const store = new MemStore();
    await store.put("ca-qc-zonage/qc-zonage-a.geojson", fc(1));
    const first = await publishDisplayMirror(store, "ca-qc-zonage/qc-zonage-a.geojson", { log: () => {} });
    await store.put("ca-qc-zonage/qc-zonage-a.geojson", fc(2));
    const second = await publishDisplayMirror(store, "ca-qc-zonage/qc-zonage-a.geojson", { log: () => {} });
    expect(second.status).toBe("built");
    expect((second as { version: string }).version).not.toBe((first as { version: string }).version);
    expect((await displayMirrorFreshness(store, "qc-zonage-a", "ca-qc-zonage/qc-zonage-a.geojson")).fresh).toBe(true);
  });

  it("skips writes geo-api does not serve for that collection", async () => {
    const store = new MemStore();
    await store.put("ca-qc-zonage/qc-zonage-a.geojson", fc(1));
    await store.put("ca-qc-zonage/qc-zonage-a/qc-zonage-a.geojson", fc(1));
    await store.put("ca-qc-zonage/qc-zonage-norms-a.geojson", fc(1));
    await store.put("ca-qc-zonage/qc-zonage-a.additive-prebackup.geojson", fc(1));
    expect(await resolvePublishedCollection(store, "ca-qc-zonage/qc-zonage-a.geojson")).toMatchObject({ kind: "skip", reason: "superseded-by-nested" });
    expect(await resolvePublishedCollection(store, "ca-qc-zonage/qc-zonage-a/qc-zonage-a.geojson")).toMatchObject({ kind: "target", collection: "qc-zonage-a" });
    expect(await resolvePublishedCollection(store, "ca-qc-zonage/qc-zonage-norms-a.geojson")).toMatchObject({ kind: "skip", reason: "not-display-family" });
    expect(await resolvePublishedCollection(store, "ca-qc-zonage/qc-zonage-a.additive-prebackup.geojson")).toMatchObject({ kind: "skip", reason: "not-canonical" });
    expect(await resolvePublishedCollection(store, "ca-qc-zonage/qc-zonage-a.meta.json")).toMatchObject({ kind: "skip", reason: "not-canonical" });
  });

  it("does not flip the mirror to a key that loses the served tie-break", async () => {
    const store = new MemStore();
    await store.put("qc-lots/qc-lots-a.geojson", fc(2));
    await store.put("qc-cadastre-lots/a.meta.json", meta("qc-lots-a"));
    await store.put("qc-cadastre-lots/a.geojson", fc(1));
    await publishDisplayMirror(store, "qc-lots/qc-lots-a.geojson", { log: () => {} });
    const outcome = await publishDisplayMirror(store, "qc-cadastre-lots/a.geojson", { log: () => {} });
    expect(outcome).toMatchObject({ status: "skipped", reason: "served-by-other-key", collection: "qc-lots-a" });
    expect((await displayMirrorFreshness(store, "qc-lots-a", "qc-lots/qc-lots-a.geojson")).fresh).toBe(true);
  });

  it("never throws: a failed build is returned and logged loudly, the exact write stands", async () => {
    const store = new MemStore();
    await store.put("ca-qc-zonage/qc-zonage-a.geojson", fc(1));
    store.failPutsUnder = "_display/";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await publishDisplayMirror(store, "ca-qc-zonage/qc-zonage-a.geojson", { log: () => {} });
    expect(outcome).toMatchObject({ status: "failed", collection: "qc-zonage-a", error: "AccessDenied" });
    expect(errors.mock.calls.some((c) => String(c[0]).includes(DISPLAY_PUBLISH_FAILED))).toBe(true);
    expect(await store.has("ca-qc-zonage/qc-zonage-a.geojson")).toBe(true);
  });
});

describe("ensureDisplayMirror (prewarm skip logic)", () => {
  it("skips a fresh mirror without writing anything", async () => {
    const store = new MemStore();
    await store.put("ca-qc-zonage/qc-zonage-a.geojson", fc(1));
    expect((await ensureDisplayMirror(store, "qc-zonage-a", "ca-qc-zonage/qc-zonage-a.geojson")).action).toBe("built");
    const puts = store.puts;
    const again = await ensureDisplayMirror(store, "qc-zonage-a", "ca-qc-zonage/qc-zonage-a.geojson");
    expect(again.action).toBe("fresh");
    expect(store.puts).toBe(puts);
  });

  it("is not fresh for another profile, another source key, or a changed ETag", async () => {
    const store = new MemStore();
    await store.put("ca-qc-zonage/qc-zonage-a.geojson", fc(1));
    await ensureDisplayMirror(store, "qc-zonage-a", "ca-qc-zonage/qc-zonage-a.geojson");
    const pointer = JSON.parse(new TextDecoder().decode(await store.get(currentKey("qc-zonage-a")))) as Record<string, unknown>;

    await store.put(currentKey("qc-zonage-a"), JSON.stringify({ ...pointer, profile: "display-p5-v0" }));
    expect(await displayMirrorFreshness(store, "qc-zonage-a", "ca-qc-zonage/qc-zonage-a.geojson")).toMatchObject({ fresh: false, reason: "other-profile" });
    await store.put(currentKey("qc-zonage-a"), JSON.stringify({ ...pointer, source_key: "x/qc-zonage-a.geojson" }));
    expect(await displayMirrorFreshness(store, "qc-zonage-a", "ca-qc-zonage/qc-zonage-a.geojson")).toMatchObject({ fresh: false, reason: "other-source" });
    await store.put(currentKey("qc-zonage-a"), JSON.stringify({ ...pointer, source_etag: '"older"' }));
    expect(await displayMirrorFreshness(store, "qc-zonage-a", "ca-qc-zonage/qc-zonage-a.geojson")).toMatchObject({ fresh: false, reason: "source-changed" });
    await expect(displayMirrorFreshness(store, "qc-zonage-b", "ca-qc-zonage/qc-zonage-b.geojson")).rejects.toThrow(/source missing/);
  });

  it("adopts a copied mirror whose source bytes match (new ETag), without building", async () => {
    const prod = new MemStore();
    await prod.put("ca-qc-zonage/qc-zonage-a.geojson", fc(4));
    const built = await ensureDisplayMirror(prod, "qc-zonage-a", "ca-qc-zonage/qc-zonage-a.geojson");
    const preprod = new MemStore();
    await preprod.put("unrelated.json", "{}"); // shift the ETag counter
    await prod.copyTo(preprod); // every ETag differs, bytes are identical

    expect((await displayMirrorFreshness(preprod, "qc-zonage-a", "ca-qc-zonage/qc-zonage-a.geojson")).fresh).toBe(false);
    const puts = preprod.puts;
    const adopted = await ensureDisplayMirror(preprod, "qc-zonage-a", "ca-qc-zonage/qc-zonage-a.geojson", { build: false });
    expect(adopted).toMatchObject({ action: "adopted", reason: "source-changed", version: built.version });
    expect(preprod.puts).toBe(puts + 1); // only current.json
    expect((await displayMirrorFreshness(preprod, "qc-zonage-a", "ca-qc-zonage/qc-zonage-a.geojson")).fresh).toBe(true);
  });

  it("reports needs-build instead of building when build is off and nothing is adoptable", async () => {
    const store = new MemStore();
    await store.put("ca-qc-zonage/qc-zonage-a.geojson", fc(1));
    const r = await ensureDisplayMirror(store, "qc-zonage-a", "ca-qc-zonage/qc-zonage-a.geojson", { build: false });
    expect(r).toMatchObject({ action: "needs-build", reason: "no-mirror" });
    expect(await store.has(currentKey("qc-zonage-a"))).toBe(false);
  });
});

describe("prewarmDisplayMirrors", () => {
  async function city(store: MemStore, slug: string): Promise<void> {
    await store.put(`qc-cadastre-lots/${slug}.meta.json`, meta(`qc-lots-${slug}`));
    await store.put(`qc-cadastre-lots/${slug}.geojson`, fc(2));
    await store.put(`ca-qc-zonage/qc-zonage-${slug}.geojson`, fc(1));
    await store.put(`ca-qc-zonage/qc-zonage-norms-${slug}.geojson`, fc(1));
    await store.put(`${slug}.geojson`, fc(1));
  }

  it("builds every lots/zonage mirror once, then a re-run skips them all", async () => {
    const store = new MemStore();
    await city(store, "rawdon");
    await city(store, "alma");
    const sources = await listDisplaySources(store);
    expect(sources.map((s) => s.collection)).toEqual(["qc-lots-alma", "qc-lots-rawdon", "qc-zonage-alma", "qc-zonage-rawdon"]);

    const seen: string[] = [];
    const first = await prewarmDisplayMirrors(store, sources, { onResult: (r, done, total) => seen.push(`${done}/${total} ${r.action}`) });
    expect(first.counts).toMatchObject({ built: 4, fresh: 0, failed: 0 });
    expect(seen).toEqual(["1/4 built", "2/4 built", "3/4 built", "4/4 built"]);

    const puts = store.puts;
    const second = await prewarmDisplayMirrors(store, await listDisplaySources(store));
    expect(second.counts).toMatchObject({ fresh: 4, built: 0 });
    expect(store.puts).toBe(puts);
  });

  it("records a failure and goes on", async () => {
    const store = new MemStore();
    await city(store, "alma");
    const sources = [{ collection: "qc-zonage-ghost", sourceKey: "ca-qc-zonage/qc-zonage-ghost.geojson" }, ...(await listDisplaySources(store))];
    const report = await prewarmDisplayMirrors(store, sources);
    expect(report.counts).toMatchObject({ failed: 1, built: 2 });
    expect(report.failures[0]).toMatchObject({ collection: "qc-zonage-ghost", action: "failed" });
  });
});

describe("warmViaApi and the CLI", () => {
  it("issues one profile=index request at a time and reads the display headers", async () => {
    const calls: string[] = [];
    let inFlight = 0;
    const fakeFetch = (async (url: string) => {
      inFlight++;
      expect(inFlight).toBe(1);
      calls.push(url);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return new Response("{}", { status: 200, headers: { "X-Geo-Display-Version": "abcd" } });
    }) as unknown as typeof fetch;
    const results = await warmViaApi("https://api.example/", ["qc-lots-a", "qc-zonage-a"], { fetch: fakeFetch });
    expect(calls).toEqual([
      "https://api.example/collections/qc-lots-a/items?profile=index",
      "https://api.example/collections/qc-zonage-a/items?profile=index",
    ]);
    expect(results.map((r) => [r.status, r.version, r.stale])).toEqual([
      [200, "abcd", false],
      [200, "abcd", false],
    ]);
  });

  it("refuses an API sweep without an explicit list, and ambiguous modes", () => {
    expect(() => parsePrewarmArgs(["--api", "https://x"])).toThrow(/explicit --collections/);
    expect(() => parsePrewarmArgs(["--api", "https://x", "--store", "s3://b/p"])).toThrow(/exactly one/);
    expect(parsePrewarmArgs(["--store", "s3://b/normalized"])).toMatchObject({ concurrency: 1, adopt: true, build: true });
  });

  it("runs a store sweep, reports unknown collections and exits non-zero", async () => {
    const store = new MemStore();
    await store.put("ca-qc-zonage/qc-zonage-a.geojson", fc(1));
    const lines: string[] = [];
    const code = await runPrewarmCli(["--store", "mem:", "--collections", "qc-zonage-a,qc-zonage-zz"], {
      createStore: () => store,
      out: (l) => lines.push(l),
    });
    expect(code).toBe(1);
    const summary = JSON.parse(lines.at(-1)!) as { summary: { counts: { built: number }; failed: string[] } };
    expect(summary.summary.counts.built).toBe(1);
    expect(summary.summary.failed).toEqual(["qc-zonage-zz"]);
  });
});
