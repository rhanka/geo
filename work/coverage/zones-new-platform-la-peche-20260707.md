# Zones new platform - La Peche - 2026-07-07

## Result

- New net zoning deposited for `la-peche`.
- Source: official municipal ArcGIS Experience linked from `https://www.villelapeche.qc.ca`.
- Web Experience: `https://experience.arcgis.com/experience/8ccfb20aa6c4423bb33520aec90d45c3/page/Page?draft=true`
- WebMap: `https://LaPeche.maps.arcgis.com/sharing/rest/content/items/020e424aedeb430a9866c32d57ca6ac0`
- FeatureServer layer: `https://services3.arcgis.com/FYdKzW9hDQnh6umB/arcgis/rest/services/G%C3%A9oTest/FeatureServer/15`
- Layer title in WebMap: `Decoupage zones 113 2025`
- Zone field: `NumRevise`

## Gates

- S3 precheck: `la-peche` absent before deposit.
- ArcGIS layer: 167 polygon features.
- Zone-code field: 167 non-null values, 167 distinct codes, 100% lettered/code-like, 0% pure integers, max length 7.
- Rejected field: `Affectatio` is affectation text, 12 distinct values, 0% code-like.
- Spatial gate: bbox center `[45.7015,-76.0701]`, distance to registry centroid `0.69 km`, nearest registry muni `la-peche`.
- Norms overlap probe: 44 distinct norms codes, 39 joined zone codes after join canonicalization.

## Deposits

- `normalized/ca-qc-zonage/qc-zonage-la-peche.geojson`
- `normalized/qc-lot-zonage/la-peche.parquet`
- `normalized/qc-lots/qc-lots-la-peche.geojson`

## Verification

- `zones-s3-check`: `la-peche PRESENT`; total zonage slugs now 723.
- `lot-zone-join-run --verify-only`: 2,233 lots, 99.91% assigned, 1.34% multi-zone, 33.21% norms match, parquet/stats verified.
- `lots-enriched-run --verify-only`: 2,233 lots, 99.91% `zone_code`, 33.18% norms, 100% surface, 100% FSA/RTA code postal, deposit verified (`5,351,540` bytes).

Notes:

- The first `lots-enriched-run` with role-foncier address lookup was terminated before writing output. The successful final pass used `--no-role`; address fields are therefore null, while zoning, norms, surface, and RTA enrichment are present.
- `coverage-matrix.json` was not edited manually.
