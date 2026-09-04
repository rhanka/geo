import { describe, it, expect } from "vitest";

import { createBasemapApp, readBasemapConfig, type BasemapConfig } from "./endpoint.js";
import type { SessionMinter, GoogleSession } from "./session-mint.js";

const gs: GoogleSession = {
  session: "SESS-1",
  expirySeconds: 9999,
  tileWidth: 256,
  tileHeight: 256,
  imageFormat: "png",
};

const onCfg: BasemapConfig = {
  enabled: true,
  session: { mapType: "satellite" },
  serialize: { attribution: { mode: "static", text: "©G" } },
};
const KEY = "KEY-poc-1";

/** A minter stub — bypasses readTileKey/fetch; the endpoint only calls `.get()`. `deps.key` supplies the key. */
function stubMinter(result: GoogleSession | Error): SessionMinter {
  return {
    get: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as SessionMinter;
}

describe("createBasemapApp — flag-OFF by construction", () => {
  it("503 when disabled (flag tested FIRST, independent of the key) + no-store", async () => {
    const app = createBasemapApp({ ...onCfg, enabled: false }, { minter: stubMinter(gs), key: KEY });
    const res = await app.request("/session");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("BasemapDisabled");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("503 when enabled but the restricted key is absent (no key, no minter)", async () => {
    const prev = process.env.GOOGLE_TILE_KEY;
    delete process.env.GOOGLE_TILE_KEY;
    try {
      const app = createBasemapApp({ ...onCfg }, {});
      const res = await app.request("/session");
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe("BasemapKeyAbsent");
    } finally {
      if (prev !== undefined) process.env.GOOGLE_TILE_KEY = prev;
    }
  });

  it("200 envelope: session = {token,expiry,KEY}; descriptor leaks NEITHER; Cache-Control no-store", async () => {
    const app = createBasemapApp(onCfg, { minter: stubMinter(gs), key: KEY });
    const res = await app.request("/session");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as {
      source: unknown;
      session: { session: string; expirySeconds: number; key: string };
    };
    expect(body.source).toMatchObject({ tileSize: { width: 256, height: 256 }, imageFormat: "png" });
    expect(body.session).toEqual({ session: "SESS-1", expirySeconds: 9999, key: KEY });
    // §3.3 + geo-archi cond 1: the PUBLIC descriptor leaks NEITHER the token NOR the key.
    const src = JSON.stringify(body.source);
    expect(src).not.toContain("SESS-1");
    expect(src).not.toContain(KEY);
  });

  it("502 fail-LOUD on a genuine mint failure (never a silent blank — #313)", async () => {
    const app = createBasemapApp(onCfg, {
      minter: stubMinter(new Error("createSession HTTP 403: forbidden")),
      key: KEY,
    });
    const res = await app.request("/session");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe("BasemapMintFailed");
  });
});

describe("readBasemapConfig — flag-OFF default, QC defaults", () => {
  it("defaults enabled OFF and mapType satellite", () => {
    const cfg = readBasemapConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.session.mapType).toBe("satellite");
  });

  it("enables only on exactly '1' (fail-closed)", () => {
    expect(readBasemapConfig({ BASEMAP_2D_ENABLED: "1" }).enabled).toBe(true);
    expect(readBasemapConfig({ BASEMAP_2D_ENABLED: "true" }).enabled).toBe(false);
    expect(readBasemapConfig({ BASEMAP_2D_ENABLED: "" }).enabled).toBe(false);
  });
});
