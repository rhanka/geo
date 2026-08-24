---
status: completed
review-author:
  host: codex
  model: gpt-5.6-sol
  effort: xhigh
target-ref: e578e0d59d34cb4593b1b2c872fd78cf8f2240e3
legs:
  - peer: /root/review_safety
    angle: security-and-write-boundary
    status: completed
    verdict: approve
  - peer: /root/review_contract
    angle: served-contract-and-evidence
    status: completed
    verdict: approve
consensus-verdict: approve mechanism; real dry-run and every served write remain blocked on authenticated inputs and direct owner go via geo-cond
---

# Consensus review — zoning event source remediation

Two independent read-only legs reviewed the exact code target above. Attempts
to run the same legs through the h2a direct runtime terminated before producing
a verdict, and the durable gateway returned `529 Overloaded`; those incomplete
attempts were not counted. The completed safety and contract legs both approve.

## Reconciliation

The review loop found and closed four RETRACT evidence gaps before consensus:

- A durable receipt could initially assert its own exhaustion. RETRACT now
  requires a terminal cluster PV run with a git SHA, canonical run/manifest
  keys, captured CAS bytes, and a `complete-no-match` result bound to the same
  event, run, source, bytes, and detector SHA. The old declarative receipt is a
  tested `unknown`, never a RETRACT.
- Per-source coverage did not initially close every successful PV capture for
  the municipality. The union of no-match evidence must now equal the complete
  successful city/run partition without duplicates. Omitting a captured PDF is
  a tested non-executable result.
- Failed attempts were initially outside that successful partition. Every PV
  line carrying the municipality must now be an exploitable captured GET; a
  timeout, refusal, redaction, missing CAS object, or other incomplete attempt
  blocks RETRACT. A terminal run containing a timeout is a tested `unknown`.
- A mixed manifest could initially hide a line under another run or lane. Every
  line in the canonical manifest must now carry the expected run id and PV
  lane, in addition to matching the run attempt count. A divergent line is a
  tested non-executable result.

LINK remains preferred over RETRACT, preserves the stable event id, increments
the version, and attaches the verified URL, verbatim span, raw excerpt, and
provenance. RETRACT remains a versioned tombstone. Application re-reads both
served layouts, stages the entire municipal set through `serveZoningEvents`,
and exposes only an owner-supplied whole-set conditional commit capability; no
default real-S3 writer or apply CLI is included.

## Residual prerequisites, not merge blockers

- The future implementation of `commitWholeSetIfUnchanged` must truly prevent
  partial publication of the two served keys. This PR deliberately provides no
  default implementation.
- The authenticated inventory and owner review must establish that the cited
  cluster runs are the complete extraction universe. Within every cited run,
  the code now closes all city captures and refuses failures or omissions.
- The Selection-B cohort, authenticated ghost inventory, exact Sainte-Martine
  `2026-511` verbatim span, capture/extraction receipts, and projector
  confirmation are still pending via geo-cond. No real audit/dry-run is claimed
  and no served write is authorized by this review.

Consensus: merge the mechanism. Run the real read-only audit and dry-run only
after the pending durable inputs arrive; require their review and a direct
owner-go in geo-cond's h2a session before constructing any served writer.
