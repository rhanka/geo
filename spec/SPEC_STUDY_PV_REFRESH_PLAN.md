# Study: bounded QC PV refresh plan

## Observation

The current generic PV adapter is safe for first deposit: `pv-index-run.ts`
honours robots, delays requests, and skips an existing S3 manifest.  The
coverage matrix, meanwhile, is a local projection and does not encode whether
an S3 manifest is absent, stale, or merely not yet reconciled.  The current
residual has 42 cells, but only one is configured for that generic adapter.

## Reversible decision

Add a read-only S3 inventory planner rather than a broad new crawler.  It will
emit a deterministic, ten-target-max plan from an explicit `--as-of` value:

- `deposit-missing` only for a configured source without its exact S3 key;
- `revalidate-older-manifest` only for an existing configured manifest older
  than the supplied horizon; that timestamp is a scheduling threshold, never
  an assertion that the municipal source is stale;
- unconfigured residuals remain explicitly reported and are not claimed or
  submitted to the generic adapter.

The plan emits the generic adapter's dry-run and deposit argv with a 1000ms
minimum delay. The adapter revalidates only an older scheduled manifest and
writes a semantic change, so repeated plans do not rewrite unchanged output.

## Guardrails

- S3 listing is evidence, not an assertion that an index is valid or served.
- No coverage matrix, fleet configuration, API process, or source manifest is
  written by planning.
- A live batch is limited to the planner's selected targets and is preceded by
  the emitted dry run.

## Peer review reconciliation

Two independent reviews challenged the update path. Both identified a fail-open
S3 read and insufficient provenance matching; the coverage review also found
that the ten-target bound was planner-only. The implementation now fails closed
on non-404 S3 reads, requires a `pv-index-run/v1` marker before replacing an
existing manifest, and rejects a refresh batch over ten targets. The reviewers'
observation that S3 `LastModified` cannot prove source freshness is accepted;
the code and report call it only a revalidation scheduling threshold.
