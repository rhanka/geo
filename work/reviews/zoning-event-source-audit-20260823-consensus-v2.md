---
status: completed
review-author:
  host: codex
  model: gpt-5.6-sol
  effort: xhigh
target-ref: b71ce62ce842a1c90cddb4435c1264aa97077196
legs:
  - path: work/reviews/zoning-event-source-audit-20260823-reproducibility.md
    status: completed
  - path: work/reviews/zoning-event-source-audit-20260823-safety.md
    status: completed
consensus-verdict: conditional-pass for PR1 read-only; no S3 run until the authenticated cohort is capitalized and its exact TSV schema is fixture-tested
---

# Consensus review v2 — zoning event source audit

This fresh dossier uses two eligible Claude-hosted legs. The failed launch from
the first dossier remains preserved in `zoning-event-source-audit-20260823.md`.

## Reconciliation

Both eligible legs completed. The safety leg approved the change with no
blocking findings. The reproducibility leg conditionally passed the core audit
and raised two medium input-capitalization concerns plus two low evidence/URL
observations.

- **Defer — cohort file capitalization.** The owner explicitly lists the
  authenticated cohort as pending and states that it does not block the
  library/runner. The runner records the cohort SHA-256 and refuses any count
  other than 127 by default. Before the first S3 run, the delivered cohort must
  be committed or referenced by a durable documented S3 URI; no current report
  is claimed.
- **Defer — exact TSV row schema.** Requiring a guessed column width would
  violate anti-invention while the SoT file is absent. On receipt, add that real
  file shape as a parser fixture and reject deviations before the S3 dry-run.
  Current gates already reject invalid slugs, duplicates, and count drift.
- **Reject for this scope — cross-field URL conflict/canonicalization.** The
  mandated predicate reuses literal `exactHttpUrl` and asks whether any
  parameterized geo source field contains an HTTP(S) source; canonicalization
  or source equivalence would change that owner-selected rule.
- **Reject as a determinism requirement — retrieval timestamp.** Per-object
  body SHA-256, document `as_of`, key, cohort SHA-256, layout, and report
  contract establish the audited bytes. Adding wall-clock time would make
  otherwise identical runs byte-different. S3 version metadata can be added
  later if the storage target exposes a durable version contract.

Consensus: merge the read-only mechanism. Keep the actual audit blocked until
the two deferred input conditions are satisfied. This matches the owner gate
and does not authorize LINK, RETRACT, or any served write.
