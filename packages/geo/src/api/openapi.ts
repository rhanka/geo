/**
 * Minimal OpenAPI 3.0 document describing the OGC API – Features endpoints this
 * server exposes. Generated dynamically so the server URL reflects the request.
 */

/** Opt-in rounding of served coordinates (representation only; default = exact). */
const COORD_PRECISION_PARAM = {
  name: "coordPrecision",
  in: "query",
  schema: { type: "integer", minimum: 0, maximum: 15 },
  description:
    "Round x/y to this many decimals (6 = ~5 cm). Omit for exact geometry. Consecutive duplicate vertices created by the rounding are dropped; rings keep >= 4 positions.",
} as const;

/** Precompressed, versioned display mirror of a whole collection (SPEC_DISPLAY_MIRROR). */
const PROFILE_PARAM = {
  name: "profile",
  in: "query",
  schema: { type: "string", enum: ["display", "index"] },
  description:
    "Serve the collection's display mirror instead of the exact geometry, in one response. " +
    "`display`: geometry rounded to 6 decimals (7 or 8 when 6 would make a simple ring non-simple; exact as a last resort), properties verbatim. " +
    "`index`: `geometry: null`, exact `bbox` per feature, properties verbatim. " +
    "Not combinable with `bbox`, `offset` or `coordPrecision` (400). Response carries `ETag`, `X-Geo-Display-Profile`, `X-Geo-Display-Version` and, " +
    "when the source changed since the build, `X-Geo-Display-Stale: 1`. 503 `DisplayUnavailable` when the mirror cannot be built; never the exact geometry instead.",
} as const;

export function buildOpenApi(base: string): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "@sentropic/geo — OGC API – Features",
      version: "0.1.0",
      description:
        "OGC API – Features (Part 1: Core) server delivering administrative boundaries as GeoJSON.",
    },
    servers: [{ url: base }],
    paths: {
      "/": {
        get: {
          summary: "Landing page",
          operationId: "getLandingPage",
          responses: { "200": { description: "Links to API capabilities." } },
        },
      },
      "/conformance": {
        get: {
          summary: "Conformance declaration",
          operationId: "getConformance",
          responses: { "200": { description: "Conformance classes implemented." } },
        },
      },
      "/api": {
        get: {
          summary: "This OpenAPI document",
          operationId: "getApiDescription",
          responses: { "200": { description: "OpenAPI 3.0 description." } },
        },
      },
      "/sources": {
        get: {
          summary: "List the source catalog (inventory)",
          operationId: "getSources",
          parameters: [
            {
              name: "country",
              in: "query",
              schema: { type: "string" },
              description: "Filter by ISO 3166-1 alpha-2 country code (e.g. CA, FR).",
            },
            {
              name: "kind",
              in: "query",
              schema: { type: "string", enum: ["administrative", "statistical", "postal"] },
            },
          ],
          responses: { "200": { description: "The geo source inventory (jurisdiction, license, datasets)." } },
        },
      },
      "/sources/{sourceId}": {
        get: {
          summary: "Describe a source",
          operationId: "describeSource",
          parameters: [
            {
              name: "sourceId",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Source id; may contain a slash (e.g. ca-qc/sda), raw or percent-encoded.",
            },
          ],
          responses: {
            "200": { description: "The source entry with its datasets." },
            "404": { description: "Unknown source." },
          },
        },
      },
      "/collections": {
        get: {
          summary: "List collections",
          operationId: "getCollections",
          responses: { "200": { description: "The collections available." } },
        },
      },
      "/collections/{collectionId}": {
        get: {
          summary: "Describe a collection",
          operationId: "describeCollection",
          parameters: [
            { name: "collectionId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The collection." },
            "404": { description: "Unknown collection." },
          },
        },
      },
      "/collections/{collectionId}/items": {
        get: {
          summary: "Fetch features",
          operationId: "getFeatures",
          parameters: [
            { name: "collectionId", in: "path", required: true, schema: { type: "string" } },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 10000, default: 100 },
            },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
            {
              name: "bbox",
              in: "query",
              schema: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
              style: "form",
              explode: false,
              description: "minx,miny,maxx,maxy (WGS84)",
            },
            COORD_PRECISION_PARAM,
            PROFILE_PARAM,
          ],
          responses: {
            "200": { description: "A GeoJSON FeatureCollection." },
            "304": { description: "With `profile`: the If-None-Match ETag still matches the current mirror version." },
            "400": { description: "Invalid parameter (including `profile` combined with bbox/offset/coordPrecision)." },
            "404": { description: "Unknown collection." },
            "503": { description: "With `profile`: the display mirror could not be built or read (`DisplayUnavailable`)." },
          },
        },
      },
      "/collections/{collectionId}/items/{featureId}": {
        get: {
          summary: "Fetch a single feature",
          operationId: "getFeature",
          parameters: [
            { name: "collectionId", in: "path", required: true, schema: { type: "string" } },
            { name: "featureId", in: "path", required: true, schema: { type: "string" } },
            COORD_PRECISION_PARAM,
          ],
          responses: {
            "200": { description: "A GeoJSON Feature." },
            "404": { description: "Unknown collection or feature." },
          },
        },
      },
    },
  };
}
