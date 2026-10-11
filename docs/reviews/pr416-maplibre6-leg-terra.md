---
status: failed
reviewer-host: codex
reviewer-model: gpt-5.6-terra
reviewer-effort: high
target-ref: 3c311bc23fd280d6137bc4f33577b7a442369b8a
lens: correctness + does-it-actually-reproduce (runtime MapLibre 6 behaviour, worker loading, API/type drift)
observed-failure: >-
  Not launched. h2a_run refused 5 attempts (identity_pending -> identity_failed, cause
  identity_timeout, retryable) on 2026-10-11. Fallback dispatch through the Codex plugin runtime
  (codex-companion) was refused before execution by the PreToolUse:Bash hook
  "Commande ad-hoc rejetee -- utilise un script committe". No verdict exists for this leg.
---
