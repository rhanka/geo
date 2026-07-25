/**
 * Generic **CKAN open-data adapter** for discovering and acquiring zonage (and
 * other geographic) datasets published on CKAN portals such as
 * Données Québec (`https://www.donneesquebec.ca`).
 *
 * ## Why CKAN?
 * An estimated 10–15 Québec municipalities publish their zonage layer as
 * open data on Données Québec (cadrage zones+lots §1.3, count verified
 * 2026-06-14: `package_search?q=zonage&rows=0` → 50 packages). This adapter
 * is the generic acquisition primitive that turns those CKAN packages into
 * WGS84 GeoJSON FeatureCollections ready for downstream normalisation.
 *
 * ## Non-GeoJSON formats (SHP, GPKG, KML, FGDB)
 * `resolveGeoResources` detects all downloadable geographic resource formats.
 * Only GeoJSON (and its alias `geojson`) is acquired inline here — the other
 * formats return a resolved resource with `needsGdal: true`.  Callers should
 * pipe those to `extractLayerToGeoJson` from `@sentropic/geo-acquire/gdal`.
 * This limitation is intentional: GDAL import in Node is an optional, heavy
 * dependency (ADR-0007: keep acquisition primitives dependency-free and
 * hermetically testable).
 *
 * ## Hermeticity (ADR-0007)
 * `fetchImpl` (defaults to global `fetch`) and `now` (defaults to
 * `() => new Date()`) are injectable so tests never touch the network or the
 * real clock.
 *
 * ## API shape (Données Québec / standard CKAN 3 action API)
 * - Base URL: `https://www.donneesquebec.ca/recherche/api/3/action/`
 * - `package_search?q=<query>&rows=<n>&start=<offset>` → `{ result: { results: CkanPackage[] } }`
 * - `package_show?id=<id>` → `{ result: CkanPackage }`
 */

import type { FeatureCollection, Geometry } from "@sentropic/geo-core";
import { isFeatureCollection } from "@sentropic/geo-core";

// ── CKAN domain types ─────────────────────────────────────────────────────────

/** A CKAN resource within a package (condensed to the fields we use). */
export interface CkanResource {
  /** Unique resource id. */
  readonly id: string;
  /** Human-readable name/title. */
  readonly name: string;
  /** Format string as declared by the publisher (e.g. `"GeoJSON"`, `"SHP"`, `"KML"`). */
  readonly format: string;
  /** Direct download URL. */
  readonly url: string;
  /** Optional resource description. */
  readonly description?: string;
}

/** A CKAN package (dataset) with just the fields we expose to callers. */
export interface CkanPackage {
  /** Package id (slug, e.g. `"zonage-ville-de-longueuil"`). */
  readonly id: string;
  /** Human-readable title. */
  readonly title: string;
  /** Organization name, when present. */
  readonly organization?: string;
  /** All resources attached to the package. */
  readonly resources: readonly CkanResource[];
}

// ── Resolved geo resource ─────────────────────────────────────────────────────

/** A geographic resource resolved from a CKAN package, ready for acquisition. */
export interface ResolvedGeoResource {
  /** Package the resource belongs to. */
  readonly packageId: string;
  /** Resource id. */
  readonly resourceId: string;
  /** Normalised format (lowercase). */
  readonly format: GeoResourceFormat;
  /** Direct download URL. */
  readonly url: string;
  /** Human-readable resource name. */
  readonly name: string;
  /**
   * When `true`, this format requires an external conversion step (GDAL/ogr2ogr)
   * before a GeoJSON FeatureCollection can be produced. Only `"geojson"` resources
   * have `needsGdal: false` and are directly acquirable via {@link acquireCkanGeoJson}.
   */
  readonly needsGdal: boolean;
}

/** Geographic format identifiers, normalised to lowercase. */
export type GeoResourceFormat = "geojson" | "shp" | "kml" | "gpkg" | "fgdb" | "other";

// ── Acquired GeoJSON result ───────────────────────────────────────────────────

/** Provenance attached to every acquired GeoJSON resource (parallel to ArcgisCrawlProvenance). */
export interface CkanGeoJsonProvenance {
  /** Source CKAN package id. */
  readonly source: string;
  /** Direct resource URL that was fetched. */
  readonly url: string;
  /** ISO 8601 timestamp of the fetch. */
  readonly fetchedAt: string;
}

/** Result of {@link acquireCkanGeoJson}: the WGS84 FeatureCollection plus provenance. */
export interface CkanGeoJsonResult {
  readonly collection: FeatureCollection<Geometry | null>;
  readonly provenance: CkanGeoJsonProvenance;
}

// ── Options ───────────────────────────────────────────────────────────────────

/** Shared injectable dependencies (hermeticity, ADR-0007). */
interface InjectableOpts {
  /**
   * Injected fetch implementation. Defaults to the global `fetch`.
   * Tests MUST inject a mock — no real network allowed (ADR-0007).
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * Injected clock for provenance timestamps. Defaults to `() => new Date()`.
   * Tests inject a fixed clock so assertions are deterministic.
   */
  readonly now?: () => Date;
}

/** Options for {@link searchCkanPackages}. */
export interface SearchCkanPackagesOptions extends InjectableOpts {
  /** Maximum number of packages to return (CKAN `rows`). Defaults to `10`. */
  readonly rows?: number;
  /** Offset for paginating through results (CKAN `start`). Defaults to `0`. */
  readonly start?: number;
}

/** Options for {@link acquireCkanGeoJson}. */
export interface AcquireCkanGeoJsonOptions extends InjectableOpts {
  /**
   * Package id used to populate `provenance.source`. If omitted, the resource
   * URL is used as the source identifier.
   */
  readonly packageId?: string;
  /** Extra request headers forwarded on the resource download. */
  readonly headers?: Record<string, string>;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Set of lowercase format strings recognised as GeoJSON. */
const GEOJSON_FORMATS = new Set(["geojson", "geo+json", "application/geo+json"]);

/** Set of lowercase format strings that need GDAL for conversion. */
const GDAL_FORMATS = new Set(["shp", "shapefile", "kml", "gpkg", "geopackage", "fgdb", "filegdb"]);

/** Normalise a raw CKAN format string to our {@link GeoResourceFormat}. */
function normaliseFormat(raw: string): GeoResourceFormat {
  const lower = raw.toLowerCase().trim();
  if (GEOJSON_FORMATS.has(lower)) return "geojson";
  if (lower === "shp" || lower === "shapefile") return "shp";
  if (lower === "kml") return "kml";
  if (lower === "gpkg" || lower === "geopackage") return "gpkg";
  if (lower === "fgdb" || lower === "filegdb" || lower === "esri geodatabase") return "fgdb";
  // Catch common aliases we may not have listed above.
  if (GDAL_FORMATS.has(lower)) return "shp"; // conservative fallback for unknown GDAL types
  return "other";
}

/** Geographic formats we surface to callers (non-geographic formats are filtered out). */
const GEO_FORMAT_SET: ReadonlySet<GeoResourceFormat> = new Set<GeoResourceFormat>([
  "geojson",
  "shp",
  "kml",
  "gpkg",
  "fgdb",
]);

/**
 * Parse a raw CKAN API response body as JSON, with a clear error on failure.
 */
async function parseApiJson(response: Response, url: string): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`ckan: failed to parse JSON from ${url}`, { cause });
  }
}

/**
 * Coerce an unknown value into a `string`, returning `""` on failure.
 * Satisfies `noUncheckedIndexedAccess` without casting everywhere.
 */
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Extract a {@link CkanResource} array from a raw CKAN package object. */
function parseResources(raw: Record<string, unknown>): CkanResource[] {
  const arr = raw["resources"];
  if (!Array.isArray(arr)) return [];
  const result: CkanResource[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const id = asString(r["id"]);
    const url = asString(r["url"]);
    const format = asString(r["format"]);
    if (!id || !url) continue; // skip malformed resources
    const resource: CkanResource = {
      id,
      name: asString(r["name"]) || id,
      format,
      url,
    };
    const desc = r["description"];
    if (typeof desc === "string" && desc.length > 0) {
      // exactOptionalPropertyTypes: assign only when defined
      result.push({ ...resource, description: desc });
    } else {
      result.push(resource);
    }
  }
  return result;
}

/** Extract a {@link CkanPackage} from a raw CKAN result object. */
function parsePackage(raw: Record<string, unknown>): CkanPackage {
  const orgRaw = raw["organization"];
  const orgName =
    typeof orgRaw === "object" && orgRaw !== null
      ? asString((orgRaw as Record<string, unknown>)["title"]) ||
        asString((orgRaw as Record<string, unknown>)["name"])
      : asString(orgRaw);

  const pkg: CkanPackage = {
    id: asString(raw["id"]) || asString(raw["name"]),
    title: asString(raw["title"]) || asString(raw["name"]),
    resources: parseResources(raw),
  };
  if (orgName) {
    return { ...pkg, organization: orgName };
  }
  return pkg;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Search for CKAN packages on a given portal.
 *
 * Calls `<baseUrl>/package_search?q=<query>&rows=<rows>&start=<start>` and
 * returns the list of matching packages with their resources summarised.
 *
 * @param baseUrl CKAN action API base URL, e.g.
 *   `https://www.donneesquebec.ca/recherche/api/3/action` (trailing slash optional).
 * @param query Search query string, e.g. `"zonage"`.
 * @param opts Pagination + hermeticity options.
 *
 * @example
 * ```ts
 * const pkgs = await searchCkanPackages(
 *   "https://www.donneesquebec.ca/recherche/api/3/action",
 *   "zonage",
 *   { rows: 20 },
 * );
 * ```
 */
export async function searchCkanPackages(
  baseUrl: string,
  query: string,
  opts: SearchCkanPackagesOptions = {},
): Promise<CkanPackage[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const rows = opts.rows ?? 10;
  const start = opts.start ?? 0;

  const base = baseUrl.replace(/\/$/, "");
  const url =
    `${base}/package_search` +
    `?q=${encodeURIComponent(query)}&rows=${rows}&start=${start}`;

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `ckan: package_search failed with HTTP ${response.status} ${response.statusText} for ${url}`,
    );
  }

  const raw = await parseApiJson(response, url);
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`ckan: unexpected response shape from ${url}`);
  }
  const envelope = raw as Record<string, unknown>;
  const result = envelope["result"];
  if (typeof result !== "object" || result === null) {
    return [];
  }
  const resultObj = result as Record<string, unknown>;
  const results = resultObj["results"];
  if (!Array.isArray(results)) return [];

  return results
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map(parsePackage);
}

/**
 * Filter a package's resources to the downloadable geographic ones.
 *
 * Resources with formats outside `{GeoJSON, SHP, KML, GPKG, FGDB}` (PDF, HTML,
 * WMS, CSV …) are dropped. The `needsGdal` flag is `true` for everything except
 * GeoJSON, signalling that the caller should route those through `ogr2ogr`
 * (see `extractLayerToGeoJson` in `@sentropic/geo/acquire`).
 *
 * @param pkg Package returned by {@link searchCkanPackages} or fetched via
 *   `package_show`.
 */
export function resolveGeoResources(pkg: CkanPackage): ResolvedGeoResource[] {
  const result: ResolvedGeoResource[] = [];
  for (const resource of pkg.resources) {
    const format = normaliseFormat(resource.format);
    if (!GEO_FORMAT_SET.has(format)) continue;
    result.push({
      packageId: pkg.id,
      resourceId: resource.id,
      format,
      url: resource.url,
      name: resource.name,
      needsGdal: format !== "geojson",
    });
  }
  return result;
}

/**
 * Download a CKAN GeoJSON resource and return a WGS84 `FeatureCollection` with
 * provenance.
 *
 * **Only GeoJSON resources** are handled here. For SHP/KML/GPKG/FGDB, route the
 * resolved resource to `extractLayerToGeoJson` from `@sentropic/geo/acquire`
 * (`needsGdal: true` on the {@link ResolvedGeoResource}). This keeps the CKAN
 * adapter dependency-free and hermetically testable (ADR-0007).
 *
 * The function validates the response body is a GeoJSON FeatureCollection before
 * returning it — malformed or non-geographic responses throw.
 *
 * @param resourceUrl Direct download URL of the GeoJSON resource.
 * @param opts Hermeticity + provenance options.
 *
 * @throws {Error} If the HTTP response is not OK, or the body is not a GeoJSON
 *   FeatureCollection.
 */
export async function acquireCkanGeoJson(
  resourceUrl: string,
  opts: AcquireCkanGeoJsonOptions = {},
): Promise<CkanGeoJsonResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());

  const fetchedAt = now().toISOString();
  const source = opts.packageId ?? resourceUrl;

  const init = opts.headers ? { headers: opts.headers } : undefined;
  const response = await fetchImpl(resourceUrl, init);
  if (!response.ok) {
    throw new Error(
      `ckan: resource fetch failed with HTTP ${response.status} ${response.statusText} for ${resourceUrl}`,
    );
  }

  const text = await response.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new Error(`ckan: failed to parse GeoJSON body from ${resourceUrl}`, { cause });
  }

  if (!isFeatureCollection(raw)) {
    throw new Error(
      `ckan: expected a GeoJSON FeatureCollection from ${resourceUrl}, ` +
        `got ${raw === null ? "null" : typeof raw}.`,
    );
  }

  // The portal is expected to serve WGS84 (RFC 7946). No client reprojection is
  // performed here — callers must verify CRS if the source metadata is ambiguous.
  const collection: FeatureCollection<Geometry | null> = {
    type: "FeatureCollection",
    features: (raw as FeatureCollection<Geometry | null>).features,
  };

  return {
    collection,
    provenance: { source, url: resourceUrl, fetchedAt },
  };
}
