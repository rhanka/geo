---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-luna
reviewer-effort: xhigh
target-ref: b71ce62ce842a1c90cddb4435c1264aa97077196
lens: reproducibility, fail-closed unknown handling, cohort parsing, and audit evidence sufficiency
---

# Reproducibility review

## Review method and evidence

Reviewed only `git show b71ce62ce842a1c90cddb4435c1264aa97077196`, against
`docs/spec/SPEC_QC_ZONING_EVENTS_V2.md` and the stated objective. The two added
focused test files pass (7 tests), and the acquisition TypeScript check passes.
The implementation is pure at the classification/observation boundary: it does
not write served objects, and the runner imports `getBytes` but no S3 write
primitive. It emits a deterministic report by sorting cohort slugs, sorting
per-event rows by `event_id`, and aggregating in that sorted order. The runner
selects `zoningEventsKeys(slug)[1]`, i.e. the nested key, and records the object
SHA-256, cohort SHA-256, selected layout, source fields, per-city state, and
read errors. Read/JSON/schema/muni failures are caught as `unknown` rather than
converted to source absence; retracted events are not living phantoms. The
parameterized source-field path is validated and defaults are exactly
`url_pdf` and `provenance.source_url`.

## Findings

### [medium] The checked-in runner does not pin the cohort membership to a committed, reproducible artifact

**Evidence:** `acquisition/src/zoning-event-source-audit-run.ts:59-81` reads a
caller-selected file under `work/coverage` (defaulting to
`work/coverage/cohorte-vivier-b-6mo.slugs.tsv`) and independently supplies
`--expected-count` (default `127`). The report records the file's SHA-256, which
is useful evidence, but the commit does not add the default TSV or otherwise
provide a committed/S3 URI containing its contents. On a clean checkout the
default command therefore fails with `ENOENT`; a caller can also pair an
arbitrary TSV with the expected count. This conflicts with CLAUDE.md's
reproducibility rule that required inputs be committed or read from a documented
S3 URI. It weakens audit evidence: a report can identify bytes that are not
available to a later reviewer.

**Impact:** the audit is not replayable from the commit and report alone, and
selection provenance is operational rather than capitalized.

### [medium] Cohort TSV parsing silently accepts malformed rows and extra columns

**Evidence:** `parseZoningEventCohortTsv` splits each row into cells but only
reads the selected slug column (`acquisition/src/lib/zoning-event-source-audit-runner.ts:72-91`). It accepts a header with `slug` plus arbitrary/missing columns, accepts data rows with no tab-separated selection column, and ignores all extra cells. It also treats any first row lacking a recognized header as data, so a malformed header such as `municipality` becomes an invalid slug only incidentally, while a one-column file beginning with `slug` is treated as a header and yields an empty cohort. Since the runner then calls the audit with `expected_count`, an empty parsed cohort is rejected only if the expected count is nonzero; malformed row shape is not itself fail-closed or reported as unknown. The focused test covers sorting and duplicates, but not row width, required header schema, BOM, or blank slug cells.

**Impact:** a corrupted/coarsened TSV can produce a different cohort or a misleading failure, rather than a deterministic parse rejection with sufficient evidence. Strictly requiring the expected header/column shape and rejecting unexpected widths would make the selection auditable.

### [low] URL classification has a permissive “first valid wins” edge case and does not canonicalize evidence

**Evidence:** `classifyZoningEventSource` iterates configured paths and immediately returns `has-source` for the first exact HTTP(S) URL; it otherwise remembers only the first invalid value. Thus if `url_pdf` is invalid but `provenance.source_url` is valid, the result is `has-source` with the provenance URL (reasonable for the default objective), while if multiple configured fields contain different valid URLs, the first one wins without recording the conflict. `exactHttpUrl` accepts any HTTP(S) URL with a nonempty hostname, including credentials, fragments, query-only/non-document URLs, and whitespace-containing host/path forms accepted by `URL`. The stated pure audit only requires HTTP(S)-style source classification, so this is not a correctness failure by itself, but the report cannot expose disagreement between the two provenance fields or distinguish a suspicious URL from a valid source.

### [low] Report evidence omits the audit runner's execution identity and source-object response metadata

**Evidence:** `ZoningEventAuditCity` records the nested key and body SHA-256, and the report records cohort SHA-256 and deterministic fields, but no retrieval timestamp, S3 version/ETag, bucket/endpoint, runner commit, or schema/spec version beyond the local contract string `zoning-event-source-audit/v1`. A body digest is strong content evidence, but without a retrieval time/object version and explicit target commit it is harder to reproduce exactly or establish which served snapshot was observed. This is an evidence sufficiency gap rather than a source-counting defect.

## Verdict

**CONDITIONAL PASS (medium findings).** The core audit behavior meets the
objective: it is read-only with respect to served data, uses the nested S3
cohort, defaults to the two requested fields, fails closed on unreadable or
malformed documents as `unknown`, excludes retracted events from living
phantoms, and produces stable JSON ordering. However, I would not treat the
default run as reproducible/audit-grade until the cohort artifact is
capitalized and TSV parsing is strict enough to reject malformed selections.
The URL and evidence gaps are lower severity but should be addressed before
using the report as durable proof.

## Targeted verification

`cd acquisition && npx vitest run src/lib/zoning-event-source-audit.test.ts src/lib/zoning-event-source-audit-runner.test.ts`
passed: 2 files, 7 tests. `npx tsc --noEmit -p tsconfig.json` passed.

No served writes were performed.
