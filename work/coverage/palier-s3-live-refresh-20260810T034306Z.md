# Palier 20×167 — rescan S3 post-Carleton-sur-Mer — 2026-08-10T03:43:06Z

## Réconciliation S3

`acquisition/src/coverage-reconcile.ts` a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. Le snapshot
obtenu est horodaté `2026-08-10T03:42:34.747Z` : `pv=1064`, `normes=815`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0`). La
matrice lot→zone a ensuite été régénérée, avant le rapport Palier et son
contrôle `--check`.

## Résultat vérifié

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1642/3284 (50,0 %) | 1642/3284 (50,0 %) |
| Col. 6 — usage dominant complete | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complete | 24/163 | 24/163 |
| Col. 13 — normes pliées complete | 4/163 | 4/163 |

Aucun KPI ne bouge. Le reçu Carleton-sur-Mer est une capture ArcGIS brute/CAS
prouvée sur S3 ; sans objet `normalized/`, il ne complète aucune ville ni
cellule Palier.
