---
status: completed
reviewer-host: codex
reviewer-model: gpt-5.6-luna
reviewer-effort: high
target-ref: 100ac698513bd084357adbda6603a9ce1b232e25
lens: security + supply-chain + consumer contract
---

# Reasoning

The dependency contract is internally consistent: `apps/site/package.json:23`,
`packages/geo-map-engine/package.json:36`, and
`packages/geo-ui-svelte/package.json:43` all require MapLibre `^6.4.1`, and the
lockfile has one resolved `maplibre-gl` at 6.14.0 (`package-lock.json:5821-5850`).
`npm ls maplibre-gl --all --parseable` returned only the root
`node_modules/maplibre-gl` path. Named imports are used by the engine and UI.

The published UI dry-run includes `src/maplibre-worker.ts`,
`src/maplibre-css.d.ts`, and `src/index.ts`; the ambient `?url` declaration is
therefore shipped. The engine dry-run includes its README and compiled `dist`.
The six lockstep publish entries and tag-merged guard remain present in
`.github/workflows/npm-publish.yml:70-81,118-138`.

Against both the installed MapLibre 6.14.0 source and the 6.4.1 package source,
`workerFactory` uses `config.WORKER_URL`, `new Worker(url, {type: 'module'})`,
and the cross-origin module path creates a `blob:` import wrapper. The installed
worker bundle is self-contained: `node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs`
has no static imports, while `maplibre-gl-shared.mjs` is zero bytes. The README's
MIME, same-origin CSP, cross-origin CORS/blob, and single-copy statements are
consistent with that implementation.

The UI ownership change is real: `GeoMap` and `GcpCalageUI` call
`ensureMaplibreWorker` before constructing `Map` (`GeoMap.svelte:245-250`,
`GcpCalageUI.svelte:486-491`). The helper preserves an already configured URL
and has a race-safe second check (`maplibre-worker.ts:27-33`), so a UI map that
mounts first configures the same hoisted MapLibre instance used by the engine.

Checks completed: UI `svelte-check` (0 errors, 0 warnings), UI tests (73/73),
and engine TypeScript build. The Playwright e2e could not run because this
workspace lacks the Chromium executable; that is recorded below as an
environmental verification limitation, not treated as evidence of success.

# Findings

## F1 — blocking — the published UI default is Vite-only

`packages/geo-ui-svelte/src/maplibre-worker.ts:18-21` hard-codes a dynamic
import of `maplibre-gl/dist/maplibre-gl-worker.mjs?url`. The helper's optional
loader does permit a caller to inject a URL, but both built-in component paths
call `ensureMaplibreWorker(maplibre)` with the default loader
(`GeoMap.svelte:246-250` and `GcpCalageUI.svelte:488-491`). The package exports
raw `src` as its public/default entry (`packages/geo-ui-svelte/package.json:19-29`),
so this is part of the published consumer contract rather than an internal
Vite-only test fixture.

Evidence: Vite resolves `?url` to an asset URL, as shown by the passing helper
test (`maplibre-worker.test.ts:39-43`). A non-Vite Node ESM import of the same
specifier instead attempted to execute the real `maplibre-gl-worker.mjs` and
failed with `self is not defined`; it did not return a URL asset. A non-Vite
bundler without Vite's query transform has the same unsupported/incorrect
resolution class. Since the components invoke this path for every client-side
map, a non-Vite consumer can reach `setWorkerUrl(undefined)` or fail before the
map is created. The `onMount`/`window` guard (`GeoMap.svelte:237-240`) keeps the
server render from executing it at runtime, but it does not make the published
client module portable or prove an SSR bundler can resolve the query import.

Required correction: make the default published path bundler-neutral, or make
the worker URL an explicit consumer/bundler adapter for non-Vite builds and use
that adapter from the components. Add a non-Vite/SSR build or runtime fixture
that proves the published tarball does not execute the worker module as a URL
loader.

## F2 — non-blocking — Chromium proof unavailable in this checkout

`npm --workspace @sentropic/geo-map-engine run test:mount-e2e` failed before
starting either the dev or `vite preview` scenario because Playwright could not
find `chrome-headless-shell`. The new assertions are present at
`packages/geo-map-engine/e2e/mount-e2e.mjs:67-82` and cover worker naming, HTTP
200, and JavaScript MIME, but their runtime result is unverified here. This is
an environment limitation, not a code finding; CI or a machine with the
declared Playwright browser must run it before merge.

No new CSP/blob attack surface was introduced by the helper itself: it only
loads the bundled same-origin asset and calls MapLibre's existing setter. The
cross-origin `blob:` behavior is application-selected through an existing
worker URL and is documented with the required `worker-src blob:` and CORS
conditions (`packages/geo-map-engine/README.md:62-75`). `npm audit --json`
reported zero critical advisories at this target; the remaining reported
advisories were not in the changed worker path.

# Verdict

NO-GO. F1 is a blocking consumer-contract failure: the advertised UI fix is
correct for Vite, but the published default path is not safe for a non-Vite
consumer and is not validated as portable for SSR bundlers. F2 must be rerun
in an environment with the Playwright browser after F1 is corrected.
