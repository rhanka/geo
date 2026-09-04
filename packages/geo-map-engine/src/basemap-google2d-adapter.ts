/**
 * §5 Google Map Tiles 2D basemap adapter — FRAMEWORK-NEUTRAL (wp7/geo-socle, ADR-0025 / V2_BASEMAP_2D §2.5).
 *
 * The AGNOSTIC half of the §5 seam. It fetches the mint envelope (public descriptor + adapter-internal
 * session+key) from the geo-api `/basemap/2d/session` endpoint, then produces the three inputs the engine
 * `mount()` consumes:
 *   • `basemap`  — the v2 `raster-source` BasemapSpec (logical id + dynamic attribution + live-embed policy);
 *   • `resolveRasterSource` — resolves that id to the tile template base + tile size + `attributionResolver`;
 *   • `options.transformRequest` — the per-tile closure that injects `?session=&key=` (MapLibre passthrough).
 * A design-system wiring layer SPREADS these into `mount()` (ADR-0025 zero-copy) — it never re-implements
 * this logic and never reads the session/key.
 *
 * §3.3 NO-SECRET INVARIANT: the minted session + restricted key live SOLELY in the closures here
 * (`transformRequest` + `attributionResolver`). They are NEVER folded into the `BasemapSpec` or the
 * `ResolvedRasterSource` the engine sees. The endpoint serves the envelope `Cache-Control: no-store`, and
 * the tiles go browser→Google LIVE under the key's referrer restriction (live-embed-only, §3.2) — never
 * proxied/cached by geo infra.
 *
 * ACTIVATION-VALIDATED (like the whole of §5): the live Google calls (createSession behind the mint, tiles,
 * the viewport-info copyright) are exercised only once the owner GO flips the flag ON; pre-GO the endpoint is
 * 503 and this adapter never runs. Its LOGIC (envelope parse, session refresh, per-tile injection,
 * viewport-info request/parse) is unit-tested here via an injected `fetch`.
 */

import type { BasemapSpec, RasterSource } from "./basemap.js";
import type { ResolvedRasterSource } from "./surface.js";
import type { GeoViewport } from "./viewport.js";

/** The mint envelope wire shape (served by `packages/geo`). Declared LOCALLY so the engine keeps zero dep on it. */
interface MintEnvelope {
  readonly source: {
    readonly tileUrlTemplateBase: string;
    readonly tileSize: { readonly width: number; readonly height: number };
    readonly imageFormat: string;
    readonly attribution: { readonly mode: "static"; readonly text: string } | { readonly mode: "dynamic" };
  };
  readonly session: {
    readonly session: string;
    readonly expirySeconds: number;
    readonly key: string;
  };
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
  /** The geo-api mint endpoint (e.g. `/basemap/2d/session`), absolute or same-origin relative. */
  readonly mintUrl: string;
  /** Logical source id carried by the BasemapSpec (default `google-2d`). */
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

const DEFAULT_SOURCE_ID = "google-2d";
const DEFAULT_VIEWPORT_INFO_URL = "https://tile.googleapis.com/tile/v1/viewport";
const DEFAULT_REFRESH_SKEW_SECONDS = 300;

/**
 * Builds the §5 Google-2D adapter. ASYNC because it fetches the initial mint envelope up front, so the
 * per-tile `transformRequest` (which MapLibre calls SYNCHRONOUSLY) always has a live session/key to inject;
 * it refreshes in the background before expiry.
 */
export async function createGoogle2dBasemapAdapter(
  options: Google2dBasemapAdapterOptions,
): Promise<Google2dBasemapAdapter> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sourceId = options.sourceId ?? DEFAULT_SOURCE_ID;
  const viewportInfoUrl = options.viewportInfoUrl ?? DEFAULT_VIEWPORT_INFO_URL;
  const refreshSkewMs = (options.refreshSkewSeconds ?? DEFAULT_REFRESH_SKEW_SECONDS) * 1000;

  const state = new SessionState(options.mintUrl, doFetch, now, refreshSkewMs);
  const initial = await state.load();

  // The tile URL prefix (everything before `{z}`) identifies the tiles this adapter must sign per-request.
  const templateBase = initial.source.tileUrlTemplateBase;
  const tilePrefix = templateBase.split("{z}")[0] ?? templateBase;

  const basemap: BasemapSpec = {
    kind: "raster-source",
    source: {
      id: sourceId,
      imageryType: "provider-2d",
      attribution: initial.source.attribution.mode === "static"
        ? { mode: "static", text: initial.source.attribution.text }
        : { mode: "dynamic" },
      policy: "live-embed-only",
    },
  };

  const transformRequest: TileRequestTransform = (url) => {
    if (!url.startsWith(tilePrefix)) return undefined; // not a provider tile — leave untouched
    const creds = state.current();
    void state.refreshIfStale(); // fire-and-forget; the current session is still valid until its expiry
    const separator = url.includes("?") ? "&" : "?";
    return { url: `${url}${separator}session=${encodeURIComponent(creds.session)}&key=${encodeURIComponent(creds.key)}` };
  };

  const resolveRasterSource = (_source: RasterSource): ResolvedRasterSource => {
    const envelope = state.envelope();
    const base: ResolvedRasterSource = {
      tileUrlTemplateBase: envelope.source.tileUrlTemplateBase,
      tileSize: envelope.source.tileSize,
      imageFormat: envelope.source.imageFormat,
    };
    if (envelope.source.attribution.mode !== "dynamic") return base;
    return {
      ...base,
      attributionResolver: (viewport: GeoViewport) =>
        resolveViewportCopyright(viewportInfoUrl, state, doFetch, viewport),
    };
  };

  return { basemap, resolveRasterSource, options: { transformRequest } };
}

/** Holds the current mint envelope + single-flight refresh (session/key never leave this object un-injected). */
class SessionState {
  #envelope: MintEnvelope | undefined;
  #expiresAtMs = 0;
  #refreshing: Promise<MintEnvelope> | undefined;
  readonly #mintUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #refreshSkewMs: number;

  constructor(mintUrl: string, doFetch: typeof fetch, now: () => number, refreshSkewMs: number) {
    this.#mintUrl = mintUrl;
    this.#fetch = doFetch;
    this.#now = now;
    this.#refreshSkewMs = refreshSkewMs;
  }

  async load(): Promise<MintEnvelope> {
    const envelope = await this.#fetchEnvelope();
    this.#envelope = envelope;
    this.#expiresAtMs = this.#now() + envelope.session.expirySeconds * 1000;
    return envelope;
  }

  envelope(): MintEnvelope {
    if (!this.#envelope) throw new Error("Google2dBasemapAdapter: mint envelope not loaded");
    return this.#envelope;
  }

  current(): { session: string; key: string } {
    const envelope = this.envelope();
    return { session: envelope.session.session, key: envelope.session.key };
  }

  /** Kicks off a single-flight refresh when within the skew window of expiry; returns immediately otherwise. */
  refreshIfStale(): Promise<MintEnvelope> | undefined {
    if (this.#refreshing) return this.#refreshing;
    if (this.#now() < this.#expiresAtMs - this.#refreshSkewMs) return undefined;
    this.#refreshing = this.load().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  async #fetchEnvelope(): Promise<MintEnvelope> {
    const response = await this.#fetch(this.#mintUrl, { cache: "no-store" });
    if (!response.ok) {
      throw taggedError(`mint ${response.status}`, response.status);
    }
    return (await response.json()) as MintEnvelope;
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
