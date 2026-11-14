import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

import { serve } from "@hono/node-server";
import { describe, expect, it } from "vitest";

import type { Store } from "../storage/index.js";

import { createApp } from "./app.js";
import { negotiateEncoding } from "./compress.js";
import { StoreProvider } from "./providers/store-provider.js";

describe("negotiateEncoding", () => {
  it("prefers br, then gzip, and honours q=0", () => {
    expect(negotiateEncoding("gzip, deflate, br, zstd")).toBe("br");
    expect(negotiateEncoding("gzip")).toBe("gzip");
    expect(negotiateEncoding("br;q=0, gzip;q=0.5")).toBe("gzip");
    expect(negotiateEncoding("*")).toBe("br");
    expect(negotiateEncoding("*;q=0")).toBeUndefined();
    expect(negotiateEncoding("identity")).toBeUndefined();
    expect(negotiateEncoding(undefined)).toBeUndefined();
    expect(negotiateEncoding("")).toBeUndefined();
  });
});

// Big enough to clear the compression floor, and compressible like real lots.
const FEATURES = Array.from({ length: 200 }, (_, i) => ({
  type: "Feature",
  id: `ca/qc/lot/${i}`,
  geometry: { type: "Point", coordinates: [-73.5 + i / 1e4, 45.5] },
  properties: { noLot: String(i), zoneCode: "H-101" },
}));
const COLLECTION = new TextEncoder().encode(JSON.stringify({ type: "FeatureCollection", features: FEATURES }));

function storeOf(bytes: Uint8Array): Store {
  return {
    put: async () => {},
    get: async () => bytes,
    has: async () => true,
    list: async () => ["lots.geojson"],
    getStream: async () =>
      (async function* () {
        yield bytes;
      })(),
  };
}

describe("compressJson on the API", () => {
  const app = createApp(new StoreProvider(storeOf(COLLECTION)));

  async function bytesOf(res: Response): Promise<Buffer> {
    return Buffer.from(await res.arrayBuffer());
  }

  it("serves Brotli when accepted, decodable to the same body as identity", async () => {
    const plain = await app.request("/collections/lots/items?limit=1000");
    expect(plain.headers.get("Content-Encoding")).toBeNull();
    expect(plain.headers.get("Vary")).toMatch(/Accept-Encoding/);
    const identity = JSON.parse((await bytesOf(plain)).toString("utf8")) as { features: unknown[] };

    const res = await app.request("/collections/lots/items?limit=1000", {
      headers: { "Accept-Encoding": "gzip, br" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Encoding")).toBe("br");
    expect(res.headers.get("Content-Type")).toBe("application/geo+json");
    expect(res.headers.get("Vary")).toMatch(/Accept-Encoding/);
    expect(res.headers.get("Content-Length")).toBeNull();
    const body = await bytesOf(res);
    const decoded = JSON.parse(brotliDecompressSync(body).toString("utf8")) as { features: unknown[] };
    expect(decoded.features).toEqual(identity.features);
    expect(body.byteLength).toBeLessThan(COLLECTION.byteLength / 3);
  });

  it("falls back to gzip", async () => {
    const res = await app.request("/collections/lots/items?limit=1000", {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
    const decoded = JSON.parse(gunzipSync(await bytesOf(res)).toString("utf8")) as { features: unknown[] };
    expect(decoded.features).toHaveLength(FEATURES.length);
  });

  it("compresses plain JSON routes too, but not errors", async () => {
    const api = await app.request("/api", { headers: { "Accept-Encoding": "br" } });
    expect(api.headers.get("Content-Encoding")).toBe("br");
    expect(JSON.parse(brotliDecompressSync(await bytesOf(api)).toString("utf8"))).toHaveProperty("openapi");

    const missing = await app.request("/collections/lots/items?bbox=bad", {
      headers: { "Accept-Encoding": "br" },
    });
    expect(missing.status).toBe(400);
    expect(missing.headers.get("Content-Encoding")).toBeNull();
  });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("compressed /items with a client that leaves mid-response (real Node server)", () => {
  it("still releases the served S3 body at once", async () => {
    let servedReleased = false;
    let opens = 0;
    const half = Math.floor(COLLECTION.byteLength / 2);
    const store: Store = {
      put: async () => {},
      get: async () => undefined,
      has: async () => true,
      list: async () => ["lots.geojson"],
      getStream: async (_key, opts) => {
        opens++;
        if (opens === 1) {
          return (async function* () {
            yield COLLECTION; // validation pass
          })();
        }
        return (async function* () {
          yield COLLECTION.subarray(0, half);
          await new Promise<void>((_, reject) => {
            opts?.signal?.addEventListener("abort", () => {
              servedReleased = true;
              reject(new Error("aborted"));
            });
          });
        })();
      },
    };
    const server = serve({ fetch: createApp(new StoreProvider(store)).fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;

    try {
      const req = request({
        host: "127.0.0.1",
        port,
        path: "/collections/lots/items",
        headers: { "Accept-Encoding": "br" },
      });
      req.on("error", () => {});
      const responded = new Promise<string | undefined>((resolve) =>
        req.on("response", (res) => resolve(res.headers["content-encoding"])),
      );
      req.end();
      expect(await responded).toBe("br");
      for (let i = 0; i < 100 && opens < 2; i++) await sleep(10);
      expect(opens).toBe(2);

      req.destroy();
      for (let i = 0; i < 50 && !servedReleased; i++) await sleep(10);
      expect(servedReleased).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
