/**
 * MapLibre 6 worker initialization, owned by the components that construct maps.
 *
 * MapLibre 6 resolves its module worker beside its own runtime module
 * (`import.meta.url`). Once a bundler relocates that runtime (Vite dependency
 * pre-bundling, hashed production chunks), no worker sits beside it and the map
 * never loads. `GeoMap` and `GcpCalageUI` therefore hand MapLibre the worker
 * asset before their first `Map`, unless the application already configured one
 * (`setWorkerUrl` called earlier wins and is never overwritten).
 *
 * The default loader relies on Vite's `?url` import (this package ships Svelte
 * source and already relies on the bundler for its CSS import). With any other
 * bundler, the application calls MapLibre's `setWorkerUrl` itself before the
 * first map; the default loader is then never reached.
 */

/** The two MapLibre 6 named exports this module needs (the module itself is SSR-unsafe). */
export interface MaplibreWorkerApi {
  getWorkerUrl(): string;
  setWorkerUrl(url: string): void;
}

/** Vite emits `maplibre-gl-worker.mjs` as a hashed asset and returns its URL. */
async function bundledWorkerUrl(): Promise<string> {
  return (await import("maplibre-gl/dist/maplibre-gl-worker.mjs?url")).default;
}

/**
 * Ensures MapLibre has a worker URL before the first map is constructed.
 * Idempotent; an application-provided URL is kept as is.
 */
export async function ensureMaplibreWorker(
  maplibre: MaplibreWorkerApi,
  loadWorkerUrl: () => Promise<string> = bundledWorkerUrl,
): Promise<void> {
  if (maplibre.getWorkerUrl()) return;
  const url: unknown = await loadWorkerUrl();
  if (typeof url !== "string" || url === "") {
    // A bundler without Vite's `?url` support resolves to something else: fail
    // loudly instead of handing MapLibre an unusable worker URL.
    throw new Error(
      "MapLibre worker URL unresolved: call maplibre-gl setWorkerUrl(<worker asset URL>) before mounting a map",
    );
  }
  if (!maplibre.getWorkerUrl()) maplibre.setWorkerUrl(url);
}
