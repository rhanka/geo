import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for `@sentropic/geo-ui-svelte`.
 *
 * Components are compiled by the Svelte plugin and run in jsdom. jsdom has no
 * WebGL context, so the `GeoMap` tests only assert the SSR-guarded mount path
 * and the DOM (empty-state) render; `maplibre-gl` is mocked away in the test.
 * `svelteTesting` wires the `browser` resolve condition + compiles the
 * `@testing-library/svelte` runes helpers (which use `$state`).
 */
export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
