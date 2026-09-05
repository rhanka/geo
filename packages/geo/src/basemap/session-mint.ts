/**
 * §5 basemap adapter — restricted key read + createSession params (CLIENT-MINT seam, geo-archi §3.3).
 *
 * The §5 Google Map Tiles mint runs CLIENT-SIDE: the browser calls Google `createSession` with the
 * referrer-restricted key (a server-side call with such a key would be a Referer spoof, forbidden; the
 * serving netpol blocks geo-api→Google anyway). So geo-api does NOT mint — the Google `createSession` call
 * and the session cache/refresh live in the ENGINE adapter (packages/geo-map-engine,
 * basemap-google2d-adapter.ts). This module only:
 *   • reads the restricted key fail-closed ({@link readTileKey}), and
 *   • carries the createSession params type ({@link CreateSessionOptions}),
 * both served in the public descriptor by endpoint.ts (`{ key, mapType, language?, region? }`).
 */

/** The Google `createSession` params carried in the public descriptor (the browser POSTs them to Google). */
export interface CreateSessionOptions {
  readonly mapType: "satellite" | "roadmap" | "terrain";
  readonly language?: string;
  readonly region?: string;
}

/**
 * Read the restricted Map Tiles key. FAIL-CLOSED: an absent/empty key throws — never a default or empty
 * key. The key lives only in the adapter's environment (mounted from the k8s secret at deploy); the
 * descriptor endpoint serves it `Cache-Control: no-store` to the single scoped origin (browser use only,
 * under the key's referrer restriction).
 */
export function readTileKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = (env.GOOGLE_TILE_KEY ?? "").trim();
  if (!key) {
    throw new Error("basemap-adapter: GOOGLE_TILE_KEY absent — refus (jamais de clé par défaut/vide)");
  }
  return key;
}
