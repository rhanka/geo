/**
 * End-to-end reproduction of the 2026-10-12 leak path through the real Node
 * adapter (`@hono/node-server`), not `app.request()`: a client that disconnects
 * while `/items` is still validating the object. The adapter then finds its
 * response writable already destroyed and never cancels the response stream,
 * so any S3 body opened for the served pass would stay open forever. The served
 * pass must therefore never open its S3 body in that case.
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
});
