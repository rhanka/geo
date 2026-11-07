/**
 * MapLibre 6 worker initialization, owned by the components that construct maps.
 *
 * MapLibre 6 resolves its module worker beside its own runtime module
 * (`import.meta.url`). Once a bundler relocates that runtime (Vite dependency
 * pre-bundling, hashed production chunks), no worker sits beside it and the map
 * never loads. The worker asset URL must therefore come from the APPLICATION,
 * whose own code the bundler processes (e.g. Vite's
 * `import url from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"`).
 *
 * This package deliberately ships NO bundler query import (`?url`, `?worker`):
 * a consumer's dependency optimizer pre-bundles this package, and neither
 * esbuild (Vite 6/7) nor Rolldown (Vite 8) can load such a specifier inside a
 * dependency, so `vite dev` stopped at startup (geo-ui-svelte ≤ 0.6.4).
 *
 * `GeoMap` and `GcpCalageUI` call `ensureMaplibreWorker(maplibre)` before their
 * first `Map`: it keeps the URL the application configured beforehand
 * (`setWorkerUrl`, or `ensureMaplibreWorker(maplibre, loader)` at startup) and
 * fails loudly when none is configured.
 */

/** The two MapLibre 6 named exports this module needs (the module itself is SSR-unsafe). */
export interface MaplibreWorkerApi {
  getWorkerUrl(): string;
  setWorkerUrl(url: string): void;
}

const UNRESOLVED =
  "MapLibre worker URL unresolved: call maplibre-gl setWorkerUrl(<worker asset URL>), or ensureMaplibreWorker(maplibre, loader), before mounting a map";

/**
 * Ensures MapLibre has a worker URL before the first map is constructed.
 * Idempotent; an application-provided URL is kept as is. Without `loadWorkerUrl`,
 * a missing URL is an error: the package cannot resolve the worker asset itself.
 */
export async function ensureMaplibreWorker(
  maplibre: MaplibreWorkerApi,
  loadWorkerUrl?: () => Promise<string>,
): Promise<void> {
  if (maplibre.getWorkerUrl()) return;
  if (!loadWorkerUrl) throw new Error(UNRESOLVED);
  const url: unknown = await loadWorkerUrl();
  // An application URL set while the loader was pending wins, whatever it resolved to.
  if (maplibre.getWorkerUrl()) return;
  if (typeof url !== "string" || url === "") {
    // A loader that does not resolve to a URL (e.g. a bundler without `?url`
    // support): fail loudly instead of handing MapLibre an unusable worker URL.
    throw new Error(UNRESOLVED);
  }
  maplibre.setWorkerUrl(url);
}
