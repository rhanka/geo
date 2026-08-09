# Zone-provenance quality summary — 2026-07-23

This deterministic, local CPU-only matrix classifies all 1,106 municipality identities from `packages/qc-sources/src/geo/municipalities.qc.json`. It reads retained provenance/proof artifacts only; it performs no network, S3, deployment, or Track operation.

| Quality status | Cities | Meaning |
|---|---:|---|
| `acceptable` | 727 | Retained `historical-verified` or `legacy-traceable` local evidence; not v2 proof or rollout approval. |
| `candidate` | 32 | Retained `candidate-needs-human-confirmation` evidence. |
| `orphan` | 109 | Retained `orphan` provenance state. |
| `v2` | 0 | No retained exact-v2 proof exists in scope. |
| `unknown` | 238 | No exact city-slug zone row; nothing was inferred. |
| **Total** | **1106** | **727 + 32 + 109 + 0 + 238 = 1106** |

Exact identity coverage is deliberately slug-for-slug: 868 city identities join a zone row and 238 are `unknown`. Three additional retained zone rows (132 features) do not exactly match a municipality slug: `l-assomption`, `l-epiphanie`, and `sainte-christine-d-auvergne`. They have display-name-normalization candidates but each candidate already has a distinct exact zone row, so the matrix keeps them unlinked rather than collapsing or overwriting provenance.

Feature arithmetic also closes: 95,419 features attached through exact city identity plus 132 features in the three unlinked zone rows equals the manifest's 95,551 features.

No city is marked `v2`. Every retained manifest row is `not-assessed` for v2, and the local mitigation queue explicitly says historical/legacy evidence must not be promoted to v2 proof. Matrix citations are compact tokens resolved in the JSON's `citation_grammar`; they point only to retained local artifacts.

Inputs are hash-pinned in [the matrix](work/coverage/zone-provenance-quality-matrix-20260723-74345365.json) and include the municipality catalog, provenance manifest, historical/reconciliation evidence reports, and the v2 non-promotion rule.

