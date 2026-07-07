# ZONES GONET resume 2026-07-07

Scope: resume incomplete GoNet zoning shards `08` to `17` from
`work/delegation-mass/zones-gonet-final`.

## Local shard state

`out/` contains completed JSON reports only for `shard-00` to `shard-07`.
The resume window is still incomplete:

| shard | pairs | completed in log | remaining | last logged |
|---|---:|---:|---:|---|
| 08 | 50 | 18 | 32 | notre-dame-de-montauban |
| 09 | 50 | 18 | 32 | lac-sergent |
| 10 | 50 | 0 | 50 | - |
| 11 | 50 | 0 | 50 | - |
| 12 | 50 | 0 | 50 | - |
| 13 | 50 | 0 | 50 | - |
| 14 | 50 | 0 | 50 | - |
| 15 | 50 | 0 | 50 | - |
| 16 | 50 | 0 | 50 | - |
| 17 | 41 | 0 | 41 | - |

Total remaining in this window: 455 pairs.

## Beauce-Sartigan result

Shard 09 had one confirmed real GoNet zoning deposit:

- `courcelles-saint-evariste=29027`
- source layer:
  `https://www.goazimut.com/gis109-11/arcgis/rest/services/290_BeauceSartigan/29027_CourcellesSaintEvariste/MapServer/163`
- source field: `NO_ZONE`
- deposited zoning: 91 polygons, 91 non-null `zone_code`
- anti-invention gate: source field values were accepted by the existing
  `zones-obscura-run.ts` value-based zone-code validator before S3 deposit.

Post-processing completed on 2026-07-07:

- `lot-zone-join-run.ts --slugs courcelles-saint-evariste`
  - 1191 lots
  - 99.92% assigned
  - 2.52% multi-zone
  - parquet and stats verified in S3
  - norms match rate 0%, because no `qc-zonage-norms` parquet exists for this slug
- `lots-enriched-run.ts --slugs courcelles-saint-evariste`
  - 1191 lots
  - `zone_code` on 99.92%
  - `surface_m2` on 100%
  - `code_postal` FSA/RTA on 100%
  - `adresse` on 90.09% using role code `29027`
  - `normalized/qc-lots/qc-lots-courcelles-saint-evariste.geojson` verified in S3

S3 status check:

| slug | zones | normes | pv | cadastre |
|---|---|---|---|---|
| courcelles-saint-evariste | OK | -- | OK | OK |

## Runtime blocker

GoAzimut was not reachable from this runtime during the resume attempt:

- `curl -4` to `https://www.goazimut.com/` timed out.
- `curl -4` to the known Beauce-Sartigan MapServer layer timed out.
- `curl -4` to `https://www.goazimut.com/GOnet6/?m=29027&pl=1` timed out.
- A native headless rerun for `saint-ephrem-de-beauce=29112` started Chromium but
  hung without producing a MapServer proxy result and was interrupted.

Because of this external network condition, no additional GoNet MapServer /
FeatureServer could be verified or deposited in this session without risking
invented or unvalidated zoning.
