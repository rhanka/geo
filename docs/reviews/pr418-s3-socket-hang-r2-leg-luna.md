---
status: completed
reviewer-host: codex
reviewer-model: gpt-5.6-luna
reviewer-effort: high
target-ref: 6b25d9a01cfd631a5ecb4492e617b376859b87b8
lens: resilience + security + operations
---

# Reasoning

I reviewed the full PR diff from `c592d88342523443ea1a5945c841f883d8c74e98` to
`6b25d9a01cfd631a5ecb4492e617b376859b87b8`, and the round-2 delta from
`b68b91157b4330351efdea85d36e8a13dac33f1b`, excluding review documents except
as context. I traced `/health`, `/items`, the règlement stream, `StoreProvider`,
`Store`, and `S3Store`, then checked the Kubernetes manifests and all in-repo
`Store` implementations.

The claimed fixes are partly real. `/health` now has single-flight and a
10-second verdict cache (`packages/geo/src/api/app.ts:183-205`), public errors
are reduced to stable codes (`:193-198`, `:227-229`), and `S3Store.get()` now
uses the body guard (`packages/geo/src/storage/s3-store.ts:103-115`). The
signal reaches an already-indexed `getStream()` shape read
(`packages/geo/src/api/providers/store-provider.ts:231-243`), and the new
socket-release tests pass.

Verification in this worktree passed: the geo workspace test command ran 50
files / 539 tests, the geo typecheck passed, and `git diff --check` reported no
errors. Those tests do not cover a cold, stalled index operation or a client
disconnect while the served S3 iterator is already awaiting its next chunk.
As an additional runtime check, calling `return()` on an outer async generator
while its delegated source `next()` is permanently pending remained pending;
the delegated source's `return()` was not called. That is the relevant behavior
of the lazy served stream here.

# Findings

## F1 — blocking — the health deadline still does not cancel all S3 work

The route's response deadline races `runProbe(check)` and returns a timeout at
`packages/geo/src/api/app.ts:216-224`, but the controller only reaches the
shape `getStream()` call after `StoreProvider.#ensureIndexed()` completes.
Indexing performs `list()` at `packages/geo/src/api/providers/store-provider.ts:87-103`
and manifest/metadata `get()` calls at `:105-107` and `:138-145`; none accepts or
uses the health signal. A cold health request can therefore return 503 while
the S3 list/get operation continues. If that check never settles, the
single-flight promise remains in `inFlight` because it is cleared only in
`app.ts:199-203`; later health requests all race the same permanently pending
promise and never start a fresh probe.

The regression tests pre-index before the hanging probe
(`packages/geo/src/api/health.test.ts:64-69` and `:88-93`), so they do not
establish cancellation of the first real health request. This leaves the
claimed cancellation guarantee incomplete and can retain an S3 operation during
the exact failure that `/health` is intended to detect.

## F2 — blocking — `/items` client aborts are not propagated to the S3 body

`releaseOnAbort()` calls `return()` on the parser iterator at
`packages/geo/src/api/app.ts:454-460`, and it is attached to the streamed items
response at `:499-506`. However, the parser delegates to
`StoreProvider.#lazyStream()` (`packages/geo/src/api/providers/store-provider.ts:204-221`),
which calls `#getStream()` without a signal. The underlying S3 body therefore
has no request-abort path. If it is already waiting in `next()`, the outer
iterator's `return()` does not complete until that pending read settles, as
confirmed by the runtime check above. The only remaining release is the
120-second idle timer at `packages/geo/src/storage/s3-store.ts:315-322`, which
still allows enough abandoned bodies to exhaust the 50-socket pool
(`:63-71`).

The new real-Node test only disconnects during validation and asserts that the
second, served body is never opened (`packages/geo/src/api/items-client-abort.test.ts:30-65`).
It does not cover a disconnect after the served body has opened and its next
chunk is pending. The hotfix therefore still has a delayed socket-leak path.

## F3 — non-blocking hardening — abort listeners are not removed on normal completion

`idleGuardedStream()` installs a `{ once: true }` listener at
`packages/geo/src/storage/s3-store.ts:306-309`, but its normal `finally` only
clears the timer and destroys the body at `:330-333`; it never calls
`removeEventListener`. Likewise, `releaseOnAbort()` installs listeners at
`packages/geo/src/api/app.ts:454-460` without cleanup when the response finishes
normally. `once` removes a listener only after abort, not after successful
completion. With a long-lived or reused signal, each completed stream retains
its body/iterator closure until abort and can accumulate listeners. Typical
request-scoped signals reduce the practical impact, so this is non-blocking for
the immediate hotfix, but the new cancellation contract should include normal
cleanup.

## F4 — non-blocking for this hotfix — the probe deferral is acceptable, but the
operational blind spot remains

The Kubernetes liveness and readiness probes still use `/conformance` in
`deploy/k8s/base/deployment.yaml:53-72` and
`deploy/k8s/geo-api-deployment.yaml:52-71`. This is still wrong for incident
detection: a dead S3 read path can leave both probes green. I accept the stated
deferral for a hotfix whose explicit goal is releasing leaked sockets, because
wiring restart/readiness behavior to an external S3 dependency is an owner
decision. Before wiring it, the owner must align the Kubernetes probe timeout
with the 5-second application deadline and decide whether an external S3 outage
should restart pods or only mark them unready.

## F5 — non-blocking compatibility issue — legal legacy `Store` implementations
fail the new deep health check

`Store.getStream` remains optional specifically for source compatibility at
`packages/geo/src/storage/store.ts:32-44`, and `StoreProvider.#getStream()` has a
`get()` fallback at `packages/geo/src/api/providers/store-provider.ts:154-160`.
But `checkHealth()` bypasses that helper and calls
`this.#store.getStream?.(...)` directly at `:231-237`. A valid `Store` that only
implements `get()` therefore continues to serve ordinary items through the
fallback but always reports `/health` as `shape unreadable`. This is not a
TypeScript breaking change—one-argument `getStream` implementations remain
assignable, and the typecheck is clean—but it is a behavior regression for
existing stores. `GetStreamOptions` is also not re-exported by
`packages/geo/src/storage/index.ts:13`, making the new public option harder for
consumers to use by name.

## F6 — non-blocking deferred hardening — retries and limits

The deployed read client receives connection/request timeouts in
`packages/geo/src/api/server.ts:42-54`, but no explicit retry budget, request
rate limit, or concurrency policy is added. The SDK's retry behavior can still
multiply a 20-second request bound, and 50 active slow consumers can compete
with ordinary reads. This remains a valid follow-up and matches the author's
explicit F6 deferral; it does not by itself refute the socket-release change.

## Other requested checks

The new `/health` endpoint is a public surface under the existing wildcard CORS
middleware (`packages/geo/src/api/app.ts:114-123`). The cache/single-flight
implementation removes the previous per-request S3 amplification, and the
response no longer exposes transport/bucket details. I therefore treat the
surface as intentional but worth owner confirmation, not as a blocking security
finding for this hotfix.

The `Store` interface change does not alter writers. `put()` remains unchanged;
the timeout options are supplied from the API server's read-side factories,
while acquisition callers continue to construct stores without those options.
No writer regression was found in the diff or tests.

# Verdict

NO-GO. The cache, generic health reasons, guarded `get()`, and indexed-shape
abort path are useful and verified, and deferring Kubernetes probe wiring is
acceptable for the narrowly stated socket-release hotfix. However, cold health
indexing can outlive its deadline, and an `/items` client disconnect after the
served S3 body has opened can still leave the body pending until the 120-second
guard. Those two blocking paths leave the incident's socket-exhaustion failure
mode insufficiently closed.
