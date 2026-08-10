# Palier 20×167 — rescan S3 après intégration #106 — 2026-08-10T04:25:04Z

## Réconciliation S3

Après l'intégration de #106, `acquisition/src/coverage-reconcile.ts` a relu
le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. Le snapshot
obtenu est horodaté `2026-08-10T04:24:20.612Z` : `pv=1064`, `normes=817`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0`). La
matrice lot→zone a ensuite été régénérée depuis S3, avant le rapport Palier et
son contrôle `--check`.

## Résultat vérifié

| Mesure | Passe précédente | S3 courant après #106 |
|---|---:|---:|
| Résolu total | 1642/3284 (50,0 %) | 1642/3284 (50,0 %) |
| Col. 3 — normes complete | 107/163 | 107/163 |
| Col. 6 — usage dominant complete | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complete | 24/163 | 24/163 |
| Col. 13 — normes pliées complete | 4/163 | 4/163 |

Aucun KPI Palier ne bouge. Les dépôts de campagne normes présents dans #106
ne font pas évoluer une cellule de la cohorte dans les sources autoritaires
consommées par cette matrice ; aucun gain n'est donc déclaré.
