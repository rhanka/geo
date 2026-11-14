import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Network-free, pure-function tests only (no S3 / no HTTP).
    testTimeout: 20000,
    // The publication-time display-mirror hook (lib/display-publish.ts) would
    // send extra requests through the fake S3 clients of unrelated writer
    // tests. It is off by default here and ON in its own tests
    // (display-publish.test.ts), which run it against an in-memory S3.
    env: { GEO_DISPLAY_PUBLISH: "0" },
  },
});
