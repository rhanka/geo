# ZONES-REACQ-HARD Codex - 2026-07-07

Worker: native Codex

Scope: `charlemagne`, `deux-montagnes`, `dollard-des-ormeaux`,
`saint-bruno-de-montarville`, `saint-gabriel-de-brandon`.

## Result

One strict deposit completed: `dollard-des-ormeaux`.

Official source:

`https://ville.ddo.qc.ca/wp-content/uploads/2024/01/Plan-de-zonage-R-2025-199.pdf`

The DDO municipal by-law page also links the zoning by-law R-2025-199 and the
separate `PLAN DE ZONAGE`. The separate plan is the exploitable zoning source:
it is an AutoCAD Map 3D 2025 PDF, page 1, with selectable zone labels.

## Anti-invention evidence

- `pdf-zone-codes` found 148 distinct plan codes, including `C-200`, `C-202`,
  `P-216`, `R-100`, `R-334`.
- `t2-build` used 4 existing DDO GCPs and selectable PDF text labels.
- No OCR, no numeric-only bridge, no affectation layer, no code conversion.
- Spatial gate: label centroid 0.497 km from cadastre centroid.
- Lot coverage: 12,559 / 12,563 lots assigned, 99.94% cadastre area covered.

S3 zonage deposit:

`normalized/ca-qc-zonage/qc-zonage-dollard-des-ormeaux.geojson`

Stats summary:

- source: `official-ddo-r2025-plan`
- confidence: `official-pdf-text-gcp`
- served features: 86
- distinct extracted labels: 147
- label mode: text

## Strict gate

Command:

`npx tsx acquisition/src/verify-zone-overlap.ts --slugs dollard-des-ormeaux`

Result:

`PASS dollard-des-ormeaux features=86 distinct=86 codeLike=100% norms=31 overlap=12 key=normalized/ca-qc-zonage/qc-zonage-dollard-des-ormeaux.geojson sample=["P-532","R-334","C-200","R-322","P-524","P-526","R-514","R-328"]`

Summary:

`SUMMARY pass=1 [dollard-des-ormeaux] fail=0 [] absent=0`

## Lot products

`lot-zone-join-run` was first attempted without simplification and stopped after
no completion in a reasonable window. The rerun used `--simplify-zones-m 1`,
which only simplifies the in-memory intersection geometry and does not change
the served zoning GeoJSON.

Command:

`npx tsx acquisition/src/lot-zone-join-run.ts --slugs dollard-des-ormeaux --simplify-zones-m 1`

Result:

`OK dollard-des-ormeaux lots=12563 assigned=99.99% multi=0.01% match=15.13% without_norms=84.87% verify parquet=Y stats=Y rows=12563`

Warning retained:

`zone_code norm match rate 15.13% < 95%`

Reason: the current norms parquet has only 31 codes, while the official R-2025
plan deposit serves 86 zone features. This is an honest partial norms coverage
warning, not a zoning gate failure.

`lots-enriched-run` result:

`OK dollard-des-ormeaux lots=12563 zone_code=99.99% norms=15.13% surface=100% code_postal=100%(RTA) adresse=92.87%(code=66142) tod=n/a deposit=Y bytes=30841112`

## Other target slugs

No deposit was made for the other four slugs in this pass.

- `charlemagne`: existing served artifact is a single `URB` affectation code;
  official page exposes a plan image, but no structured/text zoning deposit was
  made under the strict gate.
- `deux-montagnes`: official zoning PDF links were found, but the current served
  SIG codes and norms remain millesime-disjoint under the gate.
- `saint-bruno-de-montarville`: official plan and strong autogcp exist, but prior
  evidence still shows no validated label dictionary deposit; no invented labels.
- `saint-gabriel-de-brandon`: official annex links were found; current WFS-style
  deposit is numeric-only and no prefix conversion was made.

