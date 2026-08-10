# Dépôt v2 vecteur natif — record (2026-08-10)

Capture cluster `geo-capture-zones-20260810t100500z` (run-stamp `20260810T100500Z`,
5 shards, **Complete 5/5**). Chemin de dépôt RÉUTILISÉ (déjà committé, 20260803) :
manifeste dérivé des OCTETS CAS par `zones-vecteur-natif-manifest-run.ts`, dépôt
octet-vérifié + gates identité/couverture/régression par `zones-vecteur-natif-deposit-run.ts`
(`depositCapturedZones` → `putServedZoneGeojson`, re-fold enrichment, re-stamp `zone_source_url`).
Preuve v2 = `{url, retrieved_at, sha256}` du manifeste de capture ; `type=arcgis method=natif reliability=directe`.

Chaque capture a été RE-HASHÉE (sha256 des octets CAS == sha annoncé == sha de la clé CAS)
et confirmée FeatureCollection non vide avant tout dépôt (`_zones-vnatif-resolve-20260810.ts`).

## 3 DÉPOSÉS → `zone_source_level=documented` (readback VERIFIED)

| slug | features | champ zone | level avant→après | clé servie |
|---|---:|---|---|---|
| longueuil | 1927 | `Zonage` | candidate→documented | nested |
| salaberry-de-valleyfield | 645 | `ZONE` | orphan→documented | nested |
| westmount | 159 | `ZoneNumber` | documented→documented | nested |

Vérification indépendante (`_zones-vnatif-verify-20260810.ts`) : pour chacun,
`feature_count`==capturé, `proof.schema_version=2.0`, `geometry_source.url`+`sha256`==manifeste,
et **toutes** les features portent `zone_source_level=documented` + `zone_source_url`==url de preuve + proof v2.

Notes :
- longueuil : remplace une géométrie `candidate` (donneesquebec) par la couche AGOL VilleLongueuil.
- salaberry : première preuve (servi `orphan`, `zone_source_url=null` auparavant).
- westmount : re-déposé avec la couche COMPLÈTE (`outFields=*`) ; la preuve précédente
  utilisait `outFields=ZoneNumber` (tronquée). Backups `_replaced/` pris pour les 3.

## 2 SKIP (capture réelle et valide, dépôt refusé — anti-invention / anti-régression)

| slug | features capturées | sha256 | raison |
|---|---:|---|---|
| saint-hyacinthe | 1066 | `599f769e…` | **gate identité** : 852 codes servis absents de la couche amont. Servi (1091 feat, `candidate`, source `arcgis.st-hyacinthe.ca` ISOGEO SigimProd FS/13) code `NO_ZONE`+affectation (ex `5048H`) ; la capture `Zonage_SHY` porte `ETQ_ZONE` (ex `5048-R`). Conventions différentes → non-recouvrement. HELD, pas de dépôt forcé (cf bernard/jude 20260803). |
| mirabel | 712 | `48c92b70…` | **code composite** non représentable en single-field : code réel = `contents` (classe, ex `H`, 9 distinct) + `contents1` (ex `7-3`, 711 distinct) = `H 7-3`. Aucun champ unique ne porte le code complet (`nom` = affectation). Déposer `contents1` seul amputerait la classe → anti-invention. À traiter par un chemin composite dédié. |

Les octets des 2 SKIP sont capturés, re-hashés et durables sur S3 (CAS) : re-déposables
sans re-capture dès que (a) la réconciliation SHY tranche capture vs servi orphan/candidate,
et (b) un chemin de dépôt composite (contents+contents1) existe.

## Suite
- SHY : investiguer capture `Zonage_SHY` (ETQ_ZONE) vs servi ISOGEO (NO_ZONE+affect) —
  quelle couche est la grille réglementaire courante ? Trancher avant tout remplacement.
- mirabel : capitaliser un chemin de dépôt composite (zone_field multi-champ) dans la lib, avec test.
- Ping lot : re-fold lots sur les 3 déposés (`rectifier-zone-exige-refold-lots`).
