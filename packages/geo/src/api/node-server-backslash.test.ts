/**
 * GHSA-jpvv-r467-5p4w (`@hono/node-server` < 2.1.6): a raw backslash in the
 * request path was parsed as `/` (and `..` resolved), so `/public\..\admin`
 * reached the app as `/admin` while a reverse proxy in front applied its
 * path rules to the original path. From 2.1.6 the adapter answers 400.
 * Checked through the real Node adapter, not `app.request()`.
 */

import { request } from "node:http";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Store } from "../storage/index.js";

import { createApp } from "./app.js";
import { StoreProvider } from "./providers/store-provider.js";

const store: Store = {
  put: async () => {},
  get: async () => undefined,
  has: async () => false,
  list: async () => [],
  getStream: async () => undefined,
};

function statusOf(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("raw backslash in the request path (real Node server)", () => {
  let server: ReturnType<typeof serve>;
  let port: number;

  beforeAll(async () => {
    server = serve({ fetch: createApp(new StoreProvider(store)).fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects a backslash traversal with 400", async () => {
    expect(await statusOf(port, "/public\\..\\conformance")).toBe(400);
    expect(await statusOf(port, "/collections\\zones/items")).toBe(400);
  });

  it("still serves the same path written with slashes", async () => {
    expect(await statusOf(port, "/conformance")).toBe(200);
  });
});
