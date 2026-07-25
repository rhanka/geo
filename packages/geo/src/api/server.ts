/**
 * Server entry point. Boots the OGC API – Features app over Node's HTTP server.
 * Run with `npm run dev` (tsx watch) or `npm start` (compiled
 * `dist/api/server.js`).
 *
 * The data location is chosen from the environment:
 *   - `GEO_DATA_URI` — a store URI (`s3://bucket/prefix` or `fs:<dir>`), served
 *     by a {@link StoreProvider} over the storage abstraction (ADR-0012);
 *   - `GEO_DATA_DIR` — a plain directory, served by a {@link FileProvider};
 *   - neither set — the repo's `data/normalized` directory (FileProvider).
 *
 * The source catalog served at `/sources` is built by importing the continent
 * source libraries **dynamically and optionally** (ADR-0017): the engine never
 * statically depends on them, so the image runs without them; when present they
 * populate the inventory. A missing continent is skipped, not fatal.
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
import { buildInventory } from "../catalog/index.js";
import { loadContinentRegistries } from "../cli/continents.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/api/server.js → api → dist → package root → repo root → data/normalized
const defaultDataDir = resolve(here, "../../../../data/normalized");

// Precedence: explicit store URI, then explicit local dir, then the default.
const dataLocation =
  process.env["GEO_DATA_URI"] ?? process.env["GEO_DATA_DIR"] ?? defaultDataDir;

const provider = makeProvider(dataLocation);
// Inject the source catalog (optional continents, dynamically loaded) so
// `/sources` is populated in Docker/k8s without a hard dependency edge.
const inventory = buildInventory(await loadContinentRegistries());
const app = createApp(provider, inventory);

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(
    `@sentropic/geo listening on http://localhost:${info.port} (data: ${dataLocation}, sources: ${inventory.length})`,
  );
});
