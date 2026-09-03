/**
 * §5 basemap adapter — Google Map Tiles 2D session mint (CONTRACT-INDEPENDENT CORE).
 *
 * The §5 Google-2D basemap serves via the Map Tiles session flow: a session is minted SERVER-SIDE
 * with the restricted API key, then the browser fetches tiles LIVE from Google (live-embed-only:
 * never proxied). This module owns the server-side half — read the key (fail-closed), call Google
 * `createSession`, and cache/refresh the session before expiry. The key is read ONCE and never
 * returned to callers here.
 *
 * ⚠ CONTRACT-HELD: how a minted session is SERIALISED to the front (a TokenMap extension vs a
 * separate SessionResolution input, and whether the key rides the browser tile URL under the
 * referrer restriction) is the geo-map-engine token contract — owned by the geo-map-engine lane
 * (TBD via geo-archi), frozen there, NOT decided here. This module exposes the minted session; the
 * HTTP endpoint + front serialisation land once that contract is frozen.
 */

/** Google `createSession` response (the fields we rely on). `expiry` is an epoch-seconds string. */
export interface GoogleSession {
  readonly session: string;
  readonly expirySeconds: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly imageFormat: string;
}

export interface CreateSessionOptions {
  readonly mapType: "satellite" | "roadmap" | "terrain";
  readonly language?: string;
  readonly region?: string;
  readonly layerTypes?: readonly string[];
}

const CREATE_SESSION_URL = "https://tile.googleapis.com/v1/createSession";
const DEFAULT_REFRESH_SKEW_SECONDS = 300; // re-mint 5 min before Google's expiry

/**
 * Read the restricted Map Tiles key. FAIL-CLOSED: an absent/empty key throws — never a default or
 * empty key (a silent empty key would call Google unauthenticated). The key lives only in the
 * adapter's environment (mounted from the k8s secret at deploy), never in the contract or the front.
 */
export function readTileKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = (env.GOOGLE_TILE_KEY ?? "").trim();
  if (!key) {
    throw new Error("basemap-adapter: GOOGLE_TILE_KEY absent — refus (jamais de clé par défaut/vide)");
  }
  return key;
}

/**
 * Call Google Map Tiles `createSession` with the key. `fetchFn` is injectable for tests. Throws
 * fail-loud on a non-2xx or a response missing `session`/`expiry` (never a silent partial session).
 */
export async function createSession(
  key: string,
  opts: CreateSessionOptions,
  fetchFn: typeof fetch = fetch,
): Promise<GoogleSession> {
  const res = await fetchFn(`${CREATE_SESSION_URL}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mapType: opts.mapType,
      language: opts.language ?? "en-US",
      region: opts.region ?? "US",
      ...(opts.layerTypes ? { layerTypes: opts.layerTypes } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`basemap-adapter: createSession HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as {
    session?: string;
    expiry?: string;
    tileWidth?: number;
    tileHeight?: number;
    imageFormat?: string;
  };
  if (!body.session || !body.expiry) {
    throw new Error("basemap-adapter: createSession sans session/expiry");
  }
  return {
    session: body.session,
    expirySeconds: Number(body.expiry),
    tileWidth: body.tileWidth ?? 256,
    tileHeight: body.tileHeight ?? 256,
    imageFormat: body.imageFormat ?? "png",
  };
}

/**
 * Caches a minted session and refreshes it before expiry (single-flight). The key is read ONCE at
 * construction and held privately — never returned. `now`/`fetchFn` injectable for tests.
 */
export class SessionMinter {
  #cached: GoogleSession | undefined;
  #inflight: Promise<GoogleSession> | undefined;
  readonly #key: string;
  readonly #opts: CreateSessionOptions;
  readonly #fetchFn: typeof fetch;
  readonly #skewSeconds: number;

  constructor(
    opts: CreateSessionOptions,
    deps: { key?: string; fetchFn?: typeof fetch; skewSeconds?: number } = {},
  ) {
    this.#key = deps.key ?? readTileKey();
    this.#opts = opts;
    this.#fetchFn = deps.fetchFn ?? fetch;
    this.#skewSeconds = deps.skewSeconds ?? DEFAULT_REFRESH_SKEW_SECONDS;
  }

  /** A valid session, re-minting when the cache is empty or within the refresh skew of expiry. */
  async get(nowSeconds: number = Math.floor(Date.now() / 1000)): Promise<GoogleSession> {
    if (this.#cached && this.#cached.expirySeconds - this.#skewSeconds > nowSeconds) {
      return this.#cached;
    }
    // Single-flight: concurrent callers during a refresh share one createSession call.
    if (!this.#inflight) {
      this.#inflight = createSession(this.#key, this.#opts, this.#fetchFn)
        .then((s) => {
          this.#cached = s;
          return s;
        })
        .finally(() => {
          this.#inflight = undefined;
        });
    }
    return this.#inflight;
  }
}
