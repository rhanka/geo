---
status: completed
reviewer-host: codex
reviewer-model: gpt-5.6-terra
reviewer-effort: high
target-ref: 00d0eff7caf97f3fb16a55b5a64ac993e8718d1b
lens: correctness + does-it-actually-reproduce
---

# Reasoning

I reviewed the complete PR diff from `c592d88342523443ea1a5945c841f883d8c74e98`
to the target and the round-3 delta, then traced the request signal from the
real Node adapter through the providers and S3 store. I also inspected the
installed `@smithy/node-http-handler` 4.7.8 and `@hono/node-server` 2.1.0.

The round-2 blockers are fixed in the `api/server.ts` deployment path. A
request signal reaches both the validation and lazy served reads through
`app.ts:309-316` and `store-provider.ts:194-230`; it reaches the règlement PDF
read through `app.ts:427-438` and `reglement-provider.ts:133-140`. In
`S3Store.getStream`, the signal is passed as Smithy's `abortSignal` and also
destroys an already-open body (`s3-store.ts:143-152`, `:323-357`). Smithy's
handler registers that signal on the request and destroys it on abort
(`node_modules/@smithy/node-http-handler/dist-cjs/index.js:373-387`).

`idleGuardedStream` now distinguishes an upstream idle/pending-chunk interval
from a downstream-held chunk (`s3-store.ts:345-356`). The tests exercise both
boundaries: a pending upstream chunk fails after the idle limit
(`s3-store-socket-release.test.ts:46-55`), a held chunk uses the separate hold
limit (`:57-65`), and a consumer paused longer than the idle limit continues
normally (`:67-82`). Actively delivered chunks also remain live past the idle
limit (`:126-143`). This preserves normal and slow-but-live downloads while
bounding a stopped consumer.

The `/health` race is also correct within a bounded underlying operation:
`app.ts:190-213` aborts at its deadline, races and caches that verdict, and
clears `inFlight` even if `checkHealth` never settles. Its cold-index regression
test establishes that the retained indexing promise does not start another
`list()` (`health.test.ts:131-153`). The production API executable supplies the
required Smithy bounds (`api/server.ts:42-46`); `requestTimeout` destroys and
rejects a request when enabled (`node-http-handler/dist-cjs/index.js:80-99`).

The new `/items` test is a real `@hono/node-server` test, not `app.request()`
(`items-client-abort.test.ts:17-18`, `:75-122`). It waits until the served read
is open, destroys the actual HTTP client, and observes the signal registered by
the served store call. Removing the new signal propagation leaves that listener
unfired, so the assertion would fail. This matches the adapter implementation:
the response path attaches `close`/`error` handlers which cancel the Web reader
(`node_modules/@hono/node-server/dist/index.cjs:617-646, 797-846`). There is no
equivalent real-adapter regression for the règlement route, but its direct
signal plumbing and shared `byteStreamToReadable` cancellation path are sound.

Validation run, on the target checkout: `npm test --workspace @sentropic/geo`
passed (50 files, 542 tests); `npm run check --workspace @sentropic/geo` passed;
`git diff --check c592d88342523443ea1a5945c841f883d8c74e98...00d0eff7caf97f3fb16a55b5a64ac993e8718d1b`
was clean.

# Findings

## F1 — blocking — `geo serve --data s3://...` still permits an unbounded pre-header S3 socket

`geo serve` is a supported API-server entry point: its CLI accepts an S3 data
location (`packages/geo/src/cli/program.ts:123-140`), and the documented S3
routing test confirms it constructs a `StoreProvider` from
`createStore("s3://...")` (`packages/geo/src/cli/commands/serve.test.ts:57-67`).
However, that runtime calls `createStore(dataLocation)` with no read-server
timeouts (`packages/geo/src/cli/commands/serve.ts:86-92`). Consequently,
`S3Store.buildClient` does not set either `requestTimeout` or
`throwOnRequestTimeout` (`packages/geo/src/storage/s3-store.ts:227-235`).

This is not protected by the new body guards: they begin only after
`client.send(GetObjectCommand)` has returned a `Body`
(`s3-store.ts:143-152, 323-345`). With a reachable S3 endpoint that accepts a
request but never returns headers, each normal connected `/items` request waits
in `client.send()` while retaining a pooled socket. In Smithy 4.7.8,
`setRequestTimeout` schedules nothing for the default zero/undefined timeout
(`node_modules/@smithy/node-http-handler/dist-cjs/index.js:80-99`), whereas the
same handler uses a 50-socket keep-alive agent (`:449-470`). Fifty such reads
again exhaust the pool; later requests queue indefinitely. The target's
`api/server.ts:42-46` config fixes only its separate executable, not this public
CLI server path.

This leaves the incident's socket-exhaustion class reachable. Give the CLI's
S3 read store the same bounded `httpTimeouts` as `api/server.ts` (without
changing write-side defaults), and add a regression that starts `geo serve`
with an S3 URI against a server that accepts but never answers, then proves the
request rejects within the configured bound.

## F2 — non-blocking — the stated public `GetStreamOptions` re-export is absent

Round-2 reconciliation says `GetStreamOptions` is re-exported. It is declared
at `packages/geo/src/storage/store.ts:20-26` and used in the public optional
`Store.getStream` signature (`:44`), but the storage barrel exports only
`ByteStream`, `PutOptions`, and `Store` (`packages/geo/src/storage/index.ts:13`).
Thus a consumer importing the new options type from the package's storage
surface cannot do so. This does not retain sockets or alter runtime behavior,
but the stated source API polish is incomplete.

# Verdict

NO-GO. The revised stream guards, health single-flight/deadline/cache behavior,
and `/items` request-abort reproduction are credible, and the règlement signal
path is correctly wired. F1 nonetheless leaves a documented, runnable S3 API
server with no pre-header request bound, so the same pool-exhaustion outage can
still recur.
