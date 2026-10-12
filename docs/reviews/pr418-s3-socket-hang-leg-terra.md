---
status: completed
reviewer-host: codex
reviewer-model: gpt-5.6-terra
reviewer-effort: high
target-ref: b68b91157b4330351efdea85d36e8a13dac33f1b
lens: correctness + does-it-actually-reproduce
---

# Reasoning

I reviewed `c592d88342523443ea1a5945c841f883d8c74e98...b68b91157b4330351efdea85d36e8a13dac33f1b`, excluding `docs/reviews/*`, and inspected the installed versions named by the PR: `@smithy/node-http-handler` 4.7.8 and `@hono/node-server` 2.1.0.

The essential production path is credible. Smithy's default handler creates keep-alive agents with `maxSockets = 50` (`node_modules/@smithy/node-http-handler/dist-cjs/index.js:406-433`) and its default request timeout is zero (`:208`, `:377-380`), so queued work can wait forever. A returned `GetObject` response exposes the Node `IncomingMessage` as its body (`:345-352`), and an unconsumed one retains the connection. Hono 2.1.0 also has the described pre-write hole: `writeFromReadableStream()` returns immediately when `writable.destroyed` is true without cancelling its reader (`node_modules/@hono/node-server/dist/index.cjs:643-647`).

The lazy served pass in `packages/geo/src/api/providers/store-provider.ts:204-221` avoids opening the second S3 body until Hono pulls the response. `releaseOnAbort()` is wired to both served stream types (`packages/geo/src/api/app.ts:406, 418-447, 463-531`). With this Hono version, a normal completed response does not trigger that abort: the close handler only aborts when `!outgoing.writableFinished` (`node_modules/@hono/node-server/dist/index.cjs:703-710, 863-867`). I also confirmed that destroying an already fully consumed Node HTTP response does not discard its free keep-alive socket.

The geo-api-only request/header timeouts are scoped correctly: `server.ts:45-54` passes options only into its two read-side stores; `uri.ts:68-94` merely forwards explicitly supplied options, so writers retain the old opt-in behaviour. `requestTimeout` is armed until headers and cleared on the handler's response callback (`node_modules/@smithy/node-http-handler/dist-cjs/index.js:80-99, 280-290, 345-380`).

`npm run check` and `npm test` completed successfully in this built worktree. Those results do not cover the blocking cases below.

# Findings

## F1 — blocking — `/health`'s deadline leaves an already-open stalled S3 body alive

`packages/geo/src/api/app.ts:161-188` races `provider.checkHealth()` against a rejecting timer, but cancellation is not propagated to the losing operation. In `packages/geo/src/api/providers/store-provider.ts:234-242`, once `getStream()` has returned, the probe can be stuck forever in `await iterator.next()`; its `finally` (and therefore `iterator.return()`) cannot run until that `next()` settles. An S3 response that sent headers and then stopped sending its body consequently keeps its socket until the independent 120-second guard eventually fires (`packages/geo/src/storage/s3-store.ts:291-322`), despite `/health` returning 503 after five seconds.

This is not merely cosmetic: frequent health calls during that failure mode accumulate occupied connections for up to two minutes, which is the precise resource the endpoint is intended to diagnose. Give `checkHealth` a cancellable contract (or arrange an iterator/abort handle before the race) and make the timeout call `return()`/destroy the underlying body. Add a test whose `getStream` resolves to a stream whose first `next()` never resolves, then assert release at the health deadline.

## F2 — blocking — the new global idle guard terminates legitimate slow-client downloads

`idleGuardedStream()` destroys the S3 body whenever no source chunk moves for 120 seconds (`packages/geo/src/storage/s3-store.ts:283-322`). That condition includes consumer backpressure, not just abandonment. `streamItemsResponse()` obtains the next feature only from its Web-stream `pull()` (`packages/geo/src/api/app.ts:477-531`), and `byteStreamToReadable()` does the same for a règlement PDF (`:428-447`). Hono waits for the outgoing `drain` event before requesting the next chunk (`node_modules/@hono/node-server/dist/index.cjs:617-641, 808-846`). Therefore a valid client that is temporarily slow for over two minutes causes `destroy()` and an incomplete large-lots response or PDF download.

This changes existing streaming semantics and violates the requested slow-client regression check. The guard needs an explicit policy that distinguishes an abandoned response from output backpressure (for example, prompt cancellation on request abort plus a server-side S3-read timeout that is paused while downstream is backpressured), or this deadline must be an agreed, documented API download limit with an appropriate response/error contract. Cover both a throttled `/items` response and a throttled règlement PDF.

## F3 — non-blocking — one stated Smithy root-cause detail is contradicted by the installed code

The PR description says that Smithy's `socketTimeout` does not cover the body phase and is cancelled at headers. In 4.7.8, `setSocketTimeout` attaches the timeout to the request socket (`node_modules/@smithy/node-http-handler/dist-cjs/index.js:123-144`); response resolution clears the scheduling timer but does not remove that socket timeout (`:280-290, 345-352`), and the listener is removed on request close (`:131-134`). A direct local `NodeHttpHandler({ socketTimeout: 100 })` run against a server that flushed headers and never sent a body emitted `ECONNRESET` and closed the body after 132 ms.

No `socketTimeout` was configured before this change, so the conclusion that the old API had no effective body bound remains true. Correct the incident narrative to avoid encoding a false SDK behaviour; the selected `requestTimeout` correctly bounds acquisition/headers but is deliberately not a body-phase bound.

## Test coverage note — non-blocking on its own, but insufficient to establish the claimed reproduction

`packages/geo/src/storage/s3-store-socket-release.test.ts:34-66` uses a `PassThrough` mock and observes only `.destroyed`; it does not observe a pooled socket. Its real-SDK case (`:68-90`) never returns headers, so it tests `requestTimeout`, not a leaked response body. `packages/geo/src/api/health.test.ts:95-107` proves lazy opening through `app.request()`, which does not exercise the Hono Node adapter's destroyed-writable path. There is no end-to-end test in which a real Node client disconnects during validation and verifies that no second S3 request/socket is opened or retained. Add that test after resolving F1/F2.

# Verdict

NO-GO. F1 leaves the new health path capable of holding the failing resource past its advertised deadline, and F2 breaks legitimate slow-client streaming for both affected response types.
