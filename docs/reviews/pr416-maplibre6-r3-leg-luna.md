---
status: completed
reviewer-host: codex
reviewer-model: gpt-5.6-luna
reviewer-effort: high
target-ref: 1641a453e99278d6ae9f2472b2600ab24eafef1e
lens: security + supply-chain + consumer contract
---

# Reasoning

The previous blocking F1 is acceptably bounded by this delta, but it is not a
claim of bundler-neutral support. `packages/geo-ui-svelte/package.json:19-29`
publishes the Svelte source, so the consumer's bundler is already part of the
package contract. The claimed pre-existing bundler dependency is confirmed on
the PR base (`cfeb58754011de16e401ae9860e54a580e375f2f`): both
`GeoMap.svelte:246-247` and `GcpCalageUI.svelte:487-488` dynamically import
`maplibre-gl/dist/maplibre-gl.css` before this delta's worker change.

The new contract is explicit in `packages/geo-map-engine/README.md:46-64`:
the application supplies a worker URL with `setWorkerUrl` before the first map
when it is not using Vite, while the UI's default remains the Vite `?url`
loader. The implementation honors that ordering at
`packages/geo-ui-svelte/src/maplibre-worker.ts:36-45`: an existing URL skips
the loader, the loader result is checked for a non-empty string, and an invalid
result raises an actionable error naming `setWorkerUrl` instead of passing an
unusable value to MapLibre. The added unit test covers the invalid-result path
at `packages/geo-ui-svelte/src/maplibre-worker.test.ts:39-44`.

The runtime evidence supports the scoped Vite contract. CI run
`38201424965` reports real Chromium success in both modes:

- dev: worker HTTP 200, `text/javascript`, from MapLibre's dev asset;
- preview: worker HTTP 200, `text/javascript`, from the hashed production asset.

The delta is limited to the helper validation, its unit test, and the consumer
documentation; it adds no dependency, network, or execution capability. The
workspace has one installed `maplibre-gl` path (`npm ls maplibre-gl --all
--parseable`). `npm test` passed across the workspace, and `npm run check`
passed including the UI Svelte check with zero errors and zero warnings.

# Findings

## F1 — previous blocker: acceptably bounded (non-blocking)

The published default is still Vite-specific, but that limitation is now an
explicit consumer contract rather than an implicit promise of arbitrary
bundler support. A non-Vite consumer is told to configure MapLibre before the
first map, and `maplibre-worker.ts:36` proves that this path never invokes the
Vite loader when the URL is already present. If an unsupported loader is
reached anyway, `maplibre-worker.ts:38-43` fails loudly and names the required
escape hatch. The base already had a bundler-dependent dynamic CSS import, and
the supported Vite dev/preview behavior is proven by CI. F1 therefore does not
remain a merge-blocking consumer-contract failure.

## F2 — low, non-blocking: late application URL plus invalid loader

`packages/geo-ui-svelte/src/maplibre-worker.ts:37-45` validates the loader
result before performing the second `getWorkerUrl()` check. If the helper starts
with no URL, the application calls `setWorkerUrl` while the loader is pending,
and that loader resolves to `undefined` (the unsupported-bundler case), the
helper throws instead of observing and preserving the now-valid application
URL. The pre-existing race test at
`packages/geo-ui-svelte/src/maplibre-worker.test.ts:30-37` only exercises a
loader that returns a valid string, so it does not catch this regression.

This is narrow and outside the documented normal setup (configure before the
helper starts), but it is a direct weakening of the helper's existing
"application-provided URL wins while loading" behavior. A follow-up should
re-check `getWorkerUrl()` before rejecting the loader result (and add the
corresponding test). It is not a security or supply-chain blocker.

# Verdict

GO-with-fixes. F1 is acceptably bounded and no blocking security, supply-chain,
or supported-Vite consumer defect remains. F2 is a small non-blocking race
regression to correct in a subsequent revision.
