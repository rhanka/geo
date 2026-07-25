# ZONES AGOL/HUB - 2026-07-07

Scope: residual QC zoning through official AGOL/ArcGIS Hub accounts, with no
manual coverage-matrix edit.

## First Reads

- `acquisition/src/arcgis-search-summ.ts`
- `scripts/arcgis-probe.mjs`
- `acquisition/src/zones-obscura-run.ts`
- `acquisition/src/zones-arcgis-serve.ts`

## Discovery

- Broad AGOL search for `zonage` surfaced the official MRC du Granit account:
  `geomatiquemrcdugranit_granit`.
- Service selected:
  `https://services6.arcgis.com/qVhfI6UTbRNL5Gfd/arcgis/rest/services/Zonage/FeatureServer`
- Layer selected: `/5`, `Zonage`, polygon layer.
- Residual AA slug in that MRC: `saint-sebastien--le-granit`.
- Additional AGOL searches on the largest AA MRC buckets and sample city slugs
  did not return another usable official zoning FeatureServer in this pass.

## Gate

- Muni filter: `MUNI='Saint-Sébastien'` from backend value `Saint-Sébastien`.
- Zone field: `NO_ZONE`.
- Backend count after muni filter: 44 features.
- Spatial gate: 1.04 km from registry centroid.
- Distinct zone codes from deposited SIG layer: 41 verbatim / 41 canonical.
- Sample verbatim codes:
  `A-1`, `A-2`, `A-3`, `A-4`, `A-5`, `AFT1-1`, `AFT2-3`,
  `I-1`, `IL-69`, `M-1`, `P-1`, `R-5`, `REC-1`.
- Norms overlap after shared join canon: 21 / 41 zone codes and 21 / 40 norms
  codes.

## Deposits

- Zones:
  `normalized/ca-qc-zonage/qc-zonage-saint-sebastien--le-granit.geojson`
  - 44 polygons
  - 44 with `zone_code`
  - source field copied verbatim from `NO_ZONE`
- Lot-zone parquet:
  `normalized/qc-lot-zonage/saint-sebastien--le-granit.parquet`
  - 772 rows
  - 99.87% lots assigned
  - 73.67% zone-code to norms match
- Served lots:
  `normalized/qc-lots/qc-lots-saint-sebastien--le-granit.geojson`
  - 772 lots
  - 99.87% with `zone_code`
  - 73.58% with norms
  - 100% with `surface_m2`
  - 100% with RTA `code_postal`
  - 89.77% with address
  - deposit verified, 2,414,490 bytes

## Verification

- `npx vitest run src/zones-obscura-run.test.ts`: 18 tests passed.
- `zone-codes-report.ts saint-sebastien--le-granit`: grid and norms present,
  canonical overlap 21.
- No coverage matrix/manual track write included here; S3 is the source of truth
  and `coverage-reconcile.ts` can refresh the matrix in a clean conductor pass.
