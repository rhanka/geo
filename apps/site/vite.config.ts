import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// SvelteKit 3: configuration is passed directly to the `sveltekit()` plugin
// (`svelte.config.js` is no longer read, and there is no `kit` namespace).
export default defineConfig({
  plugins: [
    sveltekit({
      preprocess: vitePreprocess(),
      // Static output. Prerendered routes are emitted as HTML; the SPA fallback
      // (200.html) lets any non-prerendered/dynamic route resolve client-side.
      adapter: adapter({
        pages: "build",
        assets: "build",
        fallback: "200.html",
        precompress: false,
        strict: false,
      }),
      prerender: {
        // Dataset GeoJSON files live in static/data and may be absent in V1.
        // A missing /data/<id>.geojson is expected: the page degrades to an
        // empty-state. Ignore those 404s instead of failing the build.
        handleHttpError: ({ path, message }) => {
          if (path.startsWith("/data/") && path.endsWith(".geojson")) {
            return;
          }
          throw new Error(message);
        },
      },
    }),
  ],
});
