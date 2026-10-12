---
status: completed
reviewer-host: codex
reviewer-model: gpt-5.6-luna
reviewer-effort: high
target-ref: b68b91157b4330351efdea85d36e8a13dac33f1b
lens: resilience + security + operations
---

# PR #418 review

## Reasoning

The changed read path was reviewed from the HTTP route through `FeatureProvider`,
`StoreProvider`, `S3Store`, and the règlement provider. I also checked the active
Kubernetes overlays and the image/deploy workflows, and ran the targeted workspace
tests, typecheck, and build.

The stream wrapper correctly destroys a Node S3 body after inactivity and on normal
iterator close. The lazy served stream also avoids opening its second S3 body until
the response is pulled. `getItem()` and the normal items path drain their async
generators, and règlement downloads use the same guarded S3 stream. Current
acquisition/CLI call sites use `put`, `get`, `list`, or `has`; they do not use
`getStream`, so the new stream default does not alter their current write path.
FileProvider is filesystem-backed and PostGIS uses a separate `pg.Pool` path.

However, the deep health endpoint is unauthenticated, wildcard-CORS enabled, and
its timeout is only a response-level race. The S3 operation continues after the
endpoint has returned 503. In addition, the generic body guard is not applied to
`S3Store.get()`, which remains used for metadata/index reads. These are material
gaps for the incident being fixed.

Verification performed:

- `npm test --workspace @sentropic/geo` (including the new tests): 532 tests passed.
- `npm run check --workspace @sentropic/geo`: passed.
- `npm run build --workspace @sentropic/geo`: passed.
- The installed AWS SDK resolves the supplied request-handler options to a
  `NodeHttpHandler` with `handle`; its default max-attempt behavior remains in
  effect because this PR does not set `maxAttempts`.

## Findings

### F1 — blocking — public `/health` is an uncapped S3 amplification endpoint

`createApp` applies `cors()` to every route except `/basemap/2d`, which gives the
new route wildcard CORS at `packages/geo/src/api/app.ts:104-113`. The route is
public and invokes `provider.checkHealth()` for every request at
`packages/geo/src/api/app.ts:163-180`. `StoreProvider.checkHealth()` selects one
indexed shape, calls `getStream`, and pulls its first chunk at
`packages/geo/src/api/providers/store-provider.ts:224-243`.

Consequently an unauthenticated caller can generate one S3 `GetObject` per health
request (and a cold first request also causes the provider's index/list and
metadata reads). There is no rate limit, concurrency cap, cache, or internal-only
guard. The client can repeatedly spend S3 requests and occupy the shared pool of
50 sockets configured at `packages/geo/src/storage/s3-store.ts:68-71` and
`packages/geo/src/storage/s3-store.ts:198-203`. This is especially unnecessary
because the Kubernetes probes still use `/conformance`, not `/health` (F4).

### F2 — blocking — the 5-second health deadline does not cancel the S3 work

The route races `provider.checkHealth()` against a timer and returns from the
handler when the timer wins at `packages/geo/src/api/app.ts:171-192`; no
`AbortSignal` is passed to the provider. `StoreProvider.checkHealth()` directly
calls the store and then reads the iterator at
`packages/geo/src/api/providers/store-provider.ts:229-241`. `S3Store.getStream()`
creates `GetObjectCommand` without an abort signal at
`packages/geo/src/storage/s3-store.ts:124-130`.

Thus a hung header read survives the 5-second response deadline. In the deployed
server it can remain in the SDK retry/request machinery for the configured
20-second request timeout per attempt (`packages/geo/src/api/server.ts:42-46`),
and the default retry policy can multiply that duration. Under repeated public
health calls, 503 responses therefore do not mean the underlying work has been
released; queued/in-flight work can still exhaust the same pool and add memory
pressure. The deadline must cancel the provider/S3 operation, or the endpoint
needs bounded single-flight/concurrency semantics that preserve cancellation.

### F3 — blocking — `/health` serializes raw provider/S3 error text to unauthenticated clients

The 503 body copies `error.message` or `String(error)` into JSON at
`packages/geo/src/api/app.ts:181-189`. `StoreProvider.checkHealth()` only creates
its own messages for empty/missing shapes; errors from the direct store call are
not sanitized at `packages/geo/src/api/providers/store-provider.ts:234-241`, and
`S3Store.getStream()` rethrows non-404 errors at
`packages/geo/src/storage/s3-store.ts:130-134`.

That exposes SDK/transport error text through a public wildcard-CORS endpoint.
Depending on the failure, the text can contain endpoint/host, request details,
bucket/key context, or other internal diagnostics. The response should contain a
stable generic reason/code; detailed errors belong in server-side logs/metrics.

### F4 — blocking for the stated incident-detection objective — the live probes remain static

The PR changes application/storage code only; it does not change the manifests.
The active S3 serving base keeps both liveness and readiness on `/conformance` at
`deploy/k8s/base/deployment.yaml:53-71`. The other checked-in deployment line
also keeps both probes on `/conformance` at
`deploy/k8s/geo-api-deployment.yaml:52-71`, while the repository README identifies
the `base`/overlay line as the current CD path at `deploy/k8s/README.md:6-13`.

The image build and post-merge preprod rollout are otherwise identifiable:
`.github/workflows/cd-preprod.yml:4-9,104-149` builds/pushes an immutable digest
and applies the preprod overlay; `Makefile:9-17` renders/applies it. But that
rollout leaves the exact blind spot described by the incident: a broken S3 read
path still reports healthy to Kubernetes. Either wire a bounded, cancellation-safe
health check into the relevant probes (with probe timeout compatible with its
deadline), or explicitly document and implement an internal monitoring path.

### F5 — blocking — `S3Store.get()` still has no body-idle protection

The new idle guard is only applied in `getStream()` at
`packages/geo/src/storage/s3-store.ts:124-130`. `get()` still passes the raw body
to `bodyToBytes()` at `packages/geo/src/storage/s3-store.ts:107-114`. The server's
20-second request timeout is a header/request timeout, and the provider uses
`get()` for `coherence.json` and metadata while indexing at
`packages/geo/src/api/providers/store-provider.ts:105-146`. The règlement factory
also loads its registry through `store.get()` at
`packages/geo/src/api/providers/make-reglement-provider.ts:44-60,72-76`.

If S3 sends response headers and then stalls the body, the `get()` consumer can
wait indefinitely and retain the response/socket; the new `getStream()` guard does
not cover this path. This can hang first indexing (including `/collections` and
the first health call) and is a remaining variant of the incident. Apply a body
deadline/abort-and-destroy policy to all `GetObject` bodies, or make all API body
reads use the guarded stream abstraction.

### F6 — non-blocking hardening — timeout/retry and slow-consumer capacity should be explicit

The API opts into `connectionTimeoutMs: 5_000` and `requestTimeoutMs: 20_000` at
`packages/geo/src/api/server.ts:42-46`, but does not set an explicit S3
`maxAttempts`. A timeout can therefore be retried by the SDK before the caller
sees failure. Separately, a `getStream()` body is allowed to remain live while a
consumer continues pulling; the idle guard is 120 seconds at
`packages/geo/src/storage/s3-store.ts:62-68`, and the client pool is capped at 50
at `packages/geo/src/storage/s3-store.ts:68-71`.

This is bounded compared with the old infinite hang, and the explicit pool values
match the installed SDK defaults; I found no evidence in this diff alone of an
immediate OOM or a writer regression. Nevertheless, 50 slow-but-not-idle HTTP
clients can starve ordinary reads, and a retry budget multiplied by 20 seconds
can make recovery slow. After F1/F2/F5 are fixed, set and document the intended
`maxAttempts`, request concurrency/rate limits, and slow-client policy.

## Verdict

NO-GO. The implementation contains useful socket-release and lazy-stream work,
but the public health route can amplify S3 traffic, its deadline leaves timed-out
operations running, it exposes raw error text, the live probes do not use it, and
`S3Store.get()` retains an unguarded body path. The blocking findings must be
resolved and re-tested under aborted/hung header and post-header body scenarios
before merge.
