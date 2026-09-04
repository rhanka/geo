/**
 * §5 basemap adapter — mint HTTP endpoint (FLAG-OFF BY CONSTRUCTION).
 *
 * `GET /session` mints (or returns the cached) Google Map Tiles 2D session and serves the mint envelope
 * (public descriptor + adapter-internal session, see serialize.ts). It is INERT until the owner GO:
 *   • `enabled` off (BASEMAP_2D_ENABLED ≠ "1")  → 503 (flag-OFF, the pre-GO default);
 *   • restricted key absent (readTileKey fail-closed) → 503 (never calls Google unauthenticated);
 *   • a genuine mint failure (session-expired|forbidden|quota|network) → 502 fail-LOUD.
 * Serving live Google tiles is an ACTIVATION requiring the owner GO (ODbL flip ADR-0030 + key) — until
 * then this endpoint refuses loud, NEVER a silent blank (#313). The engine's declared fallback
 * (blank+notice) is PR-B's concern, downstream of this refusal.
 */

import { Hono } from "hono";

import { SessionMinter, readTileKey, type CreateSessionOptions } from "./session-mint.js";
import { serializeMint, type AttributionSpec, type SerializeConfig } from "./serialize.js";

export interface BasemapConfig {
  /** Master flag — OFF by default (pre-owner-GO). */
  readonly enabled: boolean;
  readonly session: CreateSessionOptions;
  readonly serialize: SerializeConfig;
}

/**
 * Read the FLAG-OFF-by-default config from env. QC deployment defaults: `fr-CA`/`CA` (geo-archi nit 2)
 * and `satellite`. The restricted key is NOT read here — the {@link SessionMinter} reads it fail-closed
 * at construction, so an absent key surfaces as a 503 rather than a boot crash.
 */
export function readBasemapConfig(env: NodeJS.ProcessEnv = process.env): BasemapConfig {
  const session: CreateSessionOptions = {
    mapType: (env.BASEMAP_2D_MAP_TYPE as CreateSessionOptions["mapType"] | undefined) ?? "satellite",
    ...(env.BASEMAP_2D_LANGUAGE ? { language: env.BASEMAP_2D_LANGUAGE } : {}),
    ...(env.BASEMAP_2D_REGION ? { region: env.BASEMAP_2D_REGION } : {}),
  };
  return { enabled: env.BASEMAP_2D_ENABLED === "1", session, serialize: { attribution: readAttribution(env) } };
}

/**
 * Attribution from env (MANDATORY, §3.1). A static baseline "Imagery ©Google" applies when unset; the
 * DYNAMIC per-viewport copyright is the engine's mechanism (PR-B, geo-archi) — not wired at the mint.
 */
function readAttribution(env: NodeJS.ProcessEnv): AttributionSpec {
  const text = (env.BASEMAP_2D_ATTRIBUTION ?? "").trim();
  return { mode: "static", text: text || "Imagery ©Google" };
}

/**
 * Build the basemap mint sub-app. Mount under a path (e.g. `/basemap/2d`) in the geo-api. The
 * {@link SessionMinter} is constructed ONCE here (cache + refresh + single-flight span requests); a
 * flag-OFF config or an absent key leaves it unbuilt, so `/session` answers 503. `deps.minter` injects a
 * minter for tests.
 */
export function createBasemapApp(
  config: BasemapConfig = readBasemapConfig(),
  deps: { minter?: SessionMinter; key?: string } = {},
): Hono {
  const app = new Hono();

  // Read the restricted key ONCE (geo-archi ruling (a): it rides the adapter-internal SessionResolution).
  // Fail-closed: an absent key surfaces as a 503, never a boot crash. `deps.key`/`deps.minter` for tests.
  let minter: SessionMinter | undefined = deps.minter;
  let sessionKey: string | undefined = deps.key;
  let initError: string | undefined;
  if (config.enabled && (sessionKey === undefined || !minter)) {
    try {
      if (sessionKey === undefined) sessionKey = readTileKey();
      if (!minter) minter = new SessionMinter(config.session, { key: sessionKey });
    } catch (e) {
      initError = (e as Error).message; // key absent → 503 below
    }
  }

  app.get("/session", async (c) => {
    // (geo-archi cond 2) the response carries key+session → NEVER cached (proxy/CDN/browser). Set no-store
    // on EVERY /session response, before any branch.
    c.header("Cache-Control", "no-store");
    if (!config.enabled) {
      return c.json({ code: "BasemapDisabled", description: "basemap 2D non activé (flag-OFF pré-GO owner)" }, 503);
    }
    if (!minter || sessionKey === undefined) {
      return c.json(
        { code: "BasemapKeyAbsent", description: initError ?? "clé restreinte absente — refus fail-closed" },
        503,
      );
    }
    try {
      const session = await minter.get();
      return c.json(serializeMint(session, config.serialize, sessionKey));
    } catch (e) {
      // Genuine failure (session-expired|forbidden|quota|network) — fail-LOUD, never a silent blank (#313).
      return c.json({ code: "BasemapMintFailed", description: (e as Error).message.slice(0, 200) }, 502);
    }
  });

  return app;
}
