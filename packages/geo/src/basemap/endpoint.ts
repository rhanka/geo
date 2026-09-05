/**
 * §5 basemap adapter — public DESCRIPTOR endpoint (FLAG-OFF BY CONSTRUCTION, CLIENT-MINT seam §3.3).
 *
 * `GET /session` serves the flag-gated PUBLIC DESCRIPTOR `{ key, mapType, language?, region? }` that the
 * ENGINE adapter uses to mint a Google session CLIENT-SIDE (the browser calls Google `createSession` with
 * the referrer-restricted key — a server-side call would be a Referer spoof, forbidden; geo-archi §3.3
 * ruling). geo-api makes ZERO outbound call to Google. It is INERT until the owner GO:
 *   • `enabled` off (BASEMAP_2D_ENABLED ≠ "1")  → 503 (flag-OFF, the pre-GO default);
 *   • restricted key absent (readTileKey fail-closed) → 503 (never serves a blank/empty key).
 * Serving live Google tiles is an ACTIVATION requiring the owner GO (ODbL flip ADR-0030 + key) — until
 * then this endpoint refuses loud, NEVER a silent blank (#313).
 *
 * Attribution is NOT in the descriptor: §3.1 (geo-archi §2.5 ruling b) mandates DYNAMIC per-viewport
 * copyright for Google 2D, hardcoded in the engine adapter — a static string would be a "looks-compliant"
 * violation. The response carries the key ⇒ `Cache-Control: no-store` + a SINGLE origin-scoped CORS.
 */

import { Hono } from "hono";

import { readTileKey, type CreateSessionOptions } from "./session-mint.js";

/**
 * §5 preprod-only CORS default (geo-archi ADR-0015 override). `/basemap/2d` serves the restricted key, so it
 * is scoped to the SINGLE preprod-immo origin where the bespoke map runs — never `*`, never the prod origin.
 * i-cond owns the exact immo-preprod host; overridable via `BASEMAP_2D_CORS_ORIGIN`.
 */
export const BASEMAP_2D_DEFAULT_CORS_ORIGIN = "https://preprod.immo.sent-tech.ca";

export interface BasemapConfig {
  /** Master flag — OFF by default (pre-owner-GO). */
  readonly enabled: boolean;
  /** createSession params served in the descriptor (the browser mints with them). */
  readonly session: CreateSessionOptions;
  /**
   * The SINGLE allowed CORS origin for `/basemap/2d` (§5). The endpoint serves the key, so — unlike the open
   * `*` OGC API (ADR-0015) — it is origin-scoped. Defaults to {@link BASEMAP_2D_DEFAULT_CORS_ORIGIN}.
   */
  readonly corsOrigin?: string;
}

/**
 * Read the FLAG-OFF-by-default config from env. QC deployment defaults: `fr-CA`/`CA` (geo-archi nit 2) and
 * `satellite`. The restricted key is NOT read here — {@link createBasemapApp} reads it fail-closed at
 * construction, so an absent key surfaces as a 503 rather than a boot crash.
 */
export function readBasemapConfig(env: NodeJS.ProcessEnv = process.env): BasemapConfig {
  const session: CreateSessionOptions = {
    mapType: (env.BASEMAP_2D_MAP_TYPE as CreateSessionOptions["mapType"] | undefined) ?? "satellite",
    ...(env.BASEMAP_2D_LANGUAGE ? { language: env.BASEMAP_2D_LANGUAGE } : {}),
    ...(env.BASEMAP_2D_REGION ? { region: env.BASEMAP_2D_REGION } : {}),
  };
  return {
    enabled: env.BASEMAP_2D_ENABLED === "1",
    session,
    corsOrigin: (env.BASEMAP_2D_CORS_ORIGIN ?? "").trim() || BASEMAP_2D_DEFAULT_CORS_ORIGIN,
  };
}

/**
 * Build the basemap descriptor sub-app. Mount under a path (e.g. `/basemap/2d`) in the geo-api. The
 * restricted key is read ONCE here (fail-closed → a 503, never a boot crash); `deps.key` injects it for
 * tests. No SessionMinter, no outbound Google call — the mint is client-side (§3.3).
 */
export function createBasemapApp(
  config: BasemapConfig = readBasemapConfig(),
  deps: { key?: string } = {},
): Hono {
  const app = new Hono();

  // §5 CORS (geo-archi override of the open `*` OGC policy, ADR-0015): this route serves the restricted key,
  // so it is scoped to the SINGLE preprod-immo origin — never `*`. Headers are set EXPLICITLY (after the
  // handler) so they survive the mounted-sub-app response, and the preflight is answered here with the same
  // scoped origin.
  const corsOrigin = config.corsOrigin ?? BASEMAP_2D_DEFAULT_CORS_ORIGIN;
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204, {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": c.req.header("Access-Control-Request-Headers") ?? "content-type",
        Vary: "Origin",
      });
    }
    await next();
    c.res.headers.set("Access-Control-Allow-Origin", corsOrigin);
    c.res.headers.set("Vary", "Origin");
  });

  // Read the restricted key ONCE. Fail-closed: an absent key surfaces as a 503, never a boot crash.
  let key: string | undefined = deps.key;
  let initError: string | undefined;
  if (config.enabled && key === undefined) {
    try {
      key = readTileKey();
    } catch (e) {
      initError = (e as Error).message; // key absent → 503 below
    }
  }

  app.get("/session", (c) => {
    // The descriptor carries the restricted key → NEVER cached (proxy/CDN/browser). Set no-store on EVERY
    // response, before any branch.
    c.header("Cache-Control", "no-store");
    if (!config.enabled) {
      return c.json({ code: "BasemapDisabled", description: "basemap 2D non activé (flag-OFF pré-GO owner)" }, 503);
    }
    if (key === undefined) {
      return c.json(
        { code: "BasemapKeyAbsent", description: initError ?? "clé restreinte absente — refus fail-closed" },
        503,
      );
    }
    // PUBLIC descriptor — the browser mints the Google session client-side (§3.3). 0 server call to Google.
    return c.json({
      key,
      mapType: config.session.mapType,
      ...(config.session.language ? { language: config.session.language } : {}),
      ...(config.session.region ? { region: config.session.region } : {}),
    });
  });

  return app;
}
