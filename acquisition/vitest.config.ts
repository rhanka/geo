import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Network-free, pure-function tests only (no S3 / no HTTP).
    testTimeout: 20000,
  },
});
