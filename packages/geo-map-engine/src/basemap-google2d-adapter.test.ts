import { describe, expect, it } from "vitest";

import { createGoogle2dBasemapAdapter } from "./basemap-google2d-adapter.js";
import type { GeoViewport } from "./viewport.js";

const MINT = "https://geo.example.test/basemap/2d/session"; // the flag-gated public descriptor endpoint
const CREATE_SESSION = "https://tile.googleapis.com/v1/createSession"; // real Google URL (constant in the adapter)
const TILE = "https://tile.googleapis.com/v1/2dtiles"; // real Google 2D tile prefix (constant in the adapter)
const VIEWPORT_INFO = "https://tile.example.test/tile/v1/viewport"; // injected for tests
const VIEWPORT: GeoViewport = { center: [-73.6, 45.5], zoom: 10, bearing: 0, pitch: 0 };

/** The public descriptor served by geo-api (no session/key envelope, no attribution — always dynamic). */
function descriptor(overrides: Record<string, unknown> = {}): unknown {
  return { key: "K1", mapType: "satellite", ...overrides };
}

/** A Google `createSession` response. `expiry` is an epoch-seconds string (absolute). */
function sessionBody(session = "S1", expiry = "9999999999"): unknown {
  return { session, expiry, tileWidth: 256, tileHeight: 256, imageFormat: "png" };
}

interface Call {
  url: string;
  init: RequestInit | undefined;
  receiver: unknown;
}

/**
 * Routes an injected `fetch` by URL prefix (unmatched → 404), optionally recording each call's url/init/`this`.
 * NON-arrow so `this` (the receiver) is observable for the Illegal-invocation regression tests.
 */
function routeFetch(routes: { prefix: string; respond: () => Response }[], calls?: Call[]): typeof fetch {
  return (function (
    this: unknown,
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) {
    const url = typeof input === "string" ? input : input.toString();
    calls?.push({ url, init: init as RequestInit | undefined, receiver: this });
    const route = routes.find((r) => url.startsWith(r.prefix));
    return Promise.resolve(route ? route.respond() : new Response("nope", { status: 404 }));
  }) as unknown as typeof fetch;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createGoogle2dBasemapAdapter (client-side mint, §3.3)", () => {
  it("builds a v2 raster-source BasemapSpec (ALWAYS dynamic, live-embed, provider-neutral id)", async () => {
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      fetch: routeFetch([
        { prefix: MINT, respond: () => json(descriptor()) },
        { prefix: CREATE_SESSION, respond: () => json(sessionBody()) },
      ]),
    });

    expect(adapter.basemap).toEqual({
      kind: "raster-source",
      source: {
        id: "sat-2d",
        imageryType: "provider-2d",
        attribution: { mode: "dynamic" }, // §3.1/§2.5 ruling b — hardcoded, never static
        policy: "live-embed-only",
      },
    });
  });

  it("fetches the descriptor then mints the session CLIENT-SIDE (createSession POST with the key + params)", async () => {
    const calls: Call[] = [];
    await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      fetch: routeFetch(
        [
          { prefix: MINT, respond: () => json(descriptor({ language: "fr-CA", region: "CA" })) },
          { prefix: CREATE_SESSION, respond: () => json(sessionBody("S1")) },
        ],
        calls,
      ),
    });

    // The descriptor is fetched from geo-api, THEN createSession is called client-side with the key.
    expect(calls[0]!.url).toBe(MINT);
    const cs = calls.find((c) => c.url.startsWith(CREATE_SESSION));
    expect(cs).toBeDefined();
    expect(cs!.url).toContain("createSession?key=K1"); // key from the descriptor, browser-side
    expect(cs!.init?.method).toBe("POST");
    expect(JSON.parse(cs!.init!.body as string)).toEqual({ mapType: "satellite", language: "fr-CA", region: "CA" });
  });

  it("transformRequest injects session (createSession) + key (descriptor) for provider tiles, leaves others", async () => {
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      fetch: routeFetch([
        { prefix: MINT, respond: () => json(descriptor()) },
        { prefix: CREATE_SESSION, respond: () => json(sessionBody("S1")) },
      ]),
    });

    const tile = adapter.options.transformRequest(`${TILE}/5/10/12`);
    expect(tile).toEqual({ url: `${TILE}/5/10/12?session=S1&key=K1` });

    // A URL that is not a provider tile is passed through unchanged (undefined = "use as-is").
    expect(adapter.options.transformRequest("https://sprites.example.test/sprite.json")).toBeUndefined();
  });

  it("resolveRasterSource returns tileSize/imageFormat from createSession + a dynamic resolver; leaks no key", async () => {
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      viewportInfoUrl: VIEWPORT_INFO,
      fetch: routeFetch([
        { prefix: MINT, respond: () => json(descriptor()) },
        { prefix: CREATE_SESSION, respond: () => json(sessionBody("S1")) },
        { prefix: VIEWPORT_INFO, respond: () => json({ copyright: "Imagery ©2026 Example, Maxar" }) },
      ]),
    });

    const resolved = adapter.resolveRasterSource(adapter.basemap.kind === "raster-source" ? adapter.basemap.source : ({} as never));
    expect(resolved.tileUrlTemplateBase).toBe(`${TILE}/{z}/{x}/{y}`);
    expect(resolved.tileSize).toEqual({ width: 256, height: 256 });
    expect(resolved.imageFormat).toBe("png");
    // §3.3: the resolved descriptor carries NO key.
    expect(JSON.stringify(resolved)).not.toContain("K1");

    // §3.1 ruling b: the dynamic resolver is ALWAYS present (P1.4 — the only attribution source now).
    const copyright = await resolved.attributionResolver?.(VIEWPORT);
    expect(copyright).toBe("Imagery ©2026 Example, Maxar");
  });

  it("refreshes the session (single-flight) once inside the skew window of expiry", async () => {
    let mintCalls = 0;
    let clock = 600_000; // ms
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      now: () => clock,
      refreshSkewSeconds: 300, // 300_000 ms
      fetch: routeFetch([
        { prefix: MINT, respond: () => json(descriptor()) },
        {
          prefix: CREATE_SESSION,
          respond: () => {
            mintCalls += 1;
            // expiry is ABSOLUTE epoch seconds; advance it with the clock so a refreshed session is valid.
            return json(sessionBody(`S${mintCalls}`, String(Math.floor(clock / 1000) + 3600)));
          },
        },
      ]),
    });
    expect(mintCalls).toBe(1); // initial client mint
    expect(adapter.options.transformRequest(`${TILE}/0/0/0`)?.url).toContain("session=S1");

    // S1 expiry = 4200s → expiresAt 4_200_000 ms, refresh threshold 3_900_000. Advance into the skew window.
    clock = 4_000_000;
    adapter.options.transformRequest(`${TILE}/0/0/0`);
    adapter.options.transformRequest(`${TILE}/1/0/0`);
    await new Promise((r) => setTimeout(r, 0));

    expect(mintCalls).toBe(2); // single-flight: two stale tiles → one re-mint
    expect(adapter.options.transformRequest(`${TILE}/2/0/0`)?.url).toContain("session=S2");
  });

  // Descriptor bounded-retry (0.6.1, geo-archi ruling): a TRANSIENT 503 during the activation rollout must
  // not stick the user on OSM when the basemap IS enabled; an INTENTIONAL flag-off must NOT be retried.
  it("(i) retries a TRANSIENT 503 then renders Google on the 200 (basemap IS activated)", async () => {
    let descriptorCalls = 0;
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      sleep: () => Promise.resolve(), // deterministic: no real backoff wait
      fetch: routeFetch([
        {
          prefix: MINT,
          respond: () => {
            descriptorCalls += 1;
            // First hit = a bare/cold gateway 503 (transient); then the descriptor is served.
            return descriptorCalls === 1 ? new Response("cold", { status: 503 }) : json(descriptor());
          },
        },
        { prefix: CREATE_SESSION, respond: () => json(sessionBody("S1")) },
      ]),
    });
    expect(descriptorCalls).toBe(2); // retried once, then 200
    expect(adapter.basemap.kind).toBe("raster-source"); // constructed against Google, NOT OSM
  });

  it("(ii) does NOT retry an intentional flag-off (503 BasemapDisabled) → OSM immediately", async () => {
    let descriptorCalls = 0;
    await expect(createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      sleep: () => Promise.resolve(),
      fetch: routeFetch([
        {
          prefix: MINT,
          respond: () => {
            descriptorCalls += 1;
            return json({ code: "BasemapDisabled", description: "flag-off pré-GO" }, 503);
          },
        },
      ]),
    })).rejects.toMatchObject({ message: "descriptor 503 BasemapDisabled" });
    expect(descriptorCalls).toBe(1); // intentional flag-off is terminal — 0 retry
  });

  it("(iii) gives up a PERSISTENT transient 503 after the bounded retries → OSM", async () => {
    let descriptorCalls = 0;
    await expect(createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      sleep: () => Promise.resolve(),
      fetch: routeFetch([{ prefix: MINT, respond: () => { descriptorCalls += 1; return new Response("cold", { status: 503 }); } }]),
    })).rejects.toMatchObject({ kind: "network", message: "descriptor 503" });
    expect(descriptorCalls).toBe(4); // initial + 3 bounded retries, then reject (fail-closed holds)
  });

  it("tags a client createSession 403 as forbidden for the engine's onError mapping", async () => {
    await expect(createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      fetch: routeFetch([
        { prefix: MINT, respond: () => json(descriptor()) },
        { prefix: CREATE_SESSION, respond: () => new Response("forbidden", { status: 403 }) },
      ]),
    })).rejects.toMatchObject({ kind: "forbidden", message: "createSession 403" });
  });

  it("tags a viewport-info 429 as quota (dynamic attribution resolver)", async () => {
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      viewportInfoUrl: VIEWPORT_INFO,
      fetch: routeFetch([
        { prefix: MINT, respond: () => json(descriptor()) },
        { prefix: CREATE_SESSION, respond: () => json(sessionBody()) },
        { prefix: VIEWPORT_INFO, respond: () => new Response("slow down", { status: 429 }) },
      ]),
    });
    const resolved = adapter.resolveRasterSource(adapter.basemap.kind === "raster-source" ? adapter.basemap.source : ({} as never));

    await expect(resolved.attributionResolver?.(VIEWPORT)).rejects.toMatchObject({ kind: "quota" });
  });

  // Regression (v0.5.3): the fetch must never be called with a non-global receiver — a browser's native
  // fetch throws `TypeError: Illegal invocation`. Assert the receiver on EVERY call site (descriptor,
  // client createSession, viewport-info). (Node's fetch does not brand-check, so we assert the receiver.)
  it("emits the descriptor + client createSession fetches with a global-safe receiver (never the instance)", async () => {
    const calls: Call[] = [];
    const adapter = await createGoogle2dBasemapAdapter({
      mintUrl: MINT,
      viewportInfoUrl: VIEWPORT_INFO,
      fetch: routeFetch(
        [
          { prefix: MINT, respond: () => json(descriptor()) },
          { prefix: CREATE_SESSION, respond: () => json(sessionBody()) },
          { prefix: VIEWPORT_INFO, respond: () => json({ copyright: "©X" }) },
        ],
        calls,
      ),
    });
    const resolved = adapter.resolveRasterSource(adapter.basemap.kind === "raster-source" ? adapter.basemap.source : ({} as never));
    await resolved.attributionResolver?.(VIEWPORT);

    expect(calls.some((c) => c.url.startsWith(MINT))).toBe(true); // a GET <mintUrl> (descriptor) was emitted
    expect(calls.some((c) => c.url.startsWith(CREATE_SESSION))).toBe(true); // the client createSession was emitted
    for (const call of calls) {
      expect([undefined, globalThis]).toContain(call.receiver); // never the SessionState instance
    }
  });

  // Regression companion: with NO injected fetch, the adapter must bind the global fetch to `globalThis`.
  it("binds the default global fetch to globalThis (native fallback receiver)", async () => {
    const savedFetch = globalThis.fetch;
    const receivers: unknown[] = [];
    try {
      globalThis.fetch = function (this: unknown, input: Parameters<typeof fetch>[0]) {
        const url = typeof input === "string" ? input : input.toString();
        receivers.push(this);
        return Promise.resolve(url.startsWith(MINT) ? json(descriptor()) : json(sessionBody()));
      } as unknown as typeof fetch;
      await createGoogle2dBasemapAdapter({ mintUrl: MINT }); // no `fetch` option → default path
    } finally {
      globalThis.fetch = savedFetch;
    }
    expect(receivers.length).toBeGreaterThanOrEqual(2); // descriptor + client createSession
    for (const receiver of receivers) expect(receiver).toBe(globalThis);
  });
});
