/**
 * End-to-end checks of the 2026-10-12 leak paths through the real Node adapter
 * (`@hono/node-server` 2.1.0), not `app.request()`:
 * - a client that disconnects while `/items` is still validating the object:
 *   the response is handed to the adapter after the socket already closed, so
 *   the adapter's close→cancel listener (attached when it starts writing) never
 *   fires; any S3 body opened for the served pass would stay open. The served
 *   pass must therefore never open its S3 body in that case;
 * - a client that disconnects while the served S3 read is pending: the request
 *   signal must release that read at once (an iterator `return()` cannot
 *   interrupt a pending `next()`).
 */

import { request } from "node:http";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { describe, expect, it } from "vitest";

import type { Store } from "../storage/index.js";

import { createApp } from "./app.js";
import { StoreProvider } from "./providers/store-provider.js";

const COLLECTION = new TextEncoder().encode(
  JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", id: "a", geometry: { type: "Point", coordinates: [-73.5, 45.5] }, properties: {} }],
  }),
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("/items with a client that leaves during validation (real Node server)", () => {
  it("never opens the served S3 body", async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => (openGate = resolve));
    const streamCalls: string[] = [];
    const store: Store = {
      put: async () => {},
      get: async () => undefined,
      has: async () => true,
      list: async () => ["zones.geojson"],
      getStream: async (key) => {
        streamCalls.push(key);
        return (async function* () {
          await gate; // a slow validation read (large lots object)
          yield COLLECTION;
        })();
      },
    };
    const server = serve({ fetch: createApp(new StoreProvider(store)).fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;

    try {
      const req = request({ host: "127.0.0.1", port, path: "/collections/zones/items?limit=1" });
      req.on("error", () => {}); // the client aborts on purpose
      req.end();
      for (let i = 0; i < 100 && streamCalls.length === 0; i++) await sleep(10);
      expect(streamCalls).toEqual(["zones.geojson"]); // validation pass started

      req.destroy(); // client gives up mid-validation
      await sleep(50);
      openGate(); // validation completes after the client is gone
      await sleep(100);

      expect(streamCalls).toEqual(["zones.geojson"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("releases the served S3 body at once when the client leaves while a chunk is pending", async () => {
    let servedReleased = false;
    let opens = 0;
    const half = Math.floor(COLLECTION.byteLength / 2);
    const store: Store = {
      put: async () => {},
      get: async () => undefined,
      has: async () => true,
      list: async () => ["zones.geojson"],
      getStream: async (_key, opts) => {
        opens++;
        if (opens === 1) {
          return (async function* () {
            yield COLLECTION; // validation pass: whole object
          })();
        }
        // Served pass: first half, then S3 stalls until the read is cancelled.
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
      const req = request({ host: "127.0.0.1", port, path: "/collections/zones/items" });
      req.on("error", () => {});
      const responded = new Promise<void>((resolve) => req.on("response", () => resolve()));
      req.end();
      await responded; // headers sent: the served body is open and stalled
      for (let i = 0; i < 100 && opens < 2; i++) await sleep(10);
      expect(opens).toBe(2);

      req.destroy(); // client gives up mid-response
      for (let i = 0; i < 50 && !servedReleased; i++) await sleep(10);
      expect(servedReleased).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
