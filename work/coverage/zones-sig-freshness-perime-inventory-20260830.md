# Zones SIG freshness/périmé inventory — geo-archi §3 (merged)

- Generated (UTC): 2026-08-30T23:34:58.275Z
- Read-only merge JOIN on `slug` of two committed layers. No network, no S3, no PDF re-parse.
- Served munis: **873** (one row each). Partitions asserted to close to 873.

## Inputs (committed)

- Layer 1 (capture freshness): `work/coverage/zones-sig-freshness-inventory-20260830.json` (commit 8fc76408), inventory key `rows`.
- Layer 2 (SIG↔DEPOSITED-normes mismatch, lower bound): `work/coverage/zones-code-mismatch-broadcity-20260830.json` (commit 747bd0e7).

## Three périmé axes (partitions close to 873)

### 1. Capture freshness (retrieved_at)

| class | munis |
|---|---:|
| fresh | 364 |
| source-gap | 509 |
| stale | 0 |
| **total** | **873** |

### 2. Upstream vintage (explicit marker only)

| class | munis |
|---|---:|
| marker_suspect | 1 |
| source-gap (not-measurable) | 872 |
| **total** | **873** |

### 3. DEPOSITED-normes mismatch (LOWER BOUND on true perime)

| class | munis |
|---|---:|
| munis_with_mismatch | 617 |
| clean | 110 |
| normes_source_gap (not-assessable) | 146 |
| assessable (mismatch + clean) | 727 |
| **total** | **873** |

> DEPOSITED-layer mismatch is a LOWER BOUND: `expandCategoryZonesToSig` relabels category norms onto the muni's own SIG codes and re-stamps, so a SIG-expanded deposit absorbs the SIG set and under-reports mismatch. True raw-grille-PDF perime is source-gap read-only (needs cluster PDFs).

## Resource worklist (owner-gated, NOT executed)

- 510 candidates, carried verbatim from layer 1, re-ordered.
- Order: #1 vintage-suspect (mont-tremblant, Ancien_zonage, superseded millésime 2008); then source-gaps by least-proven provenance (null-level < orphan < candidate < legacy-traceable < historical-verified < documented).

Head of the worklist:

| # | slug | reason | freshness | level |
|---:|---|---|---|---|
| 1 | mont-tremblant | source-perime-suspect | MEASURED-FRESH | documented |
| 2 | les-cedres | source-gap | SOURCE-GAP | null |
| 3 | amos | source-gap | SOURCE-GAP | orphan |
| 4 | brownsburg-chatham | source-gap | SOURCE-GAP | orphan |
| 5 | cap-sante | source-gap | SOURCE-GAP | orphan |
| 6 | charlemagne | source-gap | SOURCE-GAP | orphan |
| 7 | chateau-richer | source-gap | SOURCE-GAP | orphan |
| 8 | compton | source-gap | SOURCE-GAP | orphan |
| 9 | cote-saint-luc | source-gap | SOURCE-GAP | orphan |
| 10 | denholm | source-gap | SOURCE-GAP | orphan |
| 11 | deschambault-grondines | source-gap | SOURCE-GAP | orphan |
| 12 | dixville | source-gap | SOURCE-GAP | orphan |

