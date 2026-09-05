import { describe, expect, it } from "vitest";

import { createGoogle2dBasemapAdapter } from "./basemap-google2d-adapter.js";
import type { GeoViewport } from "./viewport.js";

const MINT = "https://geo.example.test/basemap/2d/session";
const VIEWPORT_INFO = "https://tile.example.test/tile/v1/viewport";
const TEMPLATE = "https://tile.example.test/v1/2dtiles/{z}/{x}/{y}";
const VIEWPORT: GeoViewport = { center: [-73.6, 45.5], zoom: 10, bearing: 0, pitch: 0 };

function envelope(session: string, expirySeconds = 3600, mode: "dynamic" | "static" = "dynamic"): unknown {
  return {
    source: {
      tileUrlTemplateBase: TEMPLATE,
      tileSize: { width: 256, height: 256 },
      imageFormat: "png",
      attribution: mode === "dynamic" ? { mode: "dynamic" } : { mode: "static", text: "©Static" },
    },
    session: { session, expirySeconds, key: "K1" },
  };
}

/** Routes an injected `fetch` by URL prefix; unmatched → 404. */
function routeFetch(routes: { prefix: string; respond: () => Response }[]): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input.toString();
    const route = routes.find((r) => url.startsWith(r.prefix));
    return route ? route.respond() : new Response("nope", { status: 404 });
  }) as typeof fetch;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createGoogle2dBasemapAdapter", () => {
  it("builds a v2 raster-source BasemapSpec (dynamic, live-embed) from the mint envelope", async () => {
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      fetch: routeFetch([{ prefix: MINT, respond: () => json(envelope("S1")) }]),
    });

    expect(adapter.basemap).toEqual({
      kind: "raster-source",
      source: {
        id: "sat-2d",
        imageryType: "provider-2d",
        attribution: { mode: "dynamic" },
        policy: "live-embed-only",
      },
    });
  });

  it("transformRequest injects session+key for provider tiles and leaves other URLs untouched", async () => {
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      fetch: routeFetch([{ prefix: MINT, respond: () => json(envelope("S1")) }]),
    });

    const tile = adapter.options.transformRequest("https://tile.example.test/v1/2dtiles/5/10/12");
    expect(tile).toEqual({ url: "https://tile.example.test/v1/2dtiles/5/10/12?session=S1&key=K1" });

    // A URL that is not a provider tile is passed through unchanged (undefined = "use as-is").
    expect(adapter.options.transformRequest("https://sprites.example.test/sprite.json")).toBeUndefined();
  });

  it("resolveRasterSource returns a session/key-free descriptor + a dynamic attributionResolver", async () => {
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      viewportInfoUrl: VIEWPORT_INFO,
      fetch: routeFetch([
        { prefix: MINT, respond: () => json(envelope("S1")) },
        { prefix: VIEWPORT_INFO, respond: () => json({ copyright: "Imagery ©2026 Example, Maxar" }) },
      ]),
    });

    const resolved = adapter.resolveRasterSource(adapter.basemap.kind === "raster-source" ? adapter.basemap.source : ({} as never));
    expect(resolved.tileUrlTemplateBase).toBe(TEMPLATE);
    expect(resolved.tileSize).toEqual({ width: 256, height: 256 });
    expect(resolved.imageFormat).toBe("png");
    // §3.3: the descriptor carries NO session/key.
    expect(JSON.stringify(resolved)).not.toContain("S1");
    expect(JSON.stringify(resolved)).not.toContain("K1");

    const copyright = await resolved.attributionResolver?.(VIEWPORT);
    expect(copyright).toBe("Imagery ©2026 Example, Maxar");
  });

  it("omits the attributionResolver for a STATIC source", async () => {
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      fetch: routeFetch([{ prefix: MINT, respond: () => json(envelope("S1", 3600, "static")) }]),
    });

    const resolved = adapter.resolveRasterSource(adapter.basemap.kind === "raster-source" ? adapter.basemap.source : ({} as never));
    expect(resolved.attributionResolver).toBeUndefined();
  });

  it("refreshes the session (single-flight) once inside the skew window of expiry", async () => {
    let mintCalls = 0;
    let clock = 1_000_000;
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      now: () => clock,
      refreshSkewSeconds: 300,
      fetch: routeFetch([{
        prefix: MINT,
        respond: () => {
          mintCalls += 1;
          return json(envelope(`S${mintCalls}`, 1000));
        },
      }]),
    });
    expect(mintCalls).toBe(1);
    expect(adapter.options.transformRequest("https://tile.example.test/v1/2dtiles/0/0/0")?.url).toContain("session=S1");

    // Advance to within the 300s skew of the 1000s expiry → the next tile triggers ONE background refresh.
    clock += 800_000;
    adapter.options.transformRequest("https://tile.example.test/v1/2dtiles/0/0/0");
    adapter.options.transformRequest("https://tile.example.test/v1/2dtiles/1/0/0");
    await new Promise((r) => setTimeout(r, 0));

    expect(mintCalls).toBe(2); // single-flight: two stale tiles → one refetch
    expect(adapter.options.transformRequest("https://tile.example.test/v1/2dtiles/2/0/0")?.url).toContain("session=S2");
  });

  it("tags a mint failure so the caller can surface it", async () => {
    await expect(createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      fetch: routeFetch([{ prefix: MINT, respond: () => new Response("disabled", { status: 503 }) }]),
    })).rejects.toMatchObject({ kind: "network", message: "mint 503" });
  });

  it("tags a viewport-info 403 as forbidden for the engine's onError mapping", async () => {
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      viewportInfoUrl: VIEWPORT_INFO,
      fetch: routeFetch([
        { prefix: MINT, respond: () => json(envelope("S1")) },
        { prefix: VIEWPORT_INFO, respond: () => new Response("forbidden", { status: 403 }) },
      ]),
    });
    const resolved = adapter.resolveRasterSource(adapter.basemap.kind === "raster-source" ? adapter.basemap.source : ({} as never));

    await expect(resolved.attributionResolver?.(VIEWPORT)).rejects.toMatchObject({ kind: "forbidden" });
  });

  // Regression: the mint fetch was called as `this.#fetch(...)`, making the receiver the SessionState
  // instance → a browser's native fetch throws `TypeError: Illegal invocation` before any I/O, so no
  // `/session` request is emitted and the satellite never renders. The adapter must only ever call fetch
  // with a global-safe receiver. (Node's fetch does not brand-check, so we assert the receiver directly.)
  it("emits GET <mintUrl> with a global-safe fetch receiver (never the adapter instance)", async () => {
    const calls: { receiver: unknown; url: string }[] = [];
    // A NON-arrow fetch so `this` is observable; injected fetch stays unbound so we see the real receiver.
    const recordingFetch = function (this: unknown, input: Parameters<typeof fetch>[0]) {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ receiver: this, url });
      return Promise.resolve(url.startsWith(MINT) ? json(envelope("S1")) : json({ copyright: "©X" }));
    } as typeof fetch;

    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      viewportInfoUrl: VIEWPORT_INFO,
      fetch: recordingFetch,
    });
    // Exercise the second fetch call site (viewport-info) too.
    const resolved = adapter.resolveRasterSource(
      adapter.basemap.kind === "raster-source" ? adapter.basemap.source : ({} as never),
    );
    await resolved.attributionResolver?.(VIEWPORT);

    expect(calls.some((c) => c.url.startsWith(MINT))).toBe(true); // a GET <mintUrl> was actually emitted
    for (const call of calls) {
      expect([undefined, globalThis]).toContain(call.receiver); // never the SessionState instance
    }
  });

  // Regression companion: when NO fetch is injected, the adapter must bind the global fetch to
  // `globalThis` (not call it detached), so the native fallback path itself carries a valid receiver.
  it("binds the default global fetch to globalThis (native fallback receiver)", async () => {
    const savedFetch = globalThis.fetch;
    const receivers: unknown[] = [];
    try {
      globalThis.fetch = function (this: unknown, input: Parameters<typeof fetch>[0]) {
        const url = typeof input === "string" ? input : input.toString();
        receivers.push(this);
        return Promise.resolve(url.startsWith(MINT) ? json(envelope("S1")) : json({ copyright: "©X" }));
      } as typeof fetch;
      await createGoogle2dBasemapAdapter({ mintUrl: MINT }); // no `fetch` option → default path
    } finally {
      globalThis.fetch = savedFetch;
    }
    expect(receivers.length).toBeGreaterThanOrEqual(1);
    for (const receiver of receivers) expect(receiver).toBe(globalThis);
  });
});
