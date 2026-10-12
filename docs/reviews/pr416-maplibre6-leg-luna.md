---
status: completed
reviewer-host: codex
reviewer-model: gpt-5.6-luna
reviewer-effort: high
target-ref: 3c311bc23fd280d6137bc4f33577b7a442369b8a
lens: security + supply-chain + consumer contract
---

# Reasoning

I reviewed only `cfeb58754011de16e401ae9860e54a580e375f2f...3c311bc23fd280d6137bc4f33577b7a442369b8a`; the later documentation-only commit was excluded. The review was read-only apart from this leg artifact.

The dependency graph is internally consistent. `apps/site/package.json:23`, `packages/geo-map-engine/package.json:34-36`, and `packages/geo-ui-svelte/package.json:40-44` all require `maplibre-gl` `^6.4.1`. The root lockfile records one resolved copy, `6.14.0`, at `package-lock.json:5821-5844`; `npm ls maplibre-gl --all` reports that copy deduped under the engine, site, and UI workspaces. No current workspace manifest or lockfile entry retains MapLibre 5.x or a range below 6.4.1.

The lockfile churn is attributable to the MapLibre 5-to-6 dependency graph: the changed `@maplibre/*`, `@mapbox/*`, `bidi-js`, `earcut`, and `pbf` entries are dependencies of the changed `maplibre-gl` node. I found no unrelated application dependency churn. The `@sentropic/geo-core` ranges remain `^0.6.0`, which accepts an application-pinned `0.6.1` and does not create a strict-peer-deps conflict.

Read-only `npm pack --dry-run --json` succeeded for all six publishable workspaces. The engine tarball includes `dist`; its generated `dist/mount.js:7` uses the named `Map as MapLibreMap` import. The UI tarball intentionally publishes `src` (`packages/geo-ui-svelte/package.json:19-29`), and the shipped source contains named imports. The release workflow verifies all six versions and publishes them in dependency order (`.github/workflows/npm-publish.yml:65-82`, `124-138`). The preserved exports are visible in `packages/geo-map-engine/src/index.ts:24-34` and `packages/geo-ui-svelte/src/index.ts:8-27,78-82`; `geo-core` is outside the diff.

Attribution handling did not reveal an XSS regression. MapLibre's `AttributionControl` sanitizes attribution fragments before DOM insertion (`node_modules/maplibre-gl/src/ui/control/attribution_control.ts:176-186`), while the engine's dynamic attribution sink uses `textContent` (`packages/geo-map-engine/src/mount.ts:304-323`).

# Findings

## F1 — BLOCKING: the UI package constructs MapLibre maps without owning worker initialization

`packages/geo-ui-svelte/src/GeoMap.svelte:244-251,294-320` dynamically imports `Map`, `NavigationControl`, and `AttributionControl`, then constructs the map, but never calls `setWorkerUrl`. `packages/geo-ui-svelte/src/GcpCalageUI.svelte:485-502` has the same direct construction path. The package exposes MapLibre only as a peer (`packages/geo-ui-svelte/package.json:40-44`), so a consumer must independently import the same singleton and configure it before either component mounts.

The README explicitly makes that setup the consumer's responsibility (`packages/geo-map-engine/README.md:46-58`), but the repository's own UI consumers use `GeoMap` directly in `apps/site/src/routes/carte/+page.svelte:12-18,180-195` and `apps/site/src/routes/datasets/[id]/+page.svelte:13,50-52`; no UI-owned or shared initialization is present. This means a normal `@sentropic/geo-ui-svelte` consumer can pass typechecking and dependency installation yet fail to create a worker after Vite relocates the MapLibre runtime. The package that constructs the map must own initialization, or expose a mandatory shared initializer/configuration seam that is applied by both UI and engine before first construction.

## F2 — BLOCKING: the documented worker contract is incomplete for production hosting

`packages/geo-map-engine/README.md:40-59` documents the Vite `?url` import and says the emitted worker can be a plain asset, but it does not specify the production requirements for the returned URL: JavaScript MIME (`application/javascript`), retention of the hashed asset, CSP `worker-src`, or same-origin versus cross-origin/CORS behavior. These are material requirements: MapLibre creates a module worker directly for same-origin URLs and falls back through a `blob:` wrapper for cross-origin module URLs (`node_modules/maplibre-gl/src/util/web_worker.ts:47-90`), so CSP must allow the applicable worker source (including `blob:` for that path), and the served asset must be executable JavaScript.

The added E2E only starts Vite's development server (`packages/geo-map-engine/e2e/mount-e2e.mjs:8-15`) and catches browser errors (`packages/geo-map-engine/e2e/mount-e2e.mjs:31-35`); it does not build a production bundle, inspect the hashed worker response, or validate response headers/CSP. Thus the documented `setWorkerUrl` recipe is not a sufficient Vite-production hosting contract for the immo receipt.

## Non-findings

- No residual MapLibre 5.x or `<=6.4.0` range, duplicate installed copy, or strict-peer-deps failure was found. The lockfile and `npm ls` evidence above show one `6.14.0` resolution.
- Named imports are present in the rebuilt engine artifact, and the UI's published source uses named imports. The requested `GeoMap`, `GeoDetailPanel`, `mount`, `createGoogle2dBasemapAdapter`, and public types remain exported.
- The attribution paths inspected are sanitized or text-only; the MapLibre 6 import migration itself does not introduce an attribution/XSS issue.

# Verdict

NO-GO. The dependency migration is supply-chain-clean, but the published UI path can construct MapLibre without the required worker configuration, and the README/E2E contract does not establish production MIME/CSP/cross-origin behavior. Resolve F1 and F2, then rerun a production static-host integration check before accepting PR #416.
---
