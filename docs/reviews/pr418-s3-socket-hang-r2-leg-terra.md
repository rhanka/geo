---
status: failed
observed-failure: "npm test --workspace @sentropic/geo on 6b25d9a01cfd631a5ecb4492e617b376859b87b8: src/api/health.test.ts > keeps a single in-flight read while it hangs: expected one zones.geojson read, received three."
reviewer-host: codex
reviewer-model: gpt-5.6-terra
reviewer-effort: high
target-ref: 6b25d9a01cfd631a5ecb4492e617b376859b87b8
lens: correctness + does-it-actually-reproduce
---

# Reasoning

I reviewed the full PR diff (`c592d88342523443ea1a5945c841f883d8c74e98...6b25d9a01cfd631a5ecb4492e617b376859b87b8`) and the round-2 delta, excluding `docs/reviews/*` except for the reconciliation. I inspected the installed `@smithy/node-http-handler` 4.7.8 and `@hono/node-server` 2.1.0.

The round-1 health-body fix is correct for the concrete `S3Store` path: `StoreProvider.checkHealth()` forwards its signal to `Store.getStream()` (`packages/geo/src/api/providers/store-provider.ts:231-244`), and `S3Store` supplies it as Smithy's `abortSignal` and also gives it to the body guard (`packages/geo/src/storage/s3-store.ts:126-135`). In Smithy 4.7.8, the response body is the Node response (`node_modules/@smithy/node-http-handler/dist-cjs/index.js:345-352`); its abort listener calls `req.destroy()` and remains installed until request close (`:362-372`). Thus aborting after headers does release an actual S3 body.

The target's test suite is nevertheless red: `npm test --workspace @sentropic/geo` produced 49 passing files / 538 passing tests and one failure in `health.test.ts:100`, which expected one hung read and observed three. `npm run check --workspace @sentropic/geo` passed. The focused items-abort and S3 guard tests passed, but do not cover the blocking served-body case below.

# Findings

## F1 — blocking — `/health` does not maintain its advertised single-flight/cache invariant when cancellation is ignored

`/health` races a request-local deadline against `runProbe()` (`packages/geo/src/api/app.ts:216-224`), but the latter records the cache and clears `inFlight` only after `check()` itself settles (`:191-203`). A provider or cold indexing step that ignores its signal therefore leaves the underlying probe outside the endpoint deadline and cannot establish the promised timeout verdict/cache itself. This is a real supported shape: `Store.getStream` says signal honouring is optional, while the round-2 test double deliberately never settles (`packages/geo/src/api/health.test.ts:26-43,88-100`).

More importantly, the target's own regression test for this invariant fails reproducibly: three sequential `/health` calls produce three `zones.geojson` openings instead of the single opening required by `:100`. The public endpoint therefore cannot be accepted as protected against probe amplification. Make the *shared* probe race its own deadline, abort it, cache that timeout verdict, and clear the single-flight slot even if the provider promise never settles; test both a signal-aware open body and a signal-ignoring/cold-index provider.

## F2 — blocking — a served S3 body can still retain its socket after client abort, and indefinitely while a consumer holds a chunk

The new guard deliberately disarms before yielding a source chunk and rearms only after the consumer asks for the next one (`packages/geo/src/storage/s3-store.ts:322-333`). Consequently, a consumer which holds that chunk forever has neither a timer nor necessarily an abort signal. This is reachable through HTTP backpressure: a connected client can stop reading without closing its request, so `c.req.raw.signal` does not abort. Fifty such responses can again occupy the 50-socket S3 pool indefinitely. The slow-client requirement rules out silently retaining the prior 120-second cut-off, but it does not make an unbounded pool-retention path safe; an explicit bounded download/concurrency policy is needed.

There is a second, shorter but still blocking retention path after the served pass has opened. `releaseOnAbort()` only calls `iterator.return()` (`packages/geo/src/api/app.ts:454-460`); the request signal is not passed to `FeatureProvider.streamItems()` (`:317-320`) or to `StoreProvider`'s lazy served `#getStream()` (`packages/geo/src/api/providers/store-provider.ts:207-221`). If the lazy source is already awaiting its next S3 chunk, async-generator `return()` cannot interrupt that pending await. The S3 body is consequently released only when the 120-second guard fires, not when the client disconnects. Propagate the request signal into both validation/served `getStream` calls and make the S3 abort destroy the body directly; add a real-adapter test that opens the served pass, stalls its next S3 chunk, destroys the client, and asserts immediate release.

## F3 — non-blocking — the new adapter test proves lazy opening, but not the claimed destroyed-writable branch

`items-client-abort.test.ts:48-64` genuinely starts `@hono/node-server`, destroys a real client during validation, and its one-open assertion would fail if the served `#getStream()` were opened eagerly instead of by `#lazyStream()` (`packages/geo/src/api/providers/store-provider.ts:204-221`). That is useful coverage.

It does not, however, execute the stated `writeFromReadableStream()` destroyed-writable early return. `serve({ fetch: app.fetch })` routes normal Hono `Response` objects through `responseViaResponseObject()` (`node_modules/@hono/node-server/dist/index.cjs:797-845`), which directly obtains a reader and calls `writeFromReadableStreamDefaultReader`; the `writable.destroyed` early return is in the separate cached-response helper (`:643-646`). The test should describe the actual close/abort path it covers, or instrument/assert the intended adapter branch if that branch is the claimed reproduction.

# Verdict

NO-GO. F1 leaves a red required test and an unproven public probe bound; F2 leaves the S3 socket-pool exhaustion class reachable on served responses.
