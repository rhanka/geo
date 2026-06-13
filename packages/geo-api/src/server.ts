/**
 * Server entry point. Boots the OGC API – Features app over Node's HTTP server,
 * backed by a {@link FileProvider} reading the repo's `data/normalized`
 * directory. Run with `npm run dev` (tsx watch) or `npm start` (compiled).
 *
 * This module is executed, not imported by tests.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { FileProvider } from "./providers/file-provider.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/server.js → package root → repo root → data/normalized
const dataDir = resolve(here, "../../../data/normalized");

const provider = new FileProvider(dataDir);
const app = createApp(provider);

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  // eslint-disable-next-line no-console
  console.log(
    `@sentropic/geo-api listening on http://localhost:${info.port} (data: ${dataDir})`,
  );
});
