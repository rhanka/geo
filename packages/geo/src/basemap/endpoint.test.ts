import { describe, it, expect } from "vitest";

import { createBasemapApp, readBasemapConfig, type BasemapConfig } from "./endpoint.js";

const onCfg: BasemapConfig = {
  enabled: true,
  session: { mapType: "satellite" },
};
const KEY = "KEY-poc-1";

describe("createBasemapApp — flag-OFF by construction (public descriptor, client-mint §3.3)", () => {
  it("503 when disabled (flag tested FIRST, independent of the key) + no-store", async () => {
    const app = createBasemapApp({ ...onCfg, enabled: false }, { key: KEY });
    const res = await app.request("/session");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("BasemapDisabled");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("503 when enabled but the restricted key is absent (no key, no env)", async () => {
    const prev = process.env.GOOGLE_TILE_KEY;
    delete process.env.GOOGLE_TILE_KEY;
    try {
      const app = createBasemapApp({ ...onCfg }, {});
      const res = await app.request("/session");
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe("BasemapKeyAbsent");
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      if (prev !== undefined) process.env.GOOGLE_TILE_KEY = prev;
    }
  });

  it("200 descriptor { key, mapType, language?, region? }; Cache-Control no-store; 0 server mint", async () => {
    const app = createBasemapApp(
      { enabled: true, session: { mapType: "satellite", language: "fr-CA", region: "CA" } },
      { key: KEY },
    );
    const res = await app.request("/session");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    // The descriptor carries the key + createSession params; the browser mints the session client-side.
    expect(body).toEqual({ key: KEY, mapType: "satellite", language: "fr-CA", region: "CA" });
  });

  it("200 descriptor omits language/region when unconfigured (no empty fields)", async () => {
    const app = createBasemapApp(onCfg, { key: KEY });
    const res = await app.request("/session");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: KEY, mapType: "satellite" });
  });

  it("scopes CORS to the single configured origin (never '*') + answers the preflight", async () => {
    const app = createBasemapApp({ ...onCfg, corsOrigin: "https://preprod.immo.sent-tech.ca" }, { key: KEY });
    const res = await app.request("/session");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://preprod.immo.sent-tech.ca");
    const preflight = await app.request("/session", { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://preprod.immo.sent-tech.ca");
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

  it("carries configured language/region + the scoped CORS default", () => {
    const cfg = readBasemapConfig({ BASEMAP_2D_LANGUAGE: "en-CA", BASEMAP_2D_REGION: "CA" });
    expect(cfg.session.language).toBe("en-CA");
    expect(cfg.session.region).toBe("CA");
    expect(cfg.corsOrigin).toBe("https://preprod.immo.sent-tech.ca");
  });
});
