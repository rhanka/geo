# Zones platform R2 AGOL - 2026-07-07

## Result

- New net zoning deposited for `saint-jean-de-lile-dorleans`.
- New net zoning deposited for `mirabel`.
- Sources are public ArcGIS Online FeatureServer layers; no SIGALE or Geocentriq source used.

## Sources

### saint-jean-de-lile-dorleans

- FeatureServer layer: `https://services8.arcgis.com/GbbSwEysvC2sv6Y6/arcgis/rest/services/Limite_du_zonage/FeatureServer/4`
- Layer title: `Limite du zonage`
- Zone field: `Usage`

### mirabel

- FeatureServer layer: `https://services9.arcgis.com/y9EASLisYHhvZ7vM/arcgis/rest/services/Zonage/FeatureServer/0`
- Layer title: `Zonage_s_mirabel`
- Zone fields: `contents` + `contents1`, composed as `<contents>-<contents1>`

## Gates

- S3 precheck: both slugs absent before deposit.
- `saint-jean-de-lile-dorleans`: 62 polygon features, 62 non-null zone codes, 61 distinct codes, 100% lettered/code-like, 0% pure integers, max length 7.
- `saint-jean-de-lile-dorleans`: bbox center `[46.9411,-70.9129]`, distance to registry centroid `0.43 km`, nearest registry muni `saint-jean-de-lile-dorleans`.
- `mirabel`: 712 polygon features, 712 non-null zone codes, 711 distinct codes, 100% lettered/code-like, 0% pure integers, max length 8.
- `mirabel`: bbox center `[45.6521,-74.0591]`, distance to registry centroid `0.06 km`, nearest registry muni `mirabel`.
- Rejected candidate: `saint-hugues` RBMSH seeded ArcGIS layer returned `no-zonage-layer` in `zones-obscura-run`; not deposited.

## Deposits

- `normalized/ca-qc-zonage/qc-zonage-saint-jean-de-lile-dorleans.geojson`
- `normalized/qc-lot-zonage/saint-jean-de-lile-dorleans.parquet`
- `normalized/qc-lots/qc-lots-saint-jean-de-lile-dorleans.geojson`
- `normalized/ca-qc-zonage/qc-zonage-mirabel.geojson`
- `normalized/qc-lot-zonage/mirabel.parquet`
- `normalized/qc-lots/qc-lots-mirabel.geojson`

## Verification

- `zones-s3-check`: both slugs `PRESENT`; total zonage slugs now 726.
- `lot-zone-join-run --verify-only`: `saint-jean-de-lile-dorleans` 1,076 lots, 99.44% assigned, 4.83% multi-zone, parquet/stats verified.
- `lot-zone-join-run --verify-only`: `mirabel` 7,746 lots, 100% assigned, 2.04% multi-zone, parquet/stats verified.
- `lots-enriched-run --verify-only`: `saint-jean-de-lile-dorleans` 1,076 lots, 99.44% `zone_code`, 100% surface, 100% FSA/RTA code postal, deposit verified (`1,959,872` bytes).
- `lots-enriched-run --verify-only`: `mirabel` 7,746 lots, 100% `zone_code`, 100% surface, 100% FSA/RTA code postal, deposit verified (`18,465,232` bytes).

Notes:

- `lot-zone-join-run` reports 0% norms match for both slugs because no matching `qc-zonage-norms` parquet is currently present; zoning and lot products are still deposited and verified.
- `lots-enriched-run` used `--no-role`, so address fields are null while zoning, surface, and RTA enrichment are present.
- `mirabel` lot-zone join used `--simplify-zones-m 1` in memory only; the served zoning GeoJSON was not simplified or altered.
- `coverage-matrix.json` was not edited manually.
