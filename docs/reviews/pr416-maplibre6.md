---
status: completed
review-author:
  host: claude
  model: claude-sonnet-5-5 (ad163ff) + claude-opus-5-5 (3c311bc and later fixes)
  effort: low
target-ref: 1641a453e99278d6ae9f2472b2600ab24eafef1e (final reviewed; diff cfeb5875...1641a45, PR #416)
legs:
  - path: docs/reviews/pr416-maplibre6-leg-terra.md
    status: completed
  - path: docs/reviews/pr416-maplibre6-leg-luna.md
    status: completed
  - path: docs/reviews/pr416-maplibre6-r2-leg-terra.md
    status: completed
  - path: docs/reviews/pr416-maplibre6-r2-leg-luna.md
    status: completed
  - path: docs/reviews/pr416-maplibre6-r3-leg-luna.md
    status: completed
consensus-verdict: GO — terra GO on 100ac69 (r2), luna GO-with-fixes on 1641a45 (r3); no blocking finding left; luna r3 F2 (non-blocking) fixed after review
---

# Review dossier — PR #416 maplibre-gl >= 6.4.1

Scope: make `@sentropic/geo-map-engine` and `@sentropic/geo-ui-svelte` compatible with
`maplibre-gl ^6.4.1` (immo security fix #854). Named imports, ranges, lockfile, MapLibre 6
module-worker contract (`setWorkerUrl`), e2e diagnostics.

Selection: author host `claude` → Codex-hosted legs only, models distinct from the author's
(`gpt-5.6-terra`, `gpt-5.6-luna`), declared/requested ids only (no effective-identity attestation).

Dispatch: `h2a_run` was unavailable (`identity_pending` → `identity_failed`, `identity_timeout`,
retryable, 6 attempts on 2026-10-11); the codex-companion fallback was refused by the
committed-scripts Bash hook (not bypassed). On owner instruction, both legs then ran as
`codex exec -C <worktree> -m <model> -c model_reasoning_effort=high --sandbox workspace-write`
(the `codex` leader is allowlisted by the hook), blind, with the prompt files kept in the session
scratchpad. Requested model/effort only; effective identity not attested.

CI on the round-1 target: `verify` run 38180787735 = success on 3c311bc, including
`Mount e2e (real MapLibre and Chromium)`.

## Reconciliation (round 1, target 3c311bc)

| Finding | Legs | Classification | Rationale / resolution |
| --- | --- | --- | --- |
| UI constructs MapLibre maps without worker initialization (`GeoMap`, `GcpCalageUI`, used by `apps/site`) | terra (blocking) + luna F1 (blocking) | **accept** | Verified: `getWorkerUrl()` defaults to `""` in 6.14.0 and no UI path called `setWorkerUrl`. Fixed: `geo-ui-svelte/src/maplibre-worker.ts` `ensureMaplibreWorker` (sets the Vite `?url` worker only when none is configured), called by both components before the first `Map`, exported for mixed engine+UI apps; unit tests in `maplibre-worker.test.ts` (incl. the real `?url` resolution). |
| Worker contract incomplete for production hosting (MIME, hashing, CSP, cross-origin); e2e only covers Vite dev | luna F2 (blocking); terra asks for a production build check | **accept** | README now states the hosting requirements (self-contained module, JS MIME + 200, same-origin `worker-src 'self'`, cross-origin `blob:` + CORS, single copy), checked against the 6.14.0 worker-creation code. `mount-e2e.mjs` now runs in dev AND against a `vite build` served by `vite preview`, asserting every running worker is the configured `maplibre-gl-worker*.mjs` asset served 200 with a JavaScript MIME. |
| Svelte-consumer real-browser test | terra (part of blocking finding) | **defer** | `apps/site` production build now compiles the UI `?url` import (`npm run check` green), and the worker contract is browser-proven through the engine e2e in dev + preview. A dedicated Svelte real-browser e2e remains to add; immo's receipt (handoff step 1) covers GeoView/Cadastre in a production stack. |

Non-findings agreed by both legs: no residual 5.x / <=6.4.0, single 6.14.0 copy, no default
import left, named imports in the packed engine dist, `setPaintProperty` cast confined to the
internal boundary, attribution paths sanitized/text-only, geo-core `^0.6.0` compatible with a
pinned 0.6.1.

## Round 2 (target 100ac69)

CI `verify` run 38201424965 = success on 100ac69; its `Mount e2e` step logged
`mount e2e [dev] OK — worker 200 text/javascript …/maplibre-gl/dist/maplibre-gl-worker.mjs` and
`mount e2e [preview] OK — worker 200 text/javascript …/assets/maplibre-gl-worker-DxGNRm0a.mjs`.

| Finding | Leg | Classification | Rationale / resolution |
| --- | --- | --- | --- |
| Browser proof not available on the reviewer host | terra (non-blocking) | **accept → resolved** | CI run 38201424965 above: real Chromium, dev + production preview, worker 200 + JS MIME. |
| Published UI default is Vite-only (`?url`); a non-Vite consumer could reach `setWorkerUrl(undefined)` | luna F1 (blocking) | **partial accept** | Accepted: explicit failure + documented non-Vite path (application calls `setWorkerUrl` first; the default is then never reached) — commit 1641a45. Rejected: full bundler neutrality — the UI already ships Svelte source and already relied on the bundler for `import("maplibre-gl/dist/maplibre-gl.css")` on main (confirmed by luna r3); immo builds with Vite 6. |

terra r2 verdict: GO. luna r2 verdict: NO-GO (F1), re-reviewed in round 3.

## Round 3 (target 1641a45, luna only)

luna r3: F1 "acceptably bounded (non-blocking)"; new F2 (low, non-blocking): an application URL set
while an unresolvable loader is pending was rejected instead of kept. **accept → fixed** in the
follow-up commit (re-check `getWorkerUrl()` before validating the loader result, + unit test).
luna r3 verdict: GO-with-fixes.

## Residual (not blocking, tracked)

- Dedicated real-browser e2e of a Svelte consumer (`GeoMap`) in a production build — the worker
  contract is browser-proven through the engine e2e (dev + preview) and the `apps/site` production
  build emits the hashed worker; immo's receipt (handoff step 1) exercises GeoView/Cadastre in a
  production stack.
- Non-Vite bundlers: supported only through an application-provided `setWorkerUrl` (documented).
