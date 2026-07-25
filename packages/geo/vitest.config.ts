import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * NOTE (merge main ↔ acquisition): this config used to import `defineConfig`
 * from `../../acquisition/node_modules/vitest/...` and to alias `proj4` and the
 * `@turf/*` packages into `acquisition/node_modules`. That was correct while
 * `packages/geo` held nothing but `zonage/lotZoneJoin.ts` and declared no
 * dependencies of its own — it borrowed the acquisition workspace's install.
 *
 * Since the merge, `packages/geo` IS the published lib (0.5.0): it declares
 * proj4 and @turf/* in its own `dependencies`, and npm installs them under
 * `packages/geo/node_modules` (or hoists them to the root). The hard-coded
 * aliases then pointed at paths that no longer exist, and `geopdf.test.ts` /
 * `lotZoneJoin.test.ts` failed to even load their suites. Plain Node resolution
 * is now both correct and sufficient — do not re-add cross-workspace aliases.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    include: ["src/**/*.test.ts"],
  },
});
