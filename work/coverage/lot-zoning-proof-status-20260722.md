# Served lot zoning proof status — 2026-07-22

The corrected conclusion is: **2,276,056 of 3,429,863 served lots (66.359968%) carry a recorded spatial zone assignment.** Exact v2 zone-geometry proof is absent, so none is `geometry-verified`, but that provenance gap does not erase the recorded joins.

| Migration status | Lots | % of all lots | Meaning |
|---|---:|---:|---|
| `geometry-verified` | 0 | 0% | No logical zone collection is exact-source-eligible v2. |
| `geometry-legacy-traceable/recoverable` | 1,164,678 | 33.956983% | Assigned to a recoverable zone collection with dedicated geometry evidence; not v2 verified. |
| `geometry-quarantine` | 1,111,378 | 32.402985% | Assignment exists, but zone geometry provenance is quarantined. |
| `no-zone-assignment` | 1,153,807 | 33.640032% | No recorded zone assignment. |

Assignment and provenance are separate. The served-proof registry puts 2,276,056 lots behind `zone_collection_not_exact_source_eligible`; reaching that reason required a non-empty zone code and an accepted `assignment_method` (`area-majority` or `centroid-fallback`). Of these, 1,164,678 join to recoverable zone collections and 1,111,378 to quarantine collections. The registry retained only their combined method count, so an individual method split is not claimed without the prohibited refetch.

The 1,153,807 `zone_assignment_unavailable` lots include 1,002,404 alongside recoverable zone collections, 93,479 alongside quarantine collections, and 57,924 in 30 lot collections with no matching logical zone collection. A same-universe v1 lot-property audit corroborates 1,153,807 missing zone codes and records 109,961 missing `assignment_method` values; it is not used for zone provenance.

Collection checks: 897 logical qc-lots collections; 837 have at least one assignment, 60 are entirely unassigned, 349 are fully assigned, and 548 contain at least one unassigned lot. Arithmetic closes exactly: `1,164,678 + 1,111,378 + 1,153,807 = 3,429,863`.

Sources: `work/coverage/served-proof-registry-20260722.json` (authoritative logical view; zero failed S3 calls) and `work/coverage/immo-proof-coverage.json` (assignment-field corroboration only). This report performed no network/S3 refetch, S3 write, or deployment.
