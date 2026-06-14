/**
 * `geo serve` — boot the OGC API – Features server over the normalized data.
 *
 * The `--data` value selects the provider:
 *   - a store URI — `s3://<bucket>/<prefix>` or `fs:<dir>` — is served by a
 *     `StoreProvider` over a `Store` from `@sentropic/geo-storage` (ADR-0012);
 *   - a bare directory (relative paths resolved against cwd) is served by a
 *     `FileProvider`, preserving the original behavior.
 *
 * Wires `@sentropic/geo-api`'s `createApp` + the chosen provider to
 * `@hono/node-server`. The serving primitives and provider factory are
 * injectable so the wiring can be tested without opening a socket or touching S3.
 */

import { serve as defaultServe } from "@hono/node-server";
import {
  createApp as defaultCreateApp,
  isStoreUri,
  StoreProvider,
  FileProvider,
  type FeatureProvider,
} from "@sentropic/geo-api";
import { createStore as defaultCreateStore } from "@sentropic/geo/storage";

import { resolveDataDir } from "../paths.js";

export interface ServeOptions {
  port?: number;
  /**
   * Data location: a directory (resolved relative to cwd), `fs:<dir>`, or
   * `s3://<bucket>/<prefix>`. Default `./data/normalized`.
   */
  data?: string;
  cwd?: string;
}

export interface ServeDeps {
  createApp?: typeof defaultCreateApp;
  serve?: typeof defaultServe;
  /** Build a `Store` for a store URI. Defaults to `geo-storage`'s `createStore`. */
  createStore?: typeof defaultCreateStore;
  /**
   * Construct the provider for the resolved data location, overriding the
   * default FileProvider/StoreProvider selection (used in tests).
   */
  makeProvider?: (dataLocation: string) => FeatureProvider;
}

export interface ServeHandle {
  port: number;
  /** The data location served (resolved directory, or store URI verbatim). */
  dataDir: string;
}

export const DEFAULT_PORT = 8787;

/**
 * Resolve the data location, build the app over the matching provider, and
 * start serving. Returns the bound port and data location. With injected deps
 * it can be driven in tests without binding a real socket or touching S3.
 */
export function startServer(options: ServeOptions = {}, deps: ServeDeps = {}): ServeHandle {
  const createApp = deps.createApp ?? defaultCreateApp;
  const serve = deps.serve ?? defaultServe;
  const createStore = deps.createStore ?? defaultCreateStore;

  // Store URIs are passed through verbatim; bare paths are resolved to an
  // absolute directory (the original FileProvider behavior).
  const dataLocation =
    options.data !== undefined && isStoreUri(options.data)
      ? options.data
      : resolveDataDir(options.data, options.cwd);

  const port = options.port ?? DEFAULT_PORT;

  // `createStore` roots the store at the URI's bucket/prefix (or fs dir), so the
  // StoreProvider lists from the store root (empty prefix).
  const provider = deps.makeProvider
    ? deps.makeProvider(dataLocation)
    : isStoreUri(dataLocation)
      ? new StoreProvider(createStore(dataLocation))
      : new FileProvider(dataLocation);

  const app = createApp(provider);

  serve({ fetch: app.fetch, port });

  return { port, dataDir: dataLocation };
}
