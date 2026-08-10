# Palier 20×167 — rescan S3 post-merge #132 — 2026-08-10T05:52:56Z

Après intégration du merge `f794fce6` (PR #132), la couverture a été relue
depuis S3 avec `NODE_OPTIONS=--dns-result-order=ipv4first` et
`AWS_MAX_ATTEMPTS=10`. La réconciliation fraîche est horodatée
`2026-08-10T05:52:34.378Z` et donne `pv=1064`, `normes=818`, `zones=911`,
`cadastre=1106`, `role-foncier=1106`, `tod=39`, tous `+0`.

La matrice lot→zone est recalculée entièrement et le rapport Palier passe
`--check` (partitions fermées, déterminisme et `unknown != complete`).

| Mesure | Avant | Après #132 |
|---|---:|---:|
| Résolu total | 1645/3284 (50,091 %) | 1645/3284 (50,091 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 86/163 | 86/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

Le document règlement ajouté est partiel selon les règles de complétude : il ne
ferme aucune ville et ne produit aucun gain KPI par inférence.
