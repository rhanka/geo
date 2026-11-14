/**
 * Response compression for the JSON/GeoJSON surface of the API.
 *
 * The OGC `/items` bodies are large (a city's lots: ~20 MB of GeoJSON) and
 * compress ~5x with Brotli. Hono's built-in `compress()` relies on the web
 * `CompressionStream` (gzip/deflate only), so this middleware uses `node:zlib`
 * to offer Brotli first, gzip second, and stays streaming: the body is piped
 * through the encoder, never buffered, and a client abort still cancels the
 * source (pipeThrough propagates the cancel upstream).
 *
 * Scope: GET/HEAD 200 responses whose Content-Type is JSON-family
 * (`application/json`, `application/geo+json`, the OpenAPI media type). Binary
 * bodies (PDF downloads) and already-encoded responses are left untouched.
 * Every JSON-family response carries `Vary: Accept-Encoding`, compressed or not,
 * so a shared cache never serves an encoded body to a client that did not ask.
 */

import { Duplex } from "node:stream";
import type { ReadableWritablePair } from "node:stream/web";
import { constants, createBrotliCompress, createGzip } from "node:zlib";

import type { MiddlewareHandler } from "hono";

export type ContentEncoding = "br" | "gzip";

/** Brotli quality 4: ~4-5x on GeoJSON at a CPU cost close to gzip -6. */
const BROTLI_QUALITY = 4;
const GZIP_LEVEL = 6;

const COMPRESSIBLE = /^application\/(?:json|geo\+json|vnd\.oai\.openapi\+json)\b/i;

/**
 * Pick the encoding from an `Accept-Encoding` header: `br` over `gzip`, honouring
 * `q=0` exclusions. `identity` (no encoding) when neither is acceptable.
 */
export function negotiateEncoding(header: string | undefined | null): ContentEncoding | undefined {
  if (!header) return undefined;
  const accepted = new Map<string, number>();
  for (const part of header.split(",")) {
    const [rawName, ...params] = part.trim().split(";");
    const name = (rawName ?? "").trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const p of params) {
      const [k, v] = p.trim().split("=");
      if (k?.trim().toLowerCase() === "q") {
        const n = Number(v);
        q = Number.isFinite(n) ? n : 0;
      }
    }
    accepted.set(name, q);
  }
  const quality = (name: ContentEncoding): number => accepted.get(name) ?? accepted.get("*") ?? 0;
  if (quality("br") > 0) return "br";
  if (quality("gzip") > 0) return "gzip";
  return undefined;
}

function encoder(encoding: ContentEncoding): Duplex {
  return encoding === "br"
    ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } })
    : createGzip({ level: GZIP_LEVEL });
}

/** Compress JSON-family responses with Brotli or gzip, streaming. */
export function compressJson(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const res = c.res;
    const type = res.headers.get("Content-Type") ?? "";
    if (!COMPRESSIBLE.test(type)) return;

    res.headers.append("Vary", "Accept-Encoding");
    const method = c.req.method;
    if ((method !== "GET" && method !== "HEAD") || res.status !== 200) return;
    // No size floor: Hono's c.json() sets no Content-Length, and a few hundred
    // bytes of JSON cost nothing to encode.
    if (!res.body || res.headers.has("Content-Encoding")) return;

    const encoding = negotiateEncoding(c.req.header("Accept-Encoding"));
    if (!encoding) return;

    const headers = new Headers(res.headers);
    headers.set("Content-Encoding", encoding);
    headers.delete("Content-Length");
    const transform = Duplex.toWeb(encoder(encoding)) as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >;
    c.res = new Response(res.body.pipeThrough(transform), { status: res.status, headers });
  };
}
