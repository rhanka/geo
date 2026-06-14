/**
 * OGC API – Features (Part 1: Core) HTTP application, built with Hono.
 *
 * The app is fully decoupled from any datasource: it talks only to a
 * {@link FeatureProvider}. Construct it with `createApp(provider)` and either
 * `serve()` it (see `server.ts`) or drive it in tests via `app.request(...)`.
 *
 * Standards notes:
 *   - Feature and FeatureCollection responses use `application/geo+json`.
 *   - Links are absolute, derived from the incoming request URL.
 *   - Items responses carry the OGC members `numberMatched`, `numberReturned`,
 *     `timeStamp`, and `links`.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

import type { FeatureCollection, Geometry } from "@sentropic/geo-core";
import {
  allSources,
  byCountry,
  byKind,
  bySourceId,
  type InventoryEntry,
} from "@sentropic/geo-sources";

import { buildOpenApi } from "./openapi.js";
import {
  CONFORMANCE_CLASSES,
  MEDIA_GEOJSON,
  MEDIA_JSON,
  MEDIA_OPENAPI,
  baseUrlOf,
  renderCollection,
  type Link,
} from "./ogc.js";
import type { FeatureProvider, ItemsQuery, ServedFeature } from "./provider.js";

/** Default page size and the hard cap enforced on `?limit=`. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 10000;

/** Parse and clamp the `?limit=` query parameter. */
function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/** Parse the `?offset=` query parameter (non-negative integer). */
function parseOffset(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Parse a `?bbox=minx,miny,maxx,maxy` value into a 2D bbox tuple. Returns
 * `undefined` when absent, or `null` when present but malformed (so the caller
 * can answer 400).
 */
function parseBBox(
  raw: string | undefined,
): [number, number, number, number] | undefined | null {
  if (raw === undefined) return undefined;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

/** Construct the OGC API – Features app backed by the given provider. */
export function createApp(provider: FeatureProvider): Hono {
  const app = new Hono();

  // Public, read-only open-data API: allow any origin so the static site
  // (GitHub Pages geo.sent-tech.ca) and third-party consumers can fetch
  // cross-origin. No credentials are used, so a permissive policy is safe.
  app.use("*", cors());

  // ── Landing page ──────────────────────────────────────────────────────────
  app.get("/", (c) => {
    const base = baseUrlOf(c.req.url);
    const links: Link[] = [
      { href: `${base}/`, rel: "self", type: MEDIA_JSON, title: "This document" },
      {
        href: `${base}/api`,
        rel: "service-desc",
        type: MEDIA_OPENAPI,
        title: "API definition (OpenAPI 3.0)",
      },
      {
        href: `${base}/conformance`,
        rel: "conformance",
        type: MEDIA_JSON,
        title: "OGC API conformance classes",
      },
      {
        href: `${base}/collections`,
        rel: "data",
        type: MEDIA_JSON,
        title: "Feature collections",
      },
      {
        href: `${base}/sources`,
        rel: "related",
        type: MEDIA_JSON,
        title: "Source catalog (inventory)",
      },
    ];
    return c.json({
      title: "@sentropic/geo — OGC API – Features",
      description:
        "Administrative boundaries served as GeoJSON via OGC API – Features (Part 1: Core).",
      links,
    });
  });

  // ── Conformance ─────────────────────────────────────────────────────────────
  app.get("/conformance", (c) => c.json({ conformsTo: [...CONFORMANCE_CLASSES] }));

  // ── Source catalog (inventory) ───────────────────────────────────────────────
  // Distinct from the served `/collections`: this describes the upstream geo
  // sources (jurisdiction, license, attribution, datasets) from the typed
  // `@sentropic/geo-sources` INVENTORY, with optional `?country=`/`?kind=`
  // filters. Static metadata — no provider/datasource access.
  app.get("/sources", (c) => {
    const country = c.req.query("country");
    const kind = c.req.query("kind");
    let sources: InventoryEntry[] = country ? byCountry(country) : allSources();
    if (kind !== undefined) {
      const ofKind = new Set(byKind(kind as InventoryEntry["kind"]));
      sources = sources.filter((s) => ofKind.has(s));
    }
    return c.json({
      numberMatched: sources.length,
      numberReturned: sources.length,
      sources,
    });
  });

  // ── Single source ────────────────────────────────────────────────────────────
  // Source ids carry a slash (e.g. `ca-qc/sda`), so a single `:sourceId` param
  // can't capture them. A `{.+}` regex param matches the rest of the path,
  // accepting both raw (`/sources/ca-qc/sda`) and percent-encoded
  // (`/sources/ca-qc%2Fsda`) ids.
  app.get("/sources/:sourceId{.+}", (c) => {
    const id = decodeURIComponent(c.req.param("sourceId"));
    const source = bySourceId(id);
    if (!source) {
      return c.json({ code: "NotFound", description: `Unknown source: ${id}` }, 404);
    }
    return c.json(source);
  });

  // ── OpenAPI definition ───────────────────────────────────────────────────────
  app.get("/api", (c) => {
    const base = baseUrlOf(c.req.url);
    c.header("Content-Type", MEDIA_OPENAPI);
    return c.body(JSON.stringify(buildOpenApi(base)));
  });

  // ── Collections list ─────────────────────────────────────────────────────────
  app.get("/collections", async (c) => {
    const base = baseUrlOf(c.req.url);
    const infos = await provider.listCollections();
    const links: Link[] = [
      { href: `${base}/collections`, rel: "self", type: MEDIA_JSON, title: "Collections" },
    ];
    return c.json({
      links,
      collections: infos.map((info) => renderCollection(info, base)),
    });
  });

  // ── Single collection ────────────────────────────────────────────────────────
  app.get("/collections/:collectionId", async (c) => {
    const base = baseUrlOf(c.req.url);
    const id = c.req.param("collectionId");
    const info = await provider.getCollection(id);
    if (!info) return c.json({ code: "NotFound", description: `Unknown collection: ${id}` }, 404);
    return c.json(renderCollection(info, base));
  });

  // ── Items (features) ─────────────────────────────────────────────────────────
  app.get("/collections/:collectionId/items", async (c) => {
    const base = baseUrlOf(c.req.url);
    const id = c.req.param("collectionId");

    const bbox = parseBBox(c.req.query("bbox"));
    if (bbox === null) {
      return c.json(
        { code: "InvalidParameter", description: "bbox must be 'minx,miny,maxx,maxy'" },
        400,
      );
    }
    const limit = parseLimit(c.req.query("limit"));
    const offset = parseOffset(c.req.query("offset"));

    const query: ItemsQuery = { limit, offset, ...(bbox ? { bbox } : {}) };
    const result = await provider.getItems(id, query);
    if (!result) {
      return c.json({ code: "NotFound", description: `Unknown collection: ${id}` }, 404);
    }

    const selfUrl = new URL(c.req.url);
    const links: Link[] = [
      { href: selfUrl.toString(), rel: "self", type: MEDIA_GEOJSON, title: "This result" },
      {
        href: `${base}/collections/${encodeURIComponent(id)}`,
        rel: "collection",
        type: MEDIA_JSON,
        title: "The collection",
      },
    ];

    // `next` link when more features remain.
    if (offset + result.numberReturned < result.numberMatched) {
      const next = new URL(selfUrl.toString());
      next.searchParams.set("offset", String(offset + result.numberReturned));
      next.searchParams.set("limit", String(limit));
      links.push({ href: next.toString(), rel: "next", type: MEDIA_GEOJSON, title: "Next page" });
    }

    const body: FeatureCollection<Geometry | null> & {
      numberMatched: number;
      numberReturned: number;
      timeStamp: string;
      links: Link[];
    } = {
      type: "FeatureCollection",
      features: result.features,
      numberMatched: result.numberMatched,
      numberReturned: result.numberReturned,
      timeStamp: new Date().toISOString(),
      links,
    };

    c.header("Content-Type", MEDIA_GEOJSON);
    return c.body(JSON.stringify(body));
  });

  // ── Single feature ───────────────────────────────────────────────────────────
  app.get("/collections/:collectionId/items/:featureId", async (c) => {
    const base = baseUrlOf(c.req.url);
    const id = c.req.param("collectionId");
    const featureId = c.req.param("featureId");

    const feature = await provider.getItem(id, featureId);
    if (!feature) {
      return c.json(
        { code: "NotFound", description: `Unknown feature '${featureId}' in '${id}'` },
        404,
      );
    }

    const links: Link[] = [
      { href: new URL(c.req.url).toString(), rel: "self", type: MEDIA_GEOJSON, title: "This feature" },
      {
        href: `${base}/collections/${encodeURIComponent(id)}`,
        rel: "collection",
        type: MEDIA_JSON,
        title: "The collection",
      },
    ];

    const body: ServedFeature & { links: Link[] } = { ...feature, links };
    c.header("Content-Type", MEDIA_GEOJSON);
    return c.body(JSON.stringify(body));
  });

  return app;
}
