---
status: completed
reviewer-host: codex
reviewer-model: gpt-5.6-luna
reviewer-effort: high
target-ref: 00d0eff7caf97f3fb16a55b5a64ac993e8718d1b
lens: resilience + security + operations
---

# Reasoning

I reviewed the full PR diff from `c592d88342523443ea1a5945c841f883d8c74e98` to
`00d0eff7caf97f3fb16a55b5a64ac993e8718d1b`, and the round-3 delta from
`6b25d9a01cfd631a5ecb4492e617b376859b87b8`. The target tree was committed and
clean. I inspected the installed `@smithy/node-http-handler` 4.7.8 and
`@hono/node-server` 2.1.0.

The round-2 blocking fixes are present. `/items` passes the request signal into
`FeatureProvider.streamItems()` and both validation and served `getStream()` calls
(`packages/geo/src/api/app.ts:309-315`, `packages/geo/src/api/providers/store-provider.ts:194-230`).
The règlement route passes the same signal to `streamPdf()`
(`packages/geo/src/api/app.ts:427-438`), and the S3 adapter passes it to Smithy's
`abortSignal` as well as to the body guard (`packages/geo/src/storage/s3-store.ts:143-152`).
The real Node-adapter regression test covers a client disconnect after the served
body has opened and while its next chunk is pending
(`packages/geo/src/api/items-client-abort.test.ts:74-121`).

`/health` now has one shared probe, a deadline race, and a verdict cache including
timeout verdicts (`packages/geo/src/api/app.ts:173-225`). The timeout settles the
shared promise and clears its slot even if the provider promise never settles. A
warm `StoreProvider` probe aborts the underlying S3 request/body; cold indexing is
deduplicated by `#ensureIndexed()` and its S3 body reads are guarded
(`packages/geo/src/api/providers/store-provider.ts:87-115, 240-254`). Public
responses expose only stable reason codes, while details are logged server-side
(`packages/geo/src/api/app.ts:200-205, 223-225`).

The S3 body guard covers an unconsumed body, a stalled next chunk, a held chunk,
abort, and early iterator return (`packages/geo/src/storage/s3-store.ts:304-357`).
For the real Node handler, the configured agents use 50 sockets
(`node_modules/@smithy/node-http-handler/dist-cjs/index.js:407-433`), and the
20-second request timeout is installed before the request is dispatched
(`node_modules/@smithy/node-http-handler/dist-cjs/index.js:287-380`). That bounds
header/queue waits; the body-phase bound comes from the application guard, not
Smithy's request timeout.

Operationally, a cold data index can issue at most 32 concurrent metadata
`get()` calls (`packages/geo/src/api/providers/store-provider.ts:52, 105-121`).
If headers arrive and bodies then stall, the `get()` guard can retain those bodies
for up to 120 seconds. A served stream can retain one socket per client-held
chunk for up to the default 600 seconds (`packages/geo/src/storage/s3-store.ts:75-85`).
These are finite bounds, and request aborts release the served path immediately;
I found no remaining unbounded S3-body retention in the Node production path.

The required verification passed:

- `npm test --workspace @sentropic/geo`: 50 files, 542 tests passed.
- `npm run check --workspace @sentropic/geo`: passed.
- `git diff --check`: passed.

The deployment path is compatible with this hotfix. A merge to `main` touching
`packages/geo/**` triggers the automatic `cd-preprod` build and rollout
(`.github/workflows/cd-preprod.yml:24-31,65-149`). Production remains a manual
workflow behind the `geo-prod` required-reviewer environment
(`.github/workflows/cd-prod.yml:3-25,35-45`). Kubernetes probes remain on static
`/conformance` (`deploy/k8s/base/deployment.yaml:53-71`); I accept that explicit
deferral for this socket-release hotfix because changing restart/readiness
semantics for an external S3 dependency is an owner decision.

# Findings

## F1 — non-blocking compatibility — `GetStreamOptions` is not exported by the public storage barrel

`GetStreamOptions` is declared as the new public option type in
`packages/geo/src/storage/store.ts:19-26`, and `Store.getStream()` uses it at
`packages/geo/src/storage/store.ts:38-44`. However, the package barrel exports
only `ByteStream`, `PutOptions`, and `Store`
(`packages/geo/src/storage/index.ts:13`), so consumers of the supported
`@sentropic/geo/storage` entry point cannot import the type by name. The round-2
reconciliation says this was fixed, but the target commit does not modify that
barrel. Existing implementations remain source-compatible because `getStream`
is optional and the second parameter is optional; this is therefore not a
blocking runtime or writer regression. Re-export `GetStreamOptions` to complete
the public contract.

## F2 — non-blocking operations hardening — finite body bounds still permit pool starvation

The default `bodyHoldTimeoutMs` is 600 seconds and applies while a consumer holds
one yielded chunk (`packages/geo/src/storage/s3-store.ts:78-85, 346-357`). Thus 50
connected clients can occupy the explicit 50-socket pool for up to ten minutes
(`node_modules/@smithy/node-http-handler/dist-cjs/index.js:407-433`). The
20-second `requestTimeout` does not cover an already-returned response body, so
it does not shorten this hold; it only bounds queued/header work. This is no
longer the original unbounded leak, and client aborts release bodies immediately,
so I classify it as non-blocking for this hotfix. The deferred retry, admission,
and slow-client policy should set an intentional capacity/SLO rather than relying
on the 10-minute default.

## F3 — non-blocking listener cleanup edge — an abandoned never-started guard does not enter `finally`

`idleGuardedStream()` installs the abort listener and arms the idle timer before
returning the async generator (`packages/geo/src/storage/s3-store.ts:323-345`).
If a caller obtains the stream and never starts iteration, the generator's
`finally` (`:346-357`) does not run. The idle timer still destroys the body, but
the abort listener is not removed by that path. In the HTTP paths under review,
the request signal is request-scoped and either aborts or the adapter consumes the
stream, so this does not retain an S3 socket or block the hotfix. It is a small
listener-lifetime gap worth covering with a direct unconsumed-stream cleanup test.

# Verdict

GO-with-fixes. No blocking finding remains: the public health route is
single-flight/cached, its timeout settles independently of a non-cooperative
provider, public error details are sanitized, and the real Node S3 paths release
on client abort or bounded body/hold time. Address F1, and document/measure F2's
capacity policy before treating the hotfix as fully hardened. The Kubernetes
probe wiring may remain an owner-gated follow-up.
