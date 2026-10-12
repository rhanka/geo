---
status: completed
reviewer-host: codex
reviewer-model: gpt-5.6-terra
reviewer-effort: high
target-ref: ee67940d4653c875a25983ad9bf77f0e305bb180
lens: correctness + does-it-actually-reproduce
---

# Reasoning

I reviewed the round-4 delta
`00d0eff7caf97f3fb16a55b5a64ac993e8718d1b..ee67940d4653c875a25983ad9bf77f0e305bb180`,
the complete PR diff from `c592d88342523443ea1a5945c841f883d8c74e98`, and the
round-3 reconciliation. The target was `HEAD` at the requested commit and was
clean before this permitted review artefact was added.

The round-3 blocker is fixed. The shared, frozen
`READ_SERVER_S3_HTTP_TIMEOUTS` supplies a 5-second connection bound and a
20-second pre-header/pool-queue bound
(`packages/geo/src/storage/s3-store.ts:69-77`). `S3Store.buildClient` installs
both `requestTimeout` and `throwOnRequestTimeout` when supplied
(`packages/geo/src/storage/s3-store.ts:237-245`). `api/server.ts` passes that
same value to its feature and règlement factories
(`packages/geo/src/api/server.ts:43-55`), and `geo serve` passes it to
`createStore` for every store URI (`packages/geo/src/cli/commands/serve.ts:89-96`).
`createStore` forwards it only to an S3 store and ignores it for `fs:`
(`packages/geo/src/storage/uri.ts:70-97`), so the new CLI argument does not
alter filesystem behaviour.

The evidence is more than a configuration assertion. The routing regression
asserts that the CLI's `s3://` path receives the shared value
(`packages/geo/src/cli/commands/serve.test.ts:57-71`), and the real SDK
regression starts a TCP server that accepts but never returns headers. An S3
request with timeouts rejects within five seconds
(`packages/geo/src/storage/s3-store-socket-release.test.ts:114-136`). Therefore
the specific pre-header, 50-socket pool exhaustion scenario that remained in
round 3 is no longer reachable through either API-server entry point.

The other claimed corrections are present: the public storage barrel now
re-exports `GetStreamOptions` and `S3HttpTimeouts`
(`packages/geo/src/storage/index.ts:13-20`), and every `release()` path removes
the abort listener before destroying the body
(`packages/geo/src/storage/s3-store.ts:337-367`). The never-iterated-body
regression verifies that listener removal (`packages/geo/src/storage/s3-store-socket-release.test.ts:92-102`).
The existing body guard still bounds an unopened body, a pending upstream chunk,
and a downstream-held chunk (`packages/geo/src/storage/s3-store.ts:323-369`),
while request-abort plumbing reaches both collection and règlement streams
(`packages/geo/src/api/app.ts:309-316,427-438`; `packages/geo/src/api/providers/store-provider.ts:194-230`; `packages/geo/src/api/reglement-provider.ts:133-140`).

I searched the production `packages/geo/src` server entry points and all direct
S3 read construction/calls. The only API-server entry points are
`api/server.ts` and the `geo serve` command (`packages/geo/src/api/server.ts:60-65`,
`packages/geo/src/cli/program.ts:123-140`); both are covered above. The normal
API S3 paths use `S3Store`. One distinct, one-shot normalization runner is the
remaining direct S3 reader and is recorded below; it is not reachable from an
HTTP server.

Required verification passed on the target:

- `npm test --workspace @sentropic/geo`: 50 files, 543 tests passed.
- `npm run check --workspace @sentropic/geo`: passed.
- `git diff --check c592d88342523443ea1a5945c841f883d8c74e98...ee67940d4653c875a25983ad9bf77f0e305bb180`: clean.

# Findings

## F1 — non-blocking — the standalone CPTAQ normalization runner still has unbounded S3 reads

`cptaqRepositoryFromEnv` constructs its own raw `S3Client` with no connection or
request timeout (`packages/geo/src/constraints/cptaq-runner.ts:424-446`).
`CptaqS3Repository.read` awaits `GetObject` and then consumes its body directly,
without the `S3Store` body guard (`packages/geo/src/constraints/cptaq-runner.ts:365-388`;
`packages/geo/src/constraints/cptaq-runner.ts:334-351`). A peer that accepts a
request without headers, or returns headers then stops its body, can retain one
of that process's S3 sockets indefinitely.

This is not an API-server route and cannot reproduce the incident's pool
exhaustion: the runner is a one-shot CLI (`packages/geo/src/constraints/cptaq-runner.ts:477-490`)
and issues its fixed four required reads in one `Promise.all`
(`packages/geo/src/constraints/cptaq-runner.ts:245-250`). It can deadlock a
normalization job, but it cannot let arbitrary HTTP clients consume the geo-api
pool. It is therefore non-blocking for PR #418. A separate operational hardening
change should give this runner an intentional request/body deadline (or reuse a
bounded read-only S3 abstraction) with a stalled-endpoint regression.

# Verdict

GO-with-fixes. The round-3 blocking CLI pre-header leak is fixed and directly
tested; the delta does not regress either server entry point or the public
storage API. F1 is pre-existing, outside the HTTP server, and non-blocking for
this hotfix, but should be resolved before relying on the CPTAQ runner for
unattended work.
