/**
 * §5 Google Map Tiles 2D basemap adapter — FRAMEWORK-NEUTRAL (wp7/geo-socle, ADR-0025/0026/0029, §2.5/§3.3).
 *
 * CLIENT-SIDE MINT (geo-archi §3.3 ruling, i-infra endorsed). A referrer-restricted API key is a BROWSER
 * mechanism: a server-side `createSession` with such a key would be a Referer spoof (forbidden), and the
 * serving netpol blocks geo-api→Google anyway. So the mint runs in the BROWSER. The geo-api endpoint
 * `/basemap/2d/session` serves a flag-gated PUBLIC DESCRIPTOR (`{ key, mapType, language?, region? }`) —
 * never a server-minted session. This adapter, from the browser:
 *   1. fetches the descriptor (no-store; 503 pre-GO / key-absent → clean reject → the consumer falls back to OSM);
 *   2. mints a Google session client-side (`POST createSession?key=<key>`), refreshing before expiry (single-flight);
 *   3. produces the three inputs the engine `mount()` consumes:
 *      • `basemap`  — the v2 `raster-source` BasemapSpec (logical id + attribution + live-embed policy);
 *      • `resolveRasterSource` — the tile template base + tile size + `attributionResolver`;
 *      • `options.transformRequest` — the per-tile closure that injects `?session=&key=` (MapLibre passthrough).
 * A design-system wiring layer SPREADS these into `mount()` (ADR-0025 zero-copy) — it never re-implements
 * this logic and never reads the session/key.
 *
 * §3.1 ATTRIBUTION = ALWAYS DYNAMIC for Google 2D (geo-archi §2.5 ruling b): the per-viewport copyright
 * holders vary by view (Google / Maxar / Landsat / Copernicus…), so a static string can never be correct —
 * a static `©Google` IS the "looks-compliant" §3.1 violation. This adapter therefore hardcodes
 * `attribution.mode = "dynamic"` (the violation is impossible by construction, not merely discouraged) and
 * ALWAYS provides the viewport-info `attributionResolver`. The provider-neutral `AttributionSpec` union
 * stays at the engine-contract level for a future legitimately-static provider (e.g. PMTiles).
 *
 * §3.3 NO-SECRET-TO-ENGINE: the restricted key + minted session live SOLELY in the adapter closures here
 * (`transformRequest` + `attributionResolver`). They are NEVER folded into the `BasemapSpec` or the
 * `ResolvedRasterSource` the engine sees. Tiles go browser→Google LIVE under the key's referrer restriction
 * (live-embed-only, §3.2) — never proxied/cached by geo infra.
 *
 * ACTIVATION-VALIDATED (like the whole of §5): the live Google calls (createSession, tiles, the viewport-info
 * copyright) are exercised only once the owner GO flips the flag ON; pre-GO the descriptor endpoint is 503
 * and this adapter rejects at construction. Its LOGIC (descriptor parse, client mint, session refresh,
 * per-tile injection, viewport-info request/parse) is unit-tested here via an injected `fetch`.
 */

import type { BasemapSpec, RasterSource } from "./basemap.js";
import type { ResolvedRasterSource } from "./surface.js";
import type { GeoViewport } from "./viewport.js";

/**
 * The PUBLIC descriptor served by geo-api `/basemap/2d/session` (flag-gated). Declared LOCALLY so the engine
 * keeps zero dep on `packages/geo`. NO attribution field (§2.5 ruling b — always dynamic, see the file
 * header); NO session/key envelope (the browser mints). Forward-note: a `provider?` tag lands here if a
 * second basemap provider is ever added.
 */
interface BasemapDescriptor {
  readonly key: string;
  readonly mapType: string;
  readonly language?: string;
  readonly region?: string;
}

/** Google `createSession` response (the fields we rely on). `expiry` is an epoch-seconds string (ABSOLUTE). */
interface GoogleSession {
  readonly session: string;
  readonly expiryEpochSeconds: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly imageFormat: string;
}

/** MapLibre's `transformRequest` shape (structural — avoids a maplibre-gl type dep in this neutral module). */
export type TileRequestTransform = (url: string, resourceType?: string) => { readonly url: string } | undefined;

export interface Google2dBasemapAdapter {
  /** The v2 `raster-source` BasemapSpec — pass as `mount({ basemap })` / `handle.setBasemap`. */
  readonly basemap: BasemapSpec;
  /** Pass as `mount({ resolveRasterSource })` — the engine calls it to render + attribute the source. */
  resolveRasterSource(source: RasterSource): ResolvedRasterSource;
  /** Spread into `mount({ options })` — MapLibre passthrough; injects `?session=&key=` per tile. */
  readonly options: { readonly transformRequest: TileRequestTransform };
}

export interface Google2dBasemapAdapterOptions {
  /** The geo-api descriptor endpoint (e.g. `/basemap/2d/session`), absolute or same-origin relative. */
  readonly mintUrl: string;
  /** Logical source id carried by the BasemapSpec (default `sat-2d` — a role-scoped, provider-NEUTRAL id per §2.3; the provider lives in the adapter, never the contract id). */
  readonly sourceId?: string;
  /** Injected for tests / non-browser callers (defaults to the global `fetch`). */
  readonly fetch?: typeof fetch;
  /** Injected clock for deterministic refresh tests (defaults to `Date.now`). */
  readonly now?: () => number;
  /** Google viewport-info endpoint for the dynamic copyright (default the documented Google URL). */
  readonly viewportInfoUrl?: string;
  /** Refresh the session this many seconds BEFORE its expiry (single-flight, default 300s). */
  readonly refreshSkewSeconds?: number;
}

const DEFAULT_SOURCE_ID = "sat-2d";
const CREATE_SESSION_URL = "https://tile.googleapis.com/v1/createSession";
const TILE_URL_TEMPLATE_BASE = "https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}";
const DEFAULT_VIEWPORT_INFO_URL = "https://tile.googleapis.com/tile/v1/viewport";
const DEFAULT_REFRESH_SKEW_SECONDS = 300;

/**
 * Builds the §5 Google-2D adapter. ASYNC because it fetches the descriptor AND mints the initial session up
 * front, so the per-tile `transformRequest` (which MapLibre calls SYNCHRONOUSLY) always has a live
 * session/key to inject; it refreshes the session in the background before expiry.
 */
export async function createGoogle2dBasemapAdapter(
  options: Google2dBasemapAdapterOptions,
): Promise<Google2dBasemapAdapter> {
  // Bind the native fallback to `globalThis`: the stored fetch is later called as `this.#fetch(...)`
  // (a method call whose receiver would be the SessionState instance) — a browser's native fetch then
  // throws `TypeError: Illegal invocation` BEFORE any I/O, so no request is ever emitted. An injected test
  // fetch ignores its receiver, so this path was latent until preprod. The injected fetch stays UNBOUND so
  // tests can assert the receiver.
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const sourceId = options.sourceId ?? DEFAULT_SOURCE_ID;
  const viewportInfoUrl = options.viewportInfoUrl ?? DEFAULT_VIEWPORT_INFO_URL;
  const refreshSkewMs = (options.refreshSkewSeconds ?? DEFAULT_REFRESH_SKEW_SECONDS) * 1000;

  // 1. Fetch the flag-gated public descriptor (503 pre-GO / key-absent → reject → OSM fallback).
  const descriptor = await fetchDescriptor(doFetch, options.mintUrl);

  // 2. Client-side session mint + refresh (single-flight).
  const state = new SessionState(descriptor, doFetch, now, refreshSkewMs);
  await state.load();

  // §3.1/§2.5 ruling b: Google 2D attribution is ALWAYS dynamic (per-viewport copyright) — hardcoded here.
  const basemap: BasemapSpec = {
    kind: "raster-source",
    source: {
      id: sourceId,
      imageryType: "provider-2d",
      attribution: { mode: "dynamic" },
      policy: "live-embed-only",
    },
  };

  // The tile URL prefix (everything before `{z}`) identifies the tiles this adapter must sign per-request.
  const tilePrefix = TILE_URL_TEMPLATE_BASE.split("{z}")[0] ?? TILE_URL_TEMPLATE_BASE;

  const transformRequest: TileRequestTransform = (url) => {
    if (!url.startsWith(tilePrefix)) return undefined; // not a provider tile — leave untouched
    const creds = state.current();
    // fire-and-forget; swallow a failed re-mint (e.g. 429 quota) so it is not an unhandled rejection —
    // the current session stays valid until its expiry, and a truly dead session surfaces as tile errors
    // (MapLibre → the mount's onError), not here.
    state.refreshIfStale()?.catch(() => {});
    const separator = url.includes("?") ? "&" : "?";
    return { url: `${url}${separator}session=${encodeURIComponent(creds.session)}&key=${encodeURIComponent(creds.key)}` };
  };

  // Always attaches the dynamic attributionResolver (§3.1 ruling b) — the ONLY attribution source now that
  // the descriptor carries none (P1.4: this resolver is the crux of the DOM-visible per-viewport copyright).
  const resolveRasterSource = (_source: RasterSource): ResolvedRasterSource => {
    const session = state.session();
    return {
      tileUrlTemplateBase: TILE_URL_TEMPLATE_BASE,
      tileSize: { width: session.tileWidth, height: session.tileHeight },
      imageFormat: session.imageFormat,
      attributionResolver: (viewport: GeoViewport) =>
        resolveViewportCopyright(viewportInfoUrl, state, doFetch, viewport),
    };
  };

  return { basemap, resolveRasterSource, options: { transformRequest } };
}

/** Fetches the flag-gated public descriptor (no-store). A non-2xx (503 pre-GO / key-absent) throws a `.kind`-tagged error. */
async function fetchDescriptor(doFetch: typeof fetch, mintUrl: string): Promise<BasemapDescriptor> {
  const response = await doFetch(mintUrl, { cache: "no-store" });
  if (!response.ok) {
    throw taggedError(`descriptor ${response.status}`, response.status);
  }
  const body = (await response.json()) as Partial<BasemapDescriptor>;
  if (!body.key || !body.mapType) {
    throw taggedError("descriptor: no key/mapType", undefined);
  }
  return body as BasemapDescriptor;
}

/**
 * Holds the descriptor (key + createSession params, fetched once) and the current Google session, and
 * refreshes the session client-side before expiry (single-flight). The key + session never leave this
 * object un-injected.
 */
class SessionState {
  #session: GoogleSession | undefined;
  #expiresAtMs = 0;
  #refreshing: Promise<GoogleSession> | undefined;
  readonly #descriptor: BasemapDescriptor;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #refreshSkewMs: number;

  constructor(descriptor: BasemapDescriptor, doFetch: typeof fetch, now: () => number, refreshSkewMs: number) {
    this.#descriptor = descriptor;
    this.#fetch = doFetch;
    this.#now = now;
    this.#refreshSkewMs = refreshSkewMs;
  }

  async load(): Promise<GoogleSession> {
    const session = await this.#createSession();
    this.#session = session;
    // Google Map Tiles `expiry` is an ABSOLUTE epoch-seconds value — not a duration from now.
    this.#expiresAtMs = session.expiryEpochSeconds * 1000;
    return session;
  }

  session(): GoogleSession {
    if (!this.#session) throw new Error("Google2dBasemapAdapter: session not minted");
    return this.#session;
  }

  current(): { session: string; key: string } {
    return { session: this.session().session, key: this.#descriptor.key };
  }

  /** Kicks off a single-flight refresh when within the skew window of expiry; returns immediately otherwise. */
  refreshIfStale(): Promise<GoogleSession> | undefined {
    if (this.#refreshing) return this.#refreshing;
    if (this.#now() < this.#expiresAtMs - this.#refreshSkewMs) return undefined;
    this.#refreshing = this.load().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  /** Mints a Google session CLIENT-SIDE with the descriptor's restricted key + params. */
  async #createSession(): Promise<GoogleSession> {
    const d = this.#descriptor;
    // Call via a local (not `this.#fetch(...)`) so the receiver is never this SessionState instance —
    // the native fetch requires a global receiver (see the bind at the adapter capture).
    const doFetch = this.#fetch;
    const response = await doFetch(`${CREATE_SESSION_URL}?key=${encodeURIComponent(d.key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mapType: d.mapType,
        ...(d.language ? { language: d.language } : {}),
        ...(d.region ? { region: d.region } : {}),
      }),
    });
    if (!response.ok) {
      throw taggedError(`createSession ${response.status}`, response.status);
    }
    const body = (await response.json()) as {
      session?: string;
      expiry?: string;
      tileWidth?: number;
      tileHeight?: number;
      imageFormat?: string;
    };
    if (!body.session || !body.expiry) {
      throw taggedError("createSession: no session/expiry", undefined);
    }
    return {
      session: body.session,
      expiryEpochSeconds: Number(body.expiry),
      tileWidth: body.tileWidth ?? 256,
      tileHeight: body.tileHeight ?? 256,
      imageFormat: body.imageFormat ?? "png",
    };
  }
}

/**
 * Fetches the DYNAMIC per-viewport copyright from Google's viewport-info endpoint (FREE / non-billable —
 * budget-flag: only the 3 tile SKUs are billed). The bbox is APPROXIMATED from center+zoom (the engine's
 * `GeoViewport` carries no pixel extent); coarse but sufficient for the region-scale copyright string. A
 * failure throws a `.kind`-tagged error so the engine maps it onto `onError` (§2.4).
 */
async function resolveViewportCopyright(
  viewportInfoUrl: string,
  state: SessionState,
  doFetch: typeof fetch,
  viewport: GeoViewport,
): Promise<string> {
  const { session, key } = state.current();
  const bounds = approxBounds(viewport);
  const params = new URLSearchParams({
    session,
    key,
    zoom: String(Math.round(viewport.zoom)),
    north: String(bounds.north),
    south: String(bounds.south),
    east: String(bounds.east),
    west: String(bounds.west),
  });
  const response = await doFetch(`${viewportInfoUrl}?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw taggedError(`viewport-info ${response.status}`, response.status);
  }
  const body = (await response.json()) as { copyright?: unknown };
  if (typeof body.copyright !== "string" || body.copyright.trim().length === 0) {
    throw taggedError("viewport-info: no copyright", undefined);
  }
  return body.copyright;
}

/** Coarse Web-Mercator half-span from center+zoom for a nominal viewport (documented approximation). */
function approxBounds(viewport: GeoViewport): { north: number; south: number; east: number; west: number } {
  const halfLng = 360 / Math.pow(2, viewport.zoom);
  const halfLat = halfLng / 2;
  const [lng, lat] = viewport.center;
  return {
    north: Math.min(85, lat + halfLat),
    south: Math.max(-85, lat - halfLat),
    east: lng + halfLng,
    west: lng - halfLng,
  };
}

/** Tags an error with a `GeoMapError` kind so the controller's `classifyResolverError` can map it (§2.4). */
function taggedError(message: string, status: number | undefined): Error & { kind: string } {
  const kind =
    status === 401 || status === 403 ? "forbidden"
      : status === 429 ? "quota"
        : status === 404 ? "session-expired"
          : "network";
  return Object.assign(new Error(message), { kind });
}
