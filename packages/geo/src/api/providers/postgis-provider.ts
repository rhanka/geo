/**
 * PostGIS-backed {@link FeatureProvider} (V1 skeleton).
 *
 * Builds GeoJSON features straight from PostGIS using `ST_AsGeoJSON`. The class
 * is intentionally lightly exercised in V1: it must compile, be coherent, and —
 * importantly — never require a live database merely to be imported. A `pg.Pool`
 * is created lazily on first query, so constructing a `PostgisProvider` (e.g.
 * for wiring/DI) does not open a connection.
 *
 * SQL is kept deliberately simple. Each configured table is exposed as one
 * collection; geometries are assumed to be stored in WGS84 (EPSG:4326), as the
 * normalized pipeline guarantees.
 */

import { resolveLicense, type AdminFeature, type License } from "@sentropic/geo-core";

import { to2D, type BBox2D } from "../geo-util.js";
import type { CollectionInfo, FeatureProvider, ItemsQuery, ItemsResult } from "../provider.js";

// Type-only import so importing this module never loads the `pg` runtime.
import type { Pool, PoolConfig } from "pg";

/** How one collection maps onto a database table. */
export interface TableMapping {
  /** Collection id exposed by the API. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Optional description. */
  description?: string;
  /** Qualified table name (optionally schema-qualified, e.g. `public.regions`). */
  table: string;
  /** Geometry column (defaults to `geom`). */
  geomColumn?: string;
  /** Primary-key / feature-id column (defaults to `geo_id`). */
  idColumn?: string;
  /** License governing the table's data. */
  license?: License;
  /** Attribution string. */
  attribution?: string;
}

export interface PostgisProviderConfig {
  /** `pg.Pool` configuration (connection string or discrete fields). */
  pool: PoolConfig;
  /** One mapping per exposed collection. */
  tables: TableMapping[];
}

const DEFAULT_CRS_URI = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";

/** Quote a possibly schema-qualified SQL identifier (`schema.table` → `"schema"."table"`). */
function quoteIdent(name: string): string {
  return name
    .split(".")
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join(".");
}

export class PostgisProvider implements FeatureProvider {
  readonly #config: PostgisProviderConfig;
  readonly #tables: Map<string, TableMapping>;
  #pool: Pool | undefined;

  constructor(config: PostgisProviderConfig) {
    this.#config = config;
    this.#tables = new Map(config.tables.map((t) => [t.id, t]));
  }

  /**
   * Lazily create (and memoize) the connection pool. The `pg` module is loaded
   * here, on first query — never at import time — so the class can be imported
   * and constructed without a database present.
   */
  async #getPool(): Promise<Pool> {
    if (!this.#pool) {
      const { Pool: PgPool } = await import("pg");
      this.#pool = new PgPool(this.#config.pool);
    }
    return this.#pool;
  }

  /** Close the underlying pool, if one was opened. */
  async close(): Promise<void> {
    if (this.#pool) {
      await this.#pool.end();
      this.#pool = undefined;
    }
  }

  #infoFor(mapping: TableMapping, count: number, extent?: BBox2D): CollectionInfo {
    const license = resolveLicense(mapping.license);
    return {
      id: mapping.id,
      title: mapping.title,
      ...(mapping.description !== undefined ? { description: mapping.description } : {}),
      license,
      attribution: mapping.attribution ?? license.title,
      crs: DEFAULT_CRS_URI,
      count,
      ...(extent ? { extent: { bbox: extent } } : {}),
    };
  }

  async #describe(mapping: TableMapping): Promise<CollectionInfo> {
    const pool = await this.#getPool();
    const geom = quoteIdent(mapping.geomColumn ?? "geom");
    const table = quoteIdent(mapping.table);
    const { rows } = await pool.query<{ count: string; bbox: BBox2D | null }>(
      `SELECT count(*)::text AS count,
              CASE WHEN count(*) = 0 THEN NULL
                   ELSE ARRAY[
                     ST_XMin(ST_Extent(${geom})), ST_YMin(ST_Extent(${geom})),
                     ST_XMax(ST_Extent(${geom})), ST_YMax(ST_Extent(${geom}))
                   ] END AS bbox
       FROM ${table}`,
    );
    const row = rows[0];
    const count = row ? Number(row.count) : 0;
    const extent = row?.bbox ? to2D(row.bbox) : undefined;
    return this.#infoFor(mapping, count, extent);
  }

  async listCollections(): Promise<CollectionInfo[]> {
    return Promise.all(this.#config.tables.map((t) => this.#describe(t)));
  }

  async getCollection(id: string): Promise<CollectionInfo | undefined> {
    const mapping = this.#tables.get(id);
    if (!mapping) return undefined;
    return this.#describe(mapping);
  }

  async getItems(id: string, query: ItemsQuery): Promise<ItemsResult | undefined> {
    const mapping = this.#tables.get(id);
    if (!mapping) return undefined;

    const pool = await this.#getPool();
    const geom = quoteIdent(mapping.geomColumn ?? "geom");
    const idCol = quoteIdent(mapping.idColumn ?? "geo_id");
    const table = quoteIdent(mapping.table);

    const params: unknown[] = [];
    let where = "";
    if (query.bbox) {
      const [minx, miny, maxx, maxy] = query.bbox;
      params.push(minx, miny, maxx, maxy);
      where = `WHERE ${geom} && ST_MakeEnvelope($1, $2, $3, $4, 4326)`;
    }

    const limit = query.limit ?? null;
    const offset = query.offset ?? 0;

    // Total matches (ignoring paging) for `numberMatched`.
    const countResult = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${table} ${where}`,
      params,
    );
    const numberMatched = Number(countResult.rows[0]?.count ?? "0");

    const pageParams = [...params];
    let limitClause = "";
    if (limit !== null) {
      pageParams.push(limit);
      limitClause += ` LIMIT $${pageParams.length}`;
    }
    pageParams.push(offset);
    limitClause += ` OFFSET $${pageParams.length}`;

    // Build a GeoJSON Feature per row directly in SQL.
    const featureResult = await pool.query<{ feature: AdminFeature }>(
      `SELECT jsonb_build_object(
                'type', 'Feature',
                'id', ${idCol},
                'geometry', ST_AsGeoJSON(${geom})::jsonb,
                'properties', to_jsonb(t) - '${(mapping.geomColumn ?? "geom").replace(/'/g, "''")}'
              ) AS feature
       FROM ${table} t
       ${where}
       ORDER BY ${idCol}
       ${limitClause}`,
      pageParams,
    );
    const features = featureResult.rows.map((r) => r.feature);

    return { features, numberMatched, numberReturned: features.length };
  }

  async getItem(id: string, featureId: string): Promise<AdminFeature | undefined> {
    const mapping = this.#tables.get(id);
    if (!mapping) return undefined;

    const pool = await this.#getPool();
    const geom = quoteIdent(mapping.geomColumn ?? "geom");
    const idCol = quoteIdent(mapping.idColumn ?? "geo_id");
    const table = quoteIdent(mapping.table);

    const result = await pool.query<{ feature: AdminFeature }>(
      `SELECT jsonb_build_object(
                'type', 'Feature',
                'id', ${idCol},
                'geometry', ST_AsGeoJSON(${geom})::jsonb,
                'properties', to_jsonb(t) - '${(mapping.geomColumn ?? "geom").replace(/'/g, "''")}'
              ) AS feature
       FROM ${table} t
       WHERE ${idCol} = $1
       LIMIT 1`,
      [featureId],
    );
    return result.rows[0]?.feature;
  }
}
