# Tranche des 2 HELD gonet — résolution 2026-08-03

Cellules : **saint-bernard-de-michaudville**, **saint-jude**.
Diagnostic committé : `b371eb73` (sonde `acquisition/src/_zones-held-diagnose.ts`).

## Faits (committés)

- Ma capture GOnet est **COMPLÈTE** (`exceededTransferLimit=false` ; bernard 39 feat/37 codes,
  jude 43 feat/43 codes).
- Le servi **orphan** (81 feat) n'est **PAS** un Voronoï : `confidence=disaggregated-from:
  ca-qc-zonage-geomatiquecn-arcgis` — une source **ArcGIS tierce réelle**, portant **PLUS** de
  codes que ma capture GOnet (bernard 39 vs 37, jude 47 vs 43), mais au niveau `orphan` (non prouvé).

## Décision — NE PAS déposer GOnet

Déposer ma capture GOnet **régresserait** la couverture servie : on perdrait des codes réels de la
source tierce. C'est exactement ce que le **gate anti-régression** interdit (règle « aucun dépôt qui
régresse le servi », cohérente anti effet-fabriqué). Les 2 cellules **restent HELD**.

## Chemin d'amélioration (queue)

Upgrader `orphan → documented` sans régresser exige de capturer **la source
`geomatiquecn-arcgis` elle-même AVEC preuve v2** (superset prouvé octet-pour-octet), pas de forcer
GOnet. Contrainte : `live returnCountOnly=403` — le proxy goazimut bloque le fetch direct hors
session ⇒ passer par **obscura headless** (`--service <FeatureServer geomatiquecn>/query?f=geojson`
avec filtre muni, session navigateur). Mise en file **derrière le batch arcgis** (même famille de
plateforme). Tant que ce superset prouvé n'est pas capturé, l'état servi orphan actuel est **conservé**
(supérieur en codes à ma capture) — statu quo justifié, pas un dépôt fabriqué.
