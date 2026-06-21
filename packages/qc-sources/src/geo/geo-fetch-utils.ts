/**
 * Utilitaires partagés pour les adapters d'acquisition géographique (P0).
 *
 * Réutilisés par :
 *   - CadastreAllegeAdapter (P0-A, lots province-entière)
 *   - ArcgisZonageAdapter   (P0-B, crawler ArcGIS REST générique)
 *
 * Conçu pour migration future vers @sentropic/geo (aucune dépendance immo).
 */

/** Type minimal de fetch (compatible globalThis.fetch + node-fetch + mocks de test). */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Type d'erreur (miroir de SourceFetchError existant dans avis-publics-valleyfield). */
export type GeoSourceErrorKind = "timeout" | "network" | "http" | "parse";

/**
 * Erreur typée pour les adapters géo — patron cohérent avec SourceFetchError
 * de avis-publics-valleyfield.ts (anti-invention : même convention, pas d'instanceof surprise).
 */
export class SourceFetchError extends Error {
  constructor(
    public readonly kind: GeoSourceErrorKind,
    message: string,
    public readonly url: string,
  ) {
    super(`[${kind}] ${message} (url: ${url})`);
    this.name = "SourceFetchError";
  }
}

/** User-agent honnête par convention du repo (rules/MASTER.md Scraping Policy). */
export const GEO_USER_AGENT =
  "radar-immobilier/0.1 (+https://github.com/rhanka/radar-immobilier)";

/** Timeout fetch par défaut pour les services géo publics (ms). */
export const GEO_FETCH_TIMEOUT_MS = 30_000;
