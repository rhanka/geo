# @sentropic/geo-map-engine

**geo-owned, renderer-neutral map engine — FROZEN v1 contract.**

This package materializes the public contract of
[`docs/spec/SPEC_GEO_MAP_ENGINE.md`](../../docs/spec/SPEC_GEO_MAP_ENGINE.md) §1.3 as code. The
contract was **frozen and ratified owner on 2026-08-16** (`ADR-0026`) after the freeze gate §9
went **VERT** (canonical re-run `b67eb222`, deck.gl: 7/7 §1.5.1 verified in the bytes, real DS
fixtures, F7b, camera round-trip — zero maplibre expression).

## Status: types-first

The **types are the frozen v1 contract** (zero logic beyond frozen constants). The engine
**implementation lands incrementally in Phase 0** (W1–W10) against these types. Two consumers
depend on the frozen interface today:

- the **N thin DS adapters** (`design-system-geo-{svelte,react,vue,angular}`) bind against it — a
  contract-conformant mock swaps to the real engine at its landing (zero-copy);
- the **engine build** implements it.

Because both implement the *same* frozen interface, the mock→engine swap is clean.

## Contract surface (§1.3)

- **Encodings** (`encodings.ts`): `ColorEncoding` (`constant`/`category`/`valueStep`/`valueRamp`),
  `NumberEncoding`, `TokenRole`, `TokenMap` (resolved primitives, DOM-free).
- **Layers** (`layers.ts`): `GeoLayerSpec` = `choropleth` | `points` | `geojson` (v1 proven set;
  `hexbin`/`cluster`/`density`/`flow` added additively per arbitrage E.2). `data` is a geo-core
  `FeatureCollection`.
- **Basemap** (`basemap.ts`): `BasemapSpec` (`blank`/`raster`/`vector`, attribution mandatory).
- **Viewport** (`viewport.ts`): `GeoViewport` + `RendererKind` + the frozen §1.5.1 normalized-zoom
  convention (WebMercator, `512·2^zoom`, degrees, no terrain/padding/roll/wrap). Canonical home per
  §1.5 = `@sentropic/geo-core` (cross-repo release); defined here until then.
- **Surface** (`surface.ts`): `MountGeoMap` (`mount(host, opts) → handle`), `GeoMapHandle`
  (`setLayers`/`setBasemap`/`setViewport`/`setRenderer`/`setTokens` + imperative camera/query),
  `GeoMapEvents`, `GeoFeatureHit`.

## MapLibre 6 worker (consumer contract)

The 2D binding requires `maplibre-gl` `^6.4.1` (named imports only; 6.x ships no default
export). MapLibre 6 resolves its module worker **beside its own runtime module**
(`new URL("./maplibre-gl-worker.mjs", import.meta.url)`). Once a bundler relocates that runtime
(Vite dependency pre-bundling into `.vite/deps`, hashed production chunks), no worker sits
beside it and the map never loads.

An application that calls `mount` must therefore hand MapLibre the worker asset **once, before
the first map is constructed**:

```ts
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"; // Vite

setWorkerUrl(maplibreWorkerUrl);
```

The same applies to `@sentropic/geo-ui-svelte`: the application configures the worker once at
startup, for instance with the UI's exported helper:

```ts
import { ensureMaplibreWorker } from "@sentropic/geo-ui-svelte";

await ensureMaplibreWorker(
  await import("maplibre-gl"),
  async () => (await import("maplibre-gl/dist/maplibre-gl-worker.mjs?url")).default, // Vite
);
```

`GeoMap` and `GcpCalageUI` then call `ensureMaplibreWorker(maplibre)` before their first map: it
keeps the configured URL (never overwritten) and throws explicitly when none is configured,
instead of constructing a map whose worker never loads. The UI package itself ships **no**
bundler query import (`?url`, `?worker`): the consumer's dependency optimizer pre-bundles it, and
neither esbuild (Vite 6/7) nor Rolldown (Vite 8) can load such a specifier inside a dependency —
up to geo-ui-svelte 0.6.4, `vite dev` stopped at startup unless the package was listed in
`optimizeDeps.exclude`. A guard test (`no-query-imports.test.ts`) keeps it that way.

Hosting requirements for the emitted worker asset (production):

- **Self-contained module.** `maplibre-gl-worker.mjs` imports nothing (`maplibre-gl-shared.mjs`
  is an empty placeholder in the published build), so emitting it as a plain hashed asset is
  sufficient; deploy it together with the chunks that reference it.
- **MIME.** Serve it as JavaScript (`text/javascript` or `application/javascript`) with HTTP 200.
  An SPA fallback returning `index.html` for a missing asset makes the worker fail.
- **Same origin.** A same-origin URL is loaded directly as a module worker
  (`new Worker(url, { type: "module" })`); CSP needs `worker-src 'self'` (or `script-src 'self'`
  when `worker-src` is absent).
- **Cross origin (CDN).** For a cross-origin URL MapLibre wraps the module in a `blob:` URL;
  CSP must then also allow `worker-src blob:`, and the asset must be served with CORS headers.
- **Single copy.** Keep a single resolved `maplibre-gl` (`npm ls maplibre-gl --all`):
  `setWorkerUrl` configures the instance it is imported from.

`e2e/mount-e2e.mjs` exercises this contract in real Chromium twice: against the Vite dev server
and against a production build served by `vite preview`, asserting that every running worker is
the configured `maplibre-gl-worker*.mjs` asset served with HTTP 200 and a JavaScript MIME type.

## Stability

**Any change to the frozen public types = a new major version (semver) + an ADR — never silent.**
