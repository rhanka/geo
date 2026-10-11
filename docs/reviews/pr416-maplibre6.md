---
status: incomplete
observed-failure: >-
  Both Codex legs failed to launch (h2a identity_timeout x5; codex-companion fallback blocked by
  the committed-scripts Bash hook). No consensus verdict.
review-author:
  host: claude
  model: claude-sonnet-5-5 (ad163ff) + claude-opus-5-5 (3c311bc)
  effort: low
target-ref: 3c311bc23fd280d6137bc4f33577b7a442369b8a (diff cfeb5875...3c311bc, PR #416)
legs:
  - path: docs/reviews/pr416-maplibre6-leg-terra.md
    status: failed
  - path: docs/reviews/pr416-maplibre6-leg-luna.md
    status: failed
---

# Review dossier — PR #416 maplibre-gl >= 6.4.1

Scope: make `@sentropic/geo-map-engine` and `@sentropic/geo-ui-svelte` compatible with
`maplibre-gl ^6.4.1` (immo security fix #854). Named imports, ranges, lockfile, MapLibre 6
module-worker contract (`setWorkerUrl`), e2e diagnostics.

Selection: author host `claude` → Codex-hosted legs only, models distinct from the author's
(`gpt-5.6-terra`, `gpt-5.6-luna`), declared/requested ids only (no effective-identity attestation).

Dispatch deviation: `h2a_run` refused 4 launches with `identity_pending` → `identity_failed`
(`identity_timeout`, retryable) on 2026-10-11 (5 attempts). A fallback dispatch through the Codex
plugin runtime (`codex:codex-rescue` → codex-companion) was refused before execution by the
PreToolUse:Bash hook (committed scripts only). The hook was not bypassed. Neither leg ran.

CI on the target: `verify` run 38180787735 = success on 3c311bc, including
`Mount e2e (real MapLibre and Chromium)`.

## Reconciliation

None: no completed leg. Review must be re-dispatched once h2a identity is ready.
