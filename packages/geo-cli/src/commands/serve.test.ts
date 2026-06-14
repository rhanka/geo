/**
 * Tests for `startServer` provider routing. Driven with injected `createApp`,
 * `serve`, and `createStore` so no socket is opened and no live S3 is touched.
 *
 * Asserts the `--data` value selects the right provider: a bare directory →
 * `FileProvider`; a store URI (`s3://…`, `fs:…`) → `StoreProvider` over a store
 * built by `createStore`.
 */

import { describe, expect, it, vi } from "vitest";

import { FileProvider, StoreProvider, type FeatureProvider } from "@sentropic/geo-api";
import type { Store } from "@sentropic/geo/storage";

import { startServer } from "./serve.js";

/** An inert {@link Store}; never actually exercised in routing tests. */
const fakeStore: Store = {
  put: () => Promise.resolve(),
  get: () => Promise.resolve(undefined),
  has: () => Promise.resolve(false),
  list: () => Promise.resolve([]),
};

/** Capture the provider handed to `createApp`, without binding a socket. */
function harness() {
  let captured: FeatureProvider | undefined;
  const createApp = vi.fn((provider: FeatureProvider) => {
    captured = provider;
    return { fetch: () => new Response() } as unknown as ReturnType<
      typeof import("@sentropic/geo-api").createApp
    >;
  });
  const serve = vi.fn();
  const createStore = vi.fn((_uri: string) => fakeStore);
  return {
    createApp,
    serve,
    createStore,
    provider: () => captured,
  };
}

describe("startServer provider routing", () => {
  it("uses a FileProvider for a bare directory and resolves it absolute", () => {
    const h = harness();
    const handle = startServer(
      { data: "data/normalized", cwd: "/repo" },
      { createApp: h.createApp, serve: h.serve, createStore: h.createStore },
    );
    expect(h.provider()).toBeInstanceOf(FileProvider);
    expect(h.createStore).not.toHaveBeenCalled();
    expect(handle.dataDir).toBe("/repo/data/normalized");
    expect(h.serve).toHaveBeenCalledOnce();
  });

  it("uses a StoreProvider for an s3:// URI, passing the URI verbatim to createStore", () => {
    const h = harness();
    const handle = startServer(
      { data: "s3://sentropic-geo/normalized" },
      { createApp: h.createApp, serve: h.serve, createStore: h.createStore },
    );
    expect(h.provider()).toBeInstanceOf(StoreProvider);
    expect(h.createStore).toHaveBeenCalledWith("s3://sentropic-geo/normalized");
    // Store URIs are not path-resolved.
    expect(handle.dataDir).toBe("s3://sentropic-geo/normalized");
  });

  it("uses a StoreProvider for an fs: URI", () => {
    const h = harness();
    startServer(
      { data: "fs:/var/data" },
      { createApp: h.createApp, serve: h.serve, createStore: h.createStore },
    );
    expect(h.provider()).toBeInstanceOf(StoreProvider);
    expect(h.createStore).toHaveBeenCalledWith("fs:/var/data");
  });

  it("honors an injected makeProvider override", () => {
    const h = harness();
    const custom: FeatureProvider = {
      listCollections: () => Promise.resolve([]),
      getCollection: () => Promise.resolve(undefined),
      getItems: () => Promise.resolve(undefined),
      getItem: () => Promise.resolve(undefined),
    };
    const makeProvider = vi.fn(() => custom);
    startServer(
      { data: "s3://sentropic-geo/normalized" },
      { createApp: h.createApp, serve: h.serve, createStore: h.createStore, makeProvider },
    );
    expect(makeProvider).toHaveBeenCalledWith("s3://sentropic-geo/normalized");
    expect(h.provider()).toBe(custom);
    expect(h.createStore).not.toHaveBeenCalled();
  });
});
