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

The consuming application must therefore hand MapLibre the worker asset **once, before the
first map is constructed** (this applies equally to `@sentropic/geo-ui-svelte`'s `GeoMap`):

```ts
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"; // Vite

setWorkerUrl(maplibreWorkerUrl);
```

`maplibre-gl-worker.mjs` is self-contained (`maplibre-gl-shared.mjs` is an empty placeholder in
production builds), so emitting it as a plain asset is sufficient. Keep a single resolved
`maplibre-gl` copy (`npm ls maplibre-gl --all`): `setWorkerUrl` configures the instance it is
imported from. `e2e/main.js` exercises this contract in real Chromium.

## Stability

**Any change to the frozen public types = a new major version (semver) + an ADR — never silent.**
