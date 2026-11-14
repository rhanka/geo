/**
 * Every S3 call of a built client is bounded by default. Writers (prewarm,
 * acquisition, publish hooks) used to build their client without any HTTP
 * timeout: a request whose peer went silent waited forever (the SDK retries
 * only on an error), which stalled the 2026-11 preprod prewarm Job for ~5 h.
 */

import { createServer, type AddressInfo, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_S3_HTTP_TIMEOUTS,
  READ_SERVER_S3_HTTP_TIMEOUTS,
  requestHandlerTimeouts,
  s3HttpTimeoutsFromEnv,
  S3Store,
  type S3StoreConfig,
} from "./s3-store.js";
import { createStore } from "./uri.js";

/** A TCP endpoint that accepts connections and never answers. */
async function silentEndpoint(): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets: Socket[] = [];
  const server: Server = createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const conn = (endpoint: string): S3StoreConfig => ({
  bucket: "b",
  endpoint,
  region: "us-east-1",
  accessKeyId: "test",
  secretAccessKey: "test",
  forcePathStyle: true,
});

/** The request-handler config the SDK resolved for a built store. */
async function handlerConfig(store: S3Store): Promise<Record<string, unknown>> {
  const handler = (store as unknown as { client: { config: { requestHandler: { configProvider: Promise<Record<string, unknown>> } } } })
    .client.config.requestHandler;
  return handler.configProvider;
}

const ENV_KEYS = ["S3_CONNECTION_TIMEOUT_MS", "S3_SOCKET_TIMEOUT_MS", "S3_REQUEST_TIMEOUT_MS"] as const;
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("S3 client HTTP timeouts", () => {
  it("bounds a built client by default (connect, socket inactivity, request)", async () => {
    expect(DEFAULT_S3_HTTP_TIMEOUTS).toEqual({ connectionTimeoutMs: 10_000, socketTimeoutMs: 300_000, requestTimeoutMs: 900_000 });
    const cfg = await handlerConfig(new S3Store(conn("http://127.0.0.1:9")));
    expect(cfg).toMatchObject({
      connectionTimeout: 10_000,
      socketTimeout: 300_000,
      requestTimeout: 900_000,
      throwOnRequestTimeout: true,
    });
  });

  it("uses explicit timeouts as given (read server unchanged: no socket bound added)", async () => {
    const cfg = await handlerConfig(new S3Store({ ...conn("http://127.0.0.1:9"), httpTimeouts: READ_SERVER_S3_HTTP_TIMEOUTS }));
    expect(cfg).toMatchObject({ connectionTimeout: 5_000, requestTimeout: 20_000, throwOnRequestTimeout: true });
    expect(cfg["socketTimeout"]).toBeUndefined();
  });

  it("maps 0 / missing fields to unbounded", () => {
    expect(requestHandlerTimeouts({})).toEqual({});
    expect(requestHandlerTimeouts({ connectionTimeoutMs: 0, requestTimeoutMs: 0, socketTimeoutMs: 7 })).toEqual({ socketTimeout: 7 });
  });

  it("reads S3_*_TIMEOUT_MS overrides and rejects malformed values", () => {
    expect(s3HttpTimeoutsFromEnv({})).toBeUndefined();
    expect(s3HttpTimeoutsFromEnv({ S3_SOCKET_TIMEOUT_MS: "60000", S3_REQUEST_TIMEOUT_MS: "0" })).toEqual({
      socketTimeoutMs: 60_000,
      requestTimeoutMs: 0,
    });
    expect(() => s3HttpTimeoutsFromEnv({ S3_CONNECTION_TIMEOUT_MS: "10s" })).toThrow(/S3_CONNECTION_TIMEOUT_MS/);
    expect(() => s3HttpTimeoutsFromEnv({ S3_SOCKET_TIMEOUT_MS: "-1" })).toThrow(/non-negative/);
  });

  it("createStore merges environment overrides over the defaults", async () => {
    process.env["S3_SOCKET_TIMEOUT_MS"] = "45000";
    const store = createStore("s3://b/p", { endpoint: "http://127.0.0.1:9", region: "us-east-1", accessKeyId: "t", secretAccessKey: "t" });
    const cfg = await handlerConfig(store as S3Store);
    expect(cfg).toMatchObject({ connectionTimeout: 10_000, socketTimeout: 45_000, requestTimeout: 900_000 });
  });

  it("a PutObject to a peer that goes silent fails on the socket bound instead of hanging (real SDK)", async () => {
    const endpoint = await silentEndpoint();
    try {
      const store = new S3Store({ ...conn(endpoint.url), httpTimeouts: { socketTimeoutMs: 300 } });
      const started = Date.now();
      await expect(store.put("k", new Uint8Array(16))).rejects.toThrow(/timed out|TimeoutError|inactivity/i);
      expect(Date.now() - started).toBeLessThan(8_000);
    } finally {
      await endpoint.close();
    }
  });

  it("put() honours an abort signal on an unbounded client (real SDK)", async () => {
    const endpoint = await silentEndpoint();
    try {
      const store = new S3Store({ ...conn(endpoint.url), httpTimeouts: {} });
      const controller = new AbortController();
      const pending = store.put("k", "body", { signal: controller.signal });
      setTimeout(() => controller.abort(), 50);
      await expect(pending).rejects.toThrow(/abort/i);
    } finally {
      await endpoint.close();
    }
  });
});
