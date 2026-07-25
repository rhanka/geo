import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
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
  },
};

export default config;
