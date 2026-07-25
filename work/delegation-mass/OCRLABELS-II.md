# OCRLABELS-II

Date: 2026-06-29

Scope: `chateauguay`, `montreal-ouest`, `montreal-est`, `sainte-julie`.

Result: **0 served / 4 flagged**. No `qc-zonage-<slug>` upload.

Validation source gate: attempted `registry/qc-zonage-norms/qc-zonage-norms-<slug>.parquet` for all 4; S3 DNS failed `getaddrinfo EAI_AGAIN s3.fr-par.scw.cloud` on 3 retries/slug. Local provenance only has counts for 3 slugs, not code strings; no authoritative dictionary was available locally. GPT labels were therefore **not eligible for serving validation**. No codes fabricated.

| City | Decision | needs_human_gcp | Autogcp selected GCPs | Residual max / holdout max | Cadastre vertices/lots | Tick candidates text/visual | Validated GPT map codes | Codes source |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `chateauguay` | flagged: `autogcp_fail_no_independent_matches` | true | 0 | null / null | 282084 | 1 / 0 | 0 | S3 norms unavailable; local provenance count only = 1 existing recall |
| `montreal-ouest` | flagged: `autogcp_abort_seed_gcps_0` | true | 0 | null / null | 1601 lots | 0 / 0 | 0 | S3 norms unavailable; local provenance count only = 30 existing recall |
| `montreal-est` | flagged: `autogcp_fail_no_independent_matches` | true | 0 | null / null | 17742 | 0 / 4 | 0 | S3 norms unavailable; local provenance count only = 75 existing recall |
| `sainte-julie` | flagged: `autogcp_fail_no_independent_matches` | true | 0 | null / null | 209340 | 0 / 16 | 0 | S3 norms unavailable; no local provenance row |

Commands/results:

- `t2-autogcp chateauguay`: pass=false, seed_candidate_matches=0, selected_gcps=0.
- `t2-autogcp montreal-ouest`: failed before report, `need ≥3 GCPs for an affine fit, got 0`.
- `t2-autogcp montreal-est`: pass=false, seed_candidate_matches=0, selected_gcps=0.
- `t2-autogcp sainte-julie`: pass=false, seed_candidate_matches=0, selected_gcps=0.

Decision gate: all 4 fail before serve because `selected_gcps=0` (no spatial gate possible). Validated positioned labels remain 0 because the mandatory by-law code dictionaries could not be read and were not recreated from map text.
