# Recovery r2 — geometry-proof mitigation plan

This plan tracks local provenance mitigation for the logical zone collections in the 2026-07-22 serving snapshot. Its machine-readable state is [proof-mitigation-queue-20260722.json](./proof-mitigation-queue-20260722.json). It makes no source request, S3 read/write, deployment, served-object change, or lot-zone recomputation.

## Immutable baseline

The queue is pinned to four local reports: the served registry, the 515 historical reconstruction, the 356 orphan reconciliation, and the lot zoning proof status. Their SHA-256 values are recorded in the JSON queue. The registry has 871 logical zone collections / 95,551 zone features: 515 `recoverable` and 356 `quarantine`.

The lot report has a separate, preserved axis. It records 2,276,056 spatial assignments in 3,429,863 served lots, but zero exact-v2 geometry-verified lots. A provenance review must never alter a lot's `zone_code`, `assignment_method`, `zone_assignment_status`, or whether it has a recorded assignment.

| Current lot status | Lots | Meaning during this plan |
|---|---:|---|
| `geometry-verified` | 0 | Remains zero until an independently authorized exact-v2 proof gate passes. |
| `geometry-legacy-traceable/recoverable` | 1,164,678 | Assigned lots joined to recoverable zone collections; unchanged. |
| `geometry-quarantine` | 1,111,378 | Assigned lots joined to quarantined zone collections; unchanged. |
| `no-zone-assignment` | 1,153,807 | Outside a geometry-proof remediation transition; unchanged. |

The reports do not preserve a lot-count split for each individual provenance cohort. In particular, this plan does not invent a count for the 6, 509, 21, 191, 32, or 112 collection cohorts.

## Exact queue

| Queue ID | Current serving / local evidence class | Collections | Features | Next owner and action | Gate to advance |
|---|---|---:|---:|---|---|
| `R2-REC-HV-006` | recoverable / historical-verified | 6 | 4,629 | Provenance reviewer reconciles retained source bytes/artifacts and output links locally. | All six chains and hashes reconcile; explicitly retain `no-v2-proof`. |
| `R2-REC-LT-509` | recoverable / legacy-traceable | 509 | 52,640 | Provenance reviewer freezes exact historical identities and records missing-byte gaps. | Collection-specific identity and local link exist; no host-family inference. |
| `R2-QUAR-HV-021` | quarantine / historical-verified | 21 | 1,246 | Provenance reviewer checks each successful local serve/deposit record and source link. | Local chain is admissible; missing v2 retrieval/hash fields are explicit. |
| `R2-QUAR-LT-191` | quarantine / legacy-traceable | 191 | 20,595 | Provenance reviewer records surviving local linkage and the exact upstream-to-v2 gap. | Each advanced row has cited admissible lineage; no legacy promotion. |
| `R2-QUAR-CAND-032` | quarantine / candidate-needs-human-confirmation | 32 | 1,857 | Municipal/source-record owner confirms or rejects a collection-specific link using retained local records. | Accountable, cited local linkage; otherwise block it. |
| `R2-QUAR-ORPH-112` | quarantine / orphan | 112 | 14,584 | Source-record owner records the explicit block and evidence custodian, if known. | Remains blocked unless newly supplied, preserved local evidence is admissible. |
| **Total** |  | **871** | **95,551** |  | `6 + 509 + 21 + 191 + 32 + 112` |

The review targets are 27 historical-linkage collections / 5,875 features, 700 legacy-lineage collections / 73,235 features, 32 human-linkage decisions / 1,857 features, and 112 explicitly blocked-orphan collections / 14,584 features.

## State machine and acceptance

```text
snapshot-locked
  -> local-evidence-reviewed
       -> human-linkage-review -> local-evidence-reviewed | blocked-no-admissible-lineage
       -> ready-for-forward-validation-authorization
            -> v2-proof-validated -> api-canary-approved -> api-general-availability

blocked-no-admissible-lineage (terminal for recovery r2)
```

`snapshot-locked` means only that the source reports and arithmetic are pinned. `local-evidence-reviewed` permits local artifact and log review only. It does not change a serving classification. Candidate records enter `human-linkage-review`; orphan records enter `blocked-no-admissible-lineage` until an accountable custodian supplies a new, preserved local record.

`ready-for-forward-validation-authorization` is a handoff, not an acquisition task. It requires the proof-contract owner to approve a distinct scope. Only that successor work can reach `v2-proof-validated`, and only an exact collection-and-feature proof for a newly proposed served object can reach that state. API rollout remains blocked before then.

Each transition needs a queue item, owner, independent reviewer, date, cited local evidence/hashes, acceptance result, and an explicit declaration that no retrospective refetch occurred.

## Non-negotiable proof policy

No retrospective refetch is allowed. A network response, endpoint probe, S3 read, or new download obtained after this snapshot is a new observation; it cannot recreate or strengthen historical proof for an already served object. A future acquisition can be considered only under separately authorized, forward-only work with a captured timestamp, immutable bytes/hash, exact source-to-output link, and the normal v2 proof gate.

Generic municipality pages, S3 locators, bare pipeline labels, inferred/truncated URLs, and slug-only document matches are not source identities. Historical-verified and legacy-traceable are local evidence classes, never aliases for `exact-source-eligible` or `geometry-verified`.

## Proposed additive API mapping

This is a rollout map only; it authorizes no API change. Add a `geometry_provenance` object on zone responses with `serving_status`, `local_evidence_class`, `proof_state`, and `evidence_as_of`. Its `proof_state` is `no-v2-proof` for every queue item today. Do not reuse `zone_geometry_status`, which is already a geometric-quality indicator rather than a provenance indicator.

For lot responses, preserve the four-value `zoning_proof_status` partition:

| Queue coverage | Zone response | Lot response | Constraint |
|---|---|---|---|
| `R2-REC-HV-006`, `R2-REC-LT-509` | `serving_status: recoverable`, `proof_state: no-v2-proof` | `geometry-legacy-traceable/recoverable` | Only the 1,164,678 recoverable aggregate is known. |
| `R2-QUAR-HV-021`, `R2-QUAR-LT-191`, `R2-QUAR-CAND-032`, `R2-QUAR-ORPH-112` | `serving_status: quarantine`, `proof_state: no-v2-proof` | `geometry-quarantine` | Only the 1,111,378 quarantine aggregate is known. |
| No matching zone / unassigned lots | No cohort mapping | `no-zone-assignment` | The 1,153,807 count does not change. |

The proposed waves are: contract review; a bounded zone-response canary; derived lot-status exposure with the baseline arithmetic checked; then, only for an independently authorized v2-validated successor, a verified-promotion canary. Rollback removes or returns the additive provenance field to its prior non-verified label. It never mutates zone geometry, lot assignments, or evidence history.

## Completion criteria for this lane

Recovery r2 is complete when every cohort has an owner, state, cited gate result, and dependency; all six cohorts continue to reconcile to 871 collections / 95,551 features; the lot partition remains `0 + 1,164,678 + 1,111,378 + 1,153,807 = 3,429,863`; and the transition log reports zero retrospective refetches, S3 accesses, deployments, or assignment recomputations.
