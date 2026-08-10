# Scoping — opportunité upgrade v2 candidate→documented (zones servies)

Généré 2026-08-10T14:54:50.379Z — READ-ONLY. Données: 2026-08-10 (fresh read-only S3 scan of normalized/ca-qc-zonage/).

## Méthode

Scan **lecture seule** S3 frais: list `normalized/ca-qc-zonage/` + lecture **par plage
du premier feature** de chaque collection servie (nested-when-present). Pas de
téléchargement de géométrie complète. `zone_source_level` / `zone_source_url` /
preuve v2 (`featureHasV2Proof`) extraits du premier feature (uniforme, garanti au bord
d'écriture). Sonde: `acquisition/src/_zones-v2-upgrade-scoping-scan.ts` (non committée) ;
brut: `work/coverage/_zones-v2-upgrade-scoping-scan-raw-20260810.json`.
Le portfolio artifact `zone-provenance-quality-matrix-20260803…json` a été vérifié mais
ne porte pas `zone_source_url` par slug → un scan frais était nécessaire pour séparer
UPGRADABLE de NO-URL.

## Compartiments (partition fermée des 873 collections servies)

| bucket | définition | n |
|---|---|---|
| **PROVEN** | level ∈ {documented, historical-verified} + preuve v2 | **179** |
| **UPGRADABLE** | level ∈ {candidate, orphan, legacy-traceable, unknown} + zone_source_url http(s) réel + pas de v2 | **388** |
| **NO-URL** | level non-prouvé + zone_source_url null | **278** |
| **DECLARED-DOC-NO-V2** | level documented/historical-verified SANS bloc de preuve v2 (déclaré, non capté) | **28** |
| **UNKNOWN-PROVENANCE** | level absent/indéterminable | **0** |
| total servi | | **873** |

(1106 catalogue − 873 servies ≈ 233 non-servies, hors périmètre "zones servies".)

## UPGRADABLE — détail (388)

Par niveau: {"legacy-traceable":374,"candidate":14}
Par classe d'endpoint: {"geoserver-wfs":147,"arcgis-rest":229,"other-http":6,"pdf-plan (georeference, NOT source-identity)":6}

- **Estimation capturable par source-identité** (arcgis-rest + geoserver-wfs): **376** (BORNE HAUTE — automatabilité empirique non garantie).
- **PDF (georeference, PAS source-identité)**: 6.

### Top hosts UPGRADABLE

| host | n |
|---|---|
| www.goazimut.com | 184 |
| geoserver.geocentralis.com | 147 |
| geo.victoriaville.ca | 12 |
| gis.altusquebec.com | 12 |
| services.arcgis.com | 7 |
| services6.arcgis.com | 6 |
| sig.mrcal.ca | 3 |
| portneuf.blob.core.windows.net | 3 |
| services8.arcgis.com | 3 |
| www.arcgis.com | 2 |
| geo.ville.alma.qc.ca | 1 |
| www.chelsea.ca | 1 |
| services9.arcgis.com | 1 |
| www.villagedehemmingford.ca | 1 |
| preissac.com | 1 |
| carte.rouyn-noranda.ca | 1 |
| st-amable.qc.ca | 1 |
| www.municipalite.saint-armand.qc.ca | 1 |
| stepetronille.com | 1 |

### NET-NEW vs campagne coverage-bound

- Ensemble campagne (large, superset des ~52 coverage-bound traités): 177 slugs.
- UPGRADABLE ∩ campagne: 19 → chateauguay, farnham, havelock, howick, saint-bernard-de-lacolle, saint-chrysostome, saint-damase--les-maskoutains, saint-denis-sur-richelieu, saint-francois-xavier-de-brompton, saint-honore-de-temiscouata, saint-jean-de-la-lande, saint-juste-du-lac, saint-louis-du-ha-ha, saint-ludger, saint-ours, saint-paul, saint-pierre, tres-saint-sacrement, vaudreuil-dorion
- **NET-NEW UPGRADABLE (au-delà de la campagne): 369**
- (∩ set 20260810 réellement déposé/skippé: 0)

### Échantillon — 20 premiers UPGRADABLE (slug, level, host, classe, in-campaign)

| slug | level | url host | endpoint class | in-campaign |
|---|---|---|---|---|
| adstock | legacy-traceable | geoserver.geocentralis.com | geoserver-wfs | n |
| albanel | legacy-traceable | www.goazimut.com | arcgis-rest | n |
| albertville | legacy-traceable | geoserver.geocentralis.com | geoserver-wfs | n |
| alma | legacy-traceable | geo.ville.alma.qc.ca | other-http | n |
| amqui | legacy-traceable | geoserver.geocentralis.com | geoserver-wfs | n |
| aston-jonction | legacy-traceable | www.goazimut.com | arcgis-rest | n |
| authier | legacy-traceable | www.goazimut.com | arcgis-rest | n |
| authier-nord | legacy-traceable | www.goazimut.com | arcgis-rest | n |
| baie-comeau | legacy-traceable | geoserver.geocentralis.com | geoserver-wfs | n |
| baie-du-febvre | legacy-traceable | www.goazimut.com | arcgis-rest | n |
| baie-saint-paul | legacy-traceable | www.goazimut.com | arcgis-rest | n |
| baie-sainte-catherine | legacy-traceable | www.goazimut.com | arcgis-rest | n |
| baie-trinite | legacy-traceable | geoserver.geocentralis.com | geoserver-wfs | n |
| barraute | legacy-traceable | geoserver.geocentralis.com | geoserver-wfs | n |
| batiscan | legacy-traceable | www.goazimut.com | arcgis-rest | n |
| beauceville | legacy-traceable | geoserver.geocentralis.com | geoserver-wfs | n |
| beaulac-garthby | legacy-traceable | geoserver.geocentralis.com | geoserver-wfs | n |
| beaupre | legacy-traceable | services6.arcgis.com | arcgis-rest | n |
| bedford--brome-missisquoi--2 | legacy-traceable | www.goazimut.com | arcgis-rest | n |
| berry | legacy-traceable | geoserver.geocentralis.com | geoserver-wfs | n |

(Liste complète des 388 dans le JSON `upgradable_list`.)

## Caveats

- UPGRADABLE counts PRESENCE of a real http(s) zone_source_url, NOT verified liveness. A per-URL liveness sweep (acquisition/src/zones-served-proof-url-liveness-sweep.ts style) is the next refinement to confirm which are still capturable now.
- Endpoint classes are pattern-based on the URL. arcgis-rest (goAzimut, altusquebec, victoriaville, services*.arcgis.com) and geoserver-wfs (geocentralis /geoserver/ows) are geometry endpoints in principle; empirical automatability is NOT guaranteed (prior lane verdicts found several platform sources non-automatable: MapServer without geojson export, access controls, layer-identity mismatch). Treat the source_identity_capturable_estimate as an UPPER BOUND on the source-identity yield.
- The 6 pdf-plan URLs are real http URLs but require georeference, not the source-identity method; excluded from the source-identity estimate.
- zone_source_level / zone_source_url read from the FIRST feature; the write gates enforce uniformity across features, so the first feature is authoritative.
- DECLARED-DOC-NO-V2 (28) are declared documented/historical-verified without a v2 proof block; they are provenance-declared, not byte-captured, and sit outside both PROVEN and the upgradable level set.
- 873 served collections vs 1106 catalogue: ~233 have no served collection (unserved) and are outside 'served zones' scope.
