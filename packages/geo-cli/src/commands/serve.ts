/**
 * `geo serve` — boot the OGC API – Features server backed by a `FileProvider`
 * reading the normalized-data directory. Wires `@sentropic/geo-api`'s
 * `createApp` + a `FileProvider` to `@hono/node-server`.
 *
 * The serving primitives are injectable so the wiring can be tested without
 * opening a socket.
 */

import { serve as defaultServe } from "@hono/node-server";
import { createApp as defaultCreateApp, FileProvider } from "@sentropic/geo-api";

import { resolveDataDir } from "../paths.js";

export interface ServeOptions {
  port?: number;
  /** Normalized-data directory; resolved relative to cwd. Default `./data/normalized`. */
  data?: string;
  cwd?: string;
}

export interface ServeDeps {
  createApp?: typeof defaultCreateApp;
  serve?: typeof defaultServe;
  /** Construct the provider for `dataDir`. Defaults to a `FileProvider`. */
  makeProvider?: (dataDir: string) => FileProvider;
}

export interface ServeHandle {
  port: number;
  dataDir: string;
}

export const DEFAULT_PORT = 8787;

/**
 * Resolve the data dir, build the app over a `FileProvider`, and start serving.
 * Returns the bound port and data dir. With injected deps it can be driven in
 * tests without binding a real socket.
 */
export function startServer(options: ServeOptions = {}, deps: ServeDeps = {}): ServeHandle {
  const createApp = deps.createApp ?? defaultCreateApp;
  const serve = deps.serve ?? defaultServe;

  const dataDir = resolveDataDir(options.data, options.cwd);
  const port = options.port ?? DEFAULT_PORT;

  const provider = deps.makeProvider ? deps.makeProvider(dataDir) : new FileProvider(dataDir);
  const app = createApp(provider);

  serve({ fetch: app.fetch, port });

  return { port, dataDir };
}
