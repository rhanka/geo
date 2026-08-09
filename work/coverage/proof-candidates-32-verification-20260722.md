# Proof-candidate 32 verification — 2026-07-22

Local-only verification of the 32 candidate-needs-human-confirmation collections from proof-orphan-356-reconciliation-20260722.json. No network/refetch, S3 read/write, or deployment was performed.

## Rollup

| Classification | Collections | Features |
|---|---:|---:|
| historical-verified | 4 | 251 |
| legacy-traceable | 1 | 502 |
| remains-candidate | 24 | 979 |
| orphan | 3 | 125 |
| **Total** | **32** | **1,857** |

Historical verification is limited to four retained deposit/readback records: lac-sainte-marie, les-bergeronnes, oka, and sainte-petronille. saint-jerome is legacy-traceable only because its source-specific GCP gate records 493 served features rather than audited 502. Three ArcGIS candidates are locally marked deposited=false, zone-invalid, and count-mismatched.

All 22 retained local-PDF identities that remain asserted as source identities had SHA-256 recomputed locally and matched the pre-existing recorded value. JSON contains every original candidate evidence path/pointer, recheck result, and additional retained log/config/git evidence.

## Collections

| Slug | Features | Result | Supported identity |
|---|---:|---|---|
| amherst | 43 | remains-candidate | work/zonage-plans/amherst-602-25.pdf (SHA rechecked) |
| armagh | 61 | remains-candidate | https://gs201.geocentriq.com/geoserver / M19037_Armagh:037y_zonage |
| beaumont | 67 | remains-candidate | https://gs201.geocentriq.com/geoserver / M19105_Beaumont:105y_zonage |
| bethanie | 21 | remains-candidate | work/zonage-pdf/bethanie-zonage-20260717.pdf (SHA rechecked) |
| bowman | 9 | remains-candidate | work/pdf/bowman-zonage-2022.pdf (SHA rechecked) |
| charette | 57 | remains-candidate | work/zonage-plans/charette-zonage-pu.pdf (SHA rechecked) |
| duhamel | 16 | remains-candidate | work/zonage-plans/duhamel-f1.pdf (SHA rechecked) |
| grandes-piles | 13 | remains-candidate | work/zonage-plans/grandes-piles-p1.pdf (SHA rechecked) |
| lac-sainte-marie | 86 | historical-verified | work/pdf-cache/lac-sainte-marie-annexes-2024-08-002.pdf (SHA rechecked) |
| les-bergeronnes | 23 | historical-verified | work/pdf-cache/les-bergeronnes-plan1.pdf (SHA rechecked) |
| montebello | 12 | remains-candidate | work/zonage-plans/montebello-rural.pdf (SHA rechecked) |
| montpellier | 2 | remains-candidate | work/zonage-plans/montpellier-rural.pdf (SHA rechecked) |
| murdochville | 17 | orphan | https://gis.altusquebec.com/arcgis/rest/services/MRC030/03025_Publique/MapServer/14 (rejected) |
| ogden | 47 | remains-candidate | work/pdf-cache/ogden-plan.pdf (SHA rechecked) |
| oka | 103 | historical-verified | work/zonage-pdf/oka-1.pdf (SHA rechecked) |
| rougemont | 46 | remains-candidate | work/gcp/rougemont-urbain.pdf (SHA rechecked) |
| saint-andre-avellin | 28 | remains-candidate | work/zonage-plans/saint-andre-avellin-plan-f1.pdf (SHA rechecked) |
| saint-anselme | 111 | remains-candidate | https://gs201.geocentriq.com/geoserver / M19062_Saint_Anselme:062y_zonage |
| saint-felix-dotis | 57 | remains-candidate | work/zonage-plans/saint-felix-dotis-carto-20260720.pdf (SHA rechecked) |
| saint-francois-de-lile-dorleans | 44 | orphan | https://gis.altusquebec.com/arcgis/rest/services/MRC200/20005_Publique/MapServer/17 (rejected) |
| saint-henri | 86 | remains-candidate | https://gs201.geocentriq.com/geoserver / M19068_Saint-Henri:068y_zonage |
| saint-jerome | 502 | legacy-traceable | work/pdf/saint-jerome/plan.pdf (SHA rechecked) |
| saint-leon-de-standon | 53 | remains-candidate | https://gs201.geocentriq.com/geoserver / M19020_Saint_Leon:020y_zonage |
| saint-maxime-du-mont-louis | 28 | remains-candidate | work/zonage-plans/saint-maxime-du-mont-louis-plan.pdf (SHA rechecked) |
| saint-nazaire-de-dorchester | 20 | remains-candidate | https://gs201.geocentriq.com/geoserver / M19015_St_Nazaire:015y_zonage |
| saint-pierre-baptiste | 57 | remains-candidate | work/zonage-plans/saint-pierre-baptiste-f1.pdf (SHA rechecked) |
| saint-pierre-de-lile-dorleans | 64 | orphan | https://gis.altusquebec.com/arcgis/rest/services/MRC200/20025_Publique/MapServer/17 (rejected) |
| sainte-emelie-de-lenergie | 52 | remains-candidate | work/zonage-plans/sainte-emelie-de-lenergie.pdf (SHA rechecked) |
| sainte-justine-de-newton | 14 | remains-candidate | work/zonage-pdf/sainte-justine-de-newton.pdf (SHA rechecked) |
| sainte-monique--lac-saint-jean-est | 21 | remains-candidate | work/zonage-plans/sainte-monique--lac-saint-jean-est-map-20260720.pdf (SHA rechecked) |
| sainte-petronille | 39 | historical-verified | http://stepetronille.com/wp-content/uploads/2023/12/annexe_1_plan_zonage.pdf |
| sainte-therese-de-la-gatineau | 58 | remains-candidate | work/zonage-plans/sainte-therese-de-la-gatineau-plan-20260720.pdf (SHA rechecked) |

## Human questions

- saint-jerome: can an owner supply retained deposit/readback or approved reconciliation explaining 493 versus 502 features?
- sainte-emelie-de-lenergie: which record is authoritative—the success-labeled committed GCP/dictionary change or the later retained rejection of the same PDF? Neither binds 52 features.
- Each remaining candidate needs retained deposit/readback or signed source-to-collection record; PDF/GCP artifact or count-matched remote-layer probe alone is insufficient.
- For murdochville, saint-francois-de-lile-dorleans, and saint-pierre-de-lile-dorleans, is there a different retained original source? The only local ArcGIS candidates were expressly rejected.

See proof-candidates-32-verification-20260722.json for exact evidence paths, JSON pointers, source identities, hash rechecks, and per-collection questions.
