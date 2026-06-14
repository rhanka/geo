/**
 * Server entry point. Boots the OGC API – Features app over Node's HTTP server.
 * Run with `npm run dev` (tsx watch) or `npm start` (compiled).
 *
 * The data location is chosen from the environment:
 *   - `GEO_DATA_URI` — a store URI (`s3://bucket/prefix` or `fs:<dir>`), served
 *     by a {@link StoreProvider} over `@sentropic/geo-storage` (ADR-0012);
 *   - `GEO_DATA_DIR` — a plain directory, served by a {@link FileProvider};
 *   - neither set — the repo's `data/normalized` directory (FileProvider).
 *
 * `makeProvider` builds an `S3Store` without opening a connection and the
 * provider only lists/reads on first request, so booting never needs a live S3.
 *
 * This module is executed, not imported by tests.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { makeProvider } from "./providers/make-provider.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/server.js → package root → repo root → data/normalized
const defaultDataDir = resolve(here, "../../../data/normalized");

// Precedence: explicit store URI, then explicit local dir, then the default.
const dataLocation =
  process.env["GEO_DATA_URI"] ?? process.env["GEO_DATA_DIR"] ?? defaultDataDir;

const provider = makeProvider(dataLocation);
const app = createApp(provider);

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(
    `@sentropic/geo-api listening on http://localhost:${info.port} (data: ${dataLocation})`,
  );
});
