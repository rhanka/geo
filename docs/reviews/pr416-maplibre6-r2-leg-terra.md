---
status: completed
reviewer-host: codex
reviewer-model: gpt-5.6-terra
reviewer-effort: high
target-ref: 100ac698513bd084357adbda6603a9ce1b232e25
lens: correctness + does-it-actually-reproduce
---

# Reasoning

Reviewed `cfeb58754011de16e401ae9860e54a580e375f2f...100ac698513bd084357adbda6603a9ce1b232e25`, with specific attention to the round-2 delta. The installed bytes are `maplibre-gl` 6.14.0. A direct ESM import reports `getWorkerUrl() === ""` before configuration and exposes the named `Map`, `getWorkerUrl`, and `setWorkerUrl` exports. Its distribution exports those functions from the same module-global worker configuration that `Map` uses.

The UI helper only contains type declarations at module evaluation; its `?url` import is deferred until `ensureMaplibreWorker` is called. Both consumers call it after the client-only `onMount` guard and before their first `new Map` (`packages/geo-ui-svelte/src/GeoMap.svelte:237-251`, `packages/geo-ui-svelte/src/GcpCalageUI.svelte:482-501`). Therefore SSR neither evaluates MapLibre nor resolves the worker asset. The helper preserves a non-empty application override, and its second read after awaiting the URL avoids a concurrent initializer overwriting an override (`packages/geo-ui-svelte/src/maplibre-worker.ts:27-34`).

The published UI package exports source (`packages/geo-ui-svelte/package.json:17-27`) rather than a prebuilt artifact, so the relevant consumer test is an actual consumer compilation. `npm run check` built `apps/site` successfully and emitted `_app/immutable/assets/maplibre-gl-worker.DxGNRm0a.mjs` (508.31 kB); this proves Vite resolves the source-level dynamic `maplibre-gl/dist/maplibre-gl-worker.mjs?url` import. `npm ls maplibre-gl --all` reports one deduplicated 6.14.0 copy for the engine, site, and UI peer.

The engine remains deliberately consumer-configured: its e2e sets the URL before `mount` creates a map (`packages/geo-map-engine/e2e/main.js:1-11`; `packages/geo-map-engine/src/mount.ts:61-73`), and the README states that contract and its hosting requirements (`packages/geo-map-engine/README.md:45-79`). This is compatible with the UI's self-initialization and avoids accidentally changing a consumer's explicit URL.

For the e2e, readiness is raised only from MapLibre's post-load idle callback (`packages/geo-map-engine/src/mount.ts:109-140`, `packages/geo-map-engine/e2e/main.js:119-121`), so a worker that cannot start cannot satisfy the initial wait by omission. Once ready, the test rejects zero workers and every worker URL that does not name the configured worker asset, then refetches each URL and requires HTTP 200 plus a JavaScript MIME (`packages/geo-map-engine/e2e/mount-e2e.mjs:60-82`). It runs this sequence for both a Vite dev server and an API-driven Vite production build served through `vite preview` (`packages/geo-map-engine/e2e/mount-e2e.mjs:15-47`). The `new URL("e2e/index.html", resolvedBase)` construction is valid for the trailing-slash local URLs returned by both Vite servers.

Read-only verification run:

- `npm run check`: passed (all workspaces; the site build emitted the hashed worker asset).
- `npm test`: passed (all reported suites; 4,017 passing tests and 7 documented skips; the site has no test files).
- `npm --workspace @sentropic/geo-map-engine run test:mount-e2e`: not executed to completion because this host lacks Playwright Chromium (`browserType.launch: Executable doesn't exist at /home/antoinefa/.cache/ms-playwright/chromium_headless_shell-1234/...`). It is not claimed as passing.

# Findings

1. **Non-blocking — browser proof unavailable on this host.**
   `packages/geo-map-engine/e2e/mount-e2e.mjs:13` launches Chromium before starting either scenario, and this checkout has no installed Playwright Chromium binary. Run the committed `test:mount-e2e` in CI or on a host provisioned with that pinned browser before merge. This is an environment limitation, not evidence of a source defect; static inspection shows the test covers both required hosting shapes and cannot pass with no worker.

No blocking correctness or reproducibility defect was found in the target diff.

# Verdict

**GO.** The round-2 worker initialization is ordered correctly, respects explicit consumer configuration, is SSR-safe, and the real `apps/site` build resolves the published-source `?url` worker asset. The Chromium e2e must still be run in a provisioned environment; it was unavailable locally and has not been represented as a pass.
