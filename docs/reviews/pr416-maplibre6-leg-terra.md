---
status: completed
reviewer-host: codex
reviewer-model: gpt-5.6-terra
reviewer-effort: high
target-ref: 3c311bc23fd280d6137bc4f33577b7a442369b8a
lens: correctness + does-it-actually-reproduce
---

## Reasoning

I reviewed the requested range against the installed `maplibre-gl` 6.14.0 bytes and types. It has no default export; the changed runtime imports use named exports. A repository-wide source/test/e2e/app search found no remaining MapLibre default import or MapLibre `.default` access. `npm ls maplibre-gl --all` resolves one deduplicated 6.14.0 copy for the engine, Svelte UI, and site, so the dependency upgrade itself removes the installed 5.x copy.

The Vite `?url` form used by the engine e2e is valid: an in-memory production Vite build emitted `assets/maplibre-gl-worker-DxGNRm0a.mjs` at 508314 bytes. The engine's worker hand-off is therefore a valid Vite dev/production consumer pattern. `setPaintProperty`'s new cast is confined to the internal renderer boundary; the only production projector builds the corresponding paint keys for known `fill`, `line`, `circle`, and `symbol` layer types. I found no MapLibre-6 type-drift defect from that cast in this diff.

Focused checks passed: `npm run check` and `npm test` for both `@sentropic/geo-map-engine` and `@sentropic/geo-ui-svelte` (147 tests total). The real Chromium e2e could not be run locally because Playwright's configured Chromium executable is absent; this is an environment failure, not evidence that the e2e passed. Its source does configure the worker, but it covers only the engine fixture.

## Findings

### Blocking — real UI consumers never configure the required MapLibre 6 worker

The README correctly says the application must call `setWorkerUrl(...)` before its first map and explicitly says this applies to `GeoMap` ([packages/geo-map-engine/README.md:46](packages/geo-map-engine/README.md#L46)). The only such call in repository source is the engine e2e fixture ([packages/geo-map-engine/e2e/main.js:1](packages/geo-map-engine/e2e/main.js#L1), [packages/geo-map-engine/e2e/main.js:11](packages/geo-map-engine/e2e/main.js#L11)).

`GeoMap` dynamically imports MapLibre and constructs a map without configuring a worker ([packages/geo-ui-svelte/src/GeoMap.svelte:245](packages/geo-ui-svelte/src/GeoMap.svelte#L245), [packages/geo-ui-svelte/src/GeoMap.svelte:294](packages/geo-ui-svelte/src/GeoMap.svelte#L294)). `GcpCalageUI` has the same omission ([packages/geo-ui-svelte/src/GcpCalageUI.svelte:487](packages/geo-ui-svelte/src/GcpCalageUI.svelte#L487), [packages/geo-ui-svelte/src/GcpCalageUI.svelte:496](packages/geo-ui-svelte/src/GcpCalageUI.svelte#L496)). The shipped site mounts `GeoMap` on both map routes without a prior configuration ([apps/site/src/routes/carte/+page.svelte:183](apps/site/src/routes/carte/+page.svelte#L183), [apps/site/src/routes/datasets/[id]/+page.svelte:51](apps/site/src/routes/datasets/[id]/+page.svelte#L51)). In the installed 6.14.0 module, `getWorkerUrl()` initially returns the empty string.

Consequently the PR proves only a specially configured engine test page, not its actual `GeoMap`/`GcpCalageUI` consumers. The Svelte test cannot catch this: it replaces the whole MapLibre module with a fake ([packages/geo-ui-svelte/src/GeoMap.test.ts:25](packages/geo-ui-svelte/src/GeoMap.test.ts#L25)) and does not model a worker URL. Apply the documented `?url` + `setWorkerUrl` setup at the site/application bootstrap before either component can mount, and add a real-browser test for a Svelte consumer (including a production build) before merging.

## Verdict

NO-GO
