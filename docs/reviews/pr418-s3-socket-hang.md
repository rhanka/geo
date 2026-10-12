---
status: completed
review-author:
  host: claude
  model: claude-opus-5-5
  effort: low
target-ref: b68b91157b4330351efdea85d36e8a13dac33f1b (round 1, diff c592d883...b68b911, PR #418)
legs:
  - path: docs/reviews/pr418-s3-socket-hang-leg-terra.md
    status: completed
  - path: docs/reviews/pr418-s3-socket-hang-leg-luna.md
    status: completed
consensus-verdict: NO-GO on b68b911 (2/2); accepted blocking findings fixed in the round-2 commit; round 2 re-review required
---

# Review dossier — PR #418 geo-api S3 socket leak (hotfix)

Incident 2026-10-12 13:50-14:16 UTC: `/collections/<id>/items` hung for every city while
`/collections` answered; fixed operationally by `rollout restart`. Root cause: S3 GetObject bodies
neither drained nor destroyed pin pooled sockets (pool 50, no client timeouts); a client leaving
during the `/items` validation pass left the already-opened served body open forever
(`@hono/node-server` 2.1.0 never cancels a response whose writable is already destroyed).

Selection: author host `claude` → Codex-hosted legs (`gpt-5.6-terra`, `gpt-5.6-luna`), blind,
dispatched with `codex exec` (h2a identity unavailable in this session). Requested model/effort
only; effective identity not attested.

## Reconciliation (round 1, target b68b911)

| Finding | Leg | Classification | Rationale / resolution |
| --- | --- | --- | --- |
| `/health` deadline does not cancel the S3 read; a stalled body stays open | terra F1, luna F2 (blocking) | **accept → fixed** | `Store.getStream(key, { signal })`; `S3Store` passes it as the SDK `abortSignal` (kept until request close, so it also destroys an open body) and destroys the body on abort; the shared probe aborts at its own deadline. Test: a stalled first chunk is released at the deadline. |
| 120 s idle guard kills legitimate slow-client downloads (backpressure) | terra F2 (blocking) | **accept → fixed** | The guard is now suspended while the consumer holds a chunk; it only bounds a never-iterated body and S3-side stalls. Abandonment while consuming is handled by cancellation (adapter cancel + `releaseOnAbort`). Tests: slow consumer kept past the bound; S3 stall while awaiting a chunk fails instead of hanging. |
| Public `/health` = uncapped S3 amplification | luna F1 (blocking) | **accept → fixed** | Single-flight probe + verdict cache (10 s): at most one GetObject per window whatever the call rate. Test: 6 calls → 1 read; hanging read → 3 calls, 1 read. |
| `/health` exposes raw S3/transport error text | luna F3 (blocking) | **accept → fixed** | Stable public codes `shape-read-failed` / `shape-read-timeout`; detail logged server-side only. Test asserts no error text in the body. |
| `S3Store.get()` body unguarded (index/meta/registry reads) | luna F5 (blocking) | **accept → fixed** | `get()` consumes through the same guard. Test: body stalling after headers fails instead of hanging. |
| k8s probes still on static `/conformance` | luna F4 (blocking for detection) | **defer (owner decision)** | Wiring liveness/readiness to `/health` is an explicit, not-yet-taken owner decision (restart also on external S3 outage). `/health` is ready for it. |
| Smithy `socketTimeout` narrative inaccurate | terra F3 (non-blocking) | **accept → corrected** | Below 6 s it registers on the socket at once and covers the body; at ≥ 6 s registration is deferred 3 s and that timer is cleared at response, so fast responses get no body bound. No `socketTimeout` was configured before anyway. PR description corrected. |
| No end-to-end test through the real Node adapter | terra (coverage note) | **accept → added** | `items-client-abort.test.ts`: real `@hono/node-server`, client destroyed mid-validation → served body never opened. Red-checked: with an eager served stream the test fails (2 opens). |
| Explicit `maxAttempts`, concurrency/slow-client policy | luna F6 (non-blocking) | **defer** | Bounded vs. the previous infinite hang; SDK default retries kept. To document with the probe decision. |

Verification on the round-2 commit: `npm test --workspace @sentropic/geo` 50 files / 539 tests;
`npm run check --workspace @sentropic/geo` clean.

## Round 2

Pending.
