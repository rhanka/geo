# Palier 20×167 — rescan S3 post-Cleveland — 2026-08-10T03:59:39Z

## Réconciliation S3

`acquisition/src/coverage-reconcile.ts` a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. Le snapshot
obtenu est horodaté `2026-08-10T03:58:57.877Z` : `pv=1064`, `normes=816`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` ; seul `normes`
évolue globalement (`+1`). La matrice lot→zone a ensuite été régénérée depuis
S3, avant le rapport Palier et son contrôle `--check`.

## Résultat vérifié

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1642/3284 (50,0 %) | 1642/3284 (50,0 %) |
| Col. 3 — normes complete | 107/163 | 107/163 |
| Col. 6 — usage dominant complete | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complete | 24/163 | 24/163 |
| Col. 13 — normes pliées complete | 4/163 | 4/163 |

Aucun KPI Palier ne bouge : le `+1` de normes du recensement global ne touche
pas une ville de la cohorte Palier. Le reçu Cleveland est une capture ArcGIS
brute/CAS prouvée sur S3 ; sans objet `normalized/`, il ne complète aucune
ville ni cellule Palier.
