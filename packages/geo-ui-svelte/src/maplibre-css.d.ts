/**
 * Ambient module declaration for MapLibre's stylesheet, which `GeoMap.svelte`
 * dynamically imports inside `onMount` (SSR-safe). The `.css` import has no
 * runtime value we use; this keeps `svelte-check` happy without pulling a
 * global CSS-modules type into the package tsconfig.
 */
declare module "maplibre-gl/dist/maplibre-gl.css";

/** Vite `?url` import of the MapLibre 6 module worker (see `maplibre-worker.ts`). */
declare module "maplibre-gl/dist/maplibre-gl-worker.mjs?url" {
  const url: string;
  export default url;
}
