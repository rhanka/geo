import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "../../acquisition/node_modules/vitest/dist/config.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const acquisitionNodeModules = resolve(here, "../../acquisition/node_modules");

export default defineConfig({
  root: here,
  resolve: {
    alias: {
      "@turf/area": resolve(acquisitionNodeModules, "@turf/area/dist/esm/index.js"),
      "@turf/boolean-point-in-polygon": resolve(
        acquisitionNodeModules,
        "@turf/boolean-point-in-polygon/dist/esm/index.js",
      ),
      "@turf/buffer": resolve(acquisitionNodeModules, "@turf/buffer/dist/esm/index.js"),
      "@turf/helpers": resolve(acquisitionNodeModules, "@turf/helpers/dist/esm/index.js"),
      "@turf/intersect": resolve(acquisitionNodeModules, "@turf/intersect/dist/esm/index.js"),
      proj4: resolve(acquisitionNodeModules, "proj4/lib/index.js"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
