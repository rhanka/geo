/**
 * Catalog source for geo.sent-tech.ca.
 *
 * The catalogue is obtained by reading the OGC API – Features endpoint
 * (`GET {API}/collections`) at build/runtime. `API` comes from the
 * `PUBLIC_GEO_API_URL` env var (default `http://localhost:8787`). When the API
 * is unreachable — typically at build time, before any live deployment — we
 * fall back to a bundled static snapshot (`collections.fallback.json`) so the
 * pages still render. Nothing here ever throws on a network failure.
 */

import { env } from "$env/dynamic/public";
import { LICENSES, resolveLicense, type License } from "@sentropic/geo-core";
import fallbackCollections from "./collections.fallback.json";

/** Default OGC API base URL when `PUBLIC_GEO_API_URL` is not set. */
export const DEFAULT_API_URL = "http://localhost:8787";

/** Public OGC API base URL (no trailing slash). */
export function apiBaseUrl(): string {
  const raw = env.PUBLIC_GEO_API_URL ?? DEFAULT_API_URL;
  return raw.replace(/\/+$/, "");
}

/** OGC link object (subset we care about). */
interface OgcLink {
  href: string;
  rel: string;
  type?: string;
  title?: string;
}

/** OGC collection object, as rendered by `@sentropic/geo-api`. */
interface OgcCollection {
  id: string;
  title: string;
  description?: string;
  attribution?: string;
  extent?: { spatial?: { bbox?: number[][]; crs?: string } };
  crs?: string[];
  storageCrs?: string;
  license?: { title?: string; href?: string };
  links?: OgcLink[];
}

/** OGC `GET /collections` response envelope. */
interface OgcCollections {
  links?: OgcLink[];
  collections?: OgcCollection[];
}

/** A catalog entry, ready to feed `DatasetCatalog` / the dataset page. */
export interface CatalogEntry {
  /** Stable OGC collection id (e.g. `qc-regions`). */
  id: string;
  title: string;
  /** Resolved license (carries redistributable / attribution flags). */
  license: License;
  /** Ready-to-display attribution line. */
  attribution: string;
  /** Feature count when known (0 otherwise — OGC `/collections` omits it). */
  count: number;
  /** Optional human description. */
  description?: string;
  /** Absolute URL of the collection's `items` (GeoJSON) endpoint. */
  itemsUrl: string;
  /** Bounding box `[w, s, e, n]` when advertised by the API. */
  bbox?: [number, number, number, number];
}

function itemsUrlFor(collection: OgcCollection, base: string): string {
  const itemsLink = collection.links?.find((l) => l.rel === "items");
  if (itemsLink?.href) return itemsLink.href;
  return `${base}/collections/${encodeURIComponent(collection.id)}/items`;
}

/**
 * Default page size requested from the OGC `/items` endpoint. The OGC API caps
 * an unparametrized `/items` at 100 features (silent truncation); passing an
 * explicit large `limit` returns the whole collection in one request. Per
 * ADR-0015, dense-layer transport (vector tiles / PMTiles) is a later increment.
 */
export const DEFAULT_ITEMS_LIMIT = 2000;

/**
 * Add an explicit `?limit=` to an `/items` URL so the dataset is not silently
 * truncated to the OGC default of 100 features (ADR-0015). Idempotent: an
 * already-present `limit` is left untouched.
 */
export function itemsUrlWithLimit(
  itemsUrl: string,
  limit: number = DEFAULT_ITEMS_LIMIT,
): string {
  try {
    const url = new URL(itemsUrl);
    if (!url.searchParams.has("limit")) {
      url.searchParams.set("limit", String(limit));
    }
    return url.toString();
  } catch {
    // Relative or malformed URL: append conservatively.
    if (/[?&]limit=/.test(itemsUrl)) return itemsUrl;
    const sep = itemsUrl.includes("?") ? "&" : "?";
    return `${itemsUrl}${sep}limit=${limit}`;
  }
}

function bboxOf(collection: OgcCollection): [number, number, number, number] | undefined {
  const raw = collection.extent?.spatial?.bbox?.[0];
  if (raw && raw.length >= 4) {
    return [raw[0], raw[1], raw[2], raw[3]];
  }
  return undefined;
}

/**
 * Resolve an OGC `license` block back to a known geo-core {@link License}. The
 * OGC object carries a human `title` and an `href`; we match the href against
 * the canonical license URLs first, then fall back to {@link resolveLicense}
 * (which understands ids/aliases). Unknown licenses degrade to `unknown`.
 */
function resolveOgcLicense(lic: OgcCollection["license"]): License {
  if (!lic) return resolveLicense(undefined);
  if (lic.href) {
    const byUrl = Object.values(LICENSES).find((l) => l.url === lic.href);
    if (byUrl) return byUrl;
  }
  return resolveLicense(lic.title ?? lic.href);
}

/**
 * Map an OGC collection to a {@link CatalogEntry}, resolving its license via the
 * geo-core license model. An absent or unrecognized license degrades to
 * `unknown` (conservatively non-redistributable).
 */
function toCatalogEntry(collection: OgcCollection, base: string): CatalogEntry {
  const license = resolveOgcLicense(collection.license);
  const attribution =
    collection.attribution ??
    (license.attributionRequired ? license.title : collection.title);
  const box = bboxOf(collection);

  return {
    id: collection.id,
    title: collection.title,
    license,
    attribution,
    count: 0,
    ...(collection.description !== undefined ? { description: collection.description } : {}),
    itemsUrl: itemsUrlFor(collection, base),
    ...(box ? { bbox: box } : {}),
  };
}

function parseCollections(value: unknown, base: string): CatalogEntry[] {
  const envelope = value as OgcCollections | undefined;
  if (!envelope || !Array.isArray(envelope.collections)) return [];
  return envelope.collections
    .filter((c): c is OgcCollection => Boolean(c && typeof c.id === "string"))
    .map((c) => toCatalogEntry(c, base));
}

/** The bundled static fallback catalog (used when the API is unreachable). */
export function fallbackCatalog(): CatalogEntry[] {
  return parseCollections(fallbackCollections, apiBaseUrl());
}

/**
 * Load the catalog from the OGC API, falling back to the static snapshot when
 * the API is unreachable or returns nothing usable. Never throws.
 *
 * @param fetchFn SvelteKit's `fetch` (passed from a `load` function).
 */
export async function loadCatalog(
  fetchFn: typeof fetch = fetch,
): Promise<{ datasets: CatalogEntry[]; source: "api" | "fallback" }> {
  const base = apiBaseUrl();
  try {
    const res = await fetchFn(`${base}/collections`, {
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const json: unknown = await res.json();
      const datasets = parseCollections(json, base);
      if (datasets.length > 0) {
        return { datasets, source: "api" };
      }
    }
  } catch {
    // Unreachable API (build time / offline): fall through to the snapshot.
  }
  return { datasets: fallbackCatalog(), source: "fallback" };
}

/** Look up a single catalog entry by id, from API then fallback. */
export async function loadCatalogEntry(
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<CatalogEntry | undefined> {
  const { datasets } = await loadCatalog(fetchFn);
  const found = datasets.find((d) => d.id === id);
  if (found) return found;
  return fallbackCatalog().find((d) => d.id === id);
}
