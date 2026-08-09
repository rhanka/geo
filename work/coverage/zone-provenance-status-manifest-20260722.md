# Zone provenance status manifest — 2026-07-22

This companion documents the row-level manifest at `work/coverage/zone-provenance-status-manifest-20260722.json`. It reconciles exactly the served registry’s 871 logical QC zone collections using only the 515-row historical report and the 356-row reconciliation report.

| Provenance state | Collections | Features | Rollout posture |
|---|---:|---:|---|
| `historical-verified` | 27 | 5875 | Hold for v2 proof completion or owner review, by source origin. |
| `legacy-traceable` | 700 | 73235 | Hold for human linkage confirmation and v2 proof. |
| `candidate-needs-human-confirmation` | 32 | 1857 | Hold for human confirmation. |
| `orphan` | 112 | 14584 | Block pending manual historical recovery. |
| **Total** | **871** | **95551** | **No rollout in this lane.** |

The source partition closes exactly: 515 recoverable collections / 57,269 features from the historical report plus 356 quarantined collections / 38,282 features from reconciliation equals 871 / 95,551. The JSON records the registry status, provenance state, source origin, source-identity reference, evidence references, v2 acquisition readiness, lot-impact reference, and rollout policy for every collection.

Source origin is deliberately separate from `v2_acquisition_readiness`: every row is `not-assessed`. That is not a claim about current endpoint availability; this lane performed no source refetch, S3 read/write, deployment, or modification of an existing file.

Lot impact references resolve to a same-slug logical-lots collection for 867 rows. The remaining 4 zone collections — `les-cedres`, `saint-marc-du-lac-long`, `saint-theodore-dacton`, `sainte-justine-de-newton` — have an explicit zero-match reference to the lots registry root; no lot link is inferred.

The JSON’s compact `r`, `l`, `h`, and `q` reference grammar resolves each source-identity and evidence reference to the supplied local reports. A null identity reference remains null; the manifest does not create an identity, URL, hash, or evidence record.
