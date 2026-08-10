# Palier 20×167 — rescan S3 post-merge #128 — 2026-08-10T05:45:33Z

Le merge `dc72bab2` (PR #128, campagne normes col. 7) a été intégré à la
branche de mesure puis la couverture a été relue directement depuis S3 avec
`NODE_OPTIONS=--dns-result-order=ipv4first` et `AWS_MAX_ATTEMPTS=10`.
La réconciliation fraîche, horodatée `2026-08-10T05:45:09.487Z`, donne
`pv=1064`, `normes=818`, `zones=911`, `cadastre=1106`,
`role-foncier=1106`, `tod=39` (tous `+0` dans cette passe).

La matrice lot→zone a été recalculée entièrement, puis
`palier-matrix-report.mjs --date=20260810 --check` réussit. La comparaison avec
la passe S3 précédente est inchangée :

| Mesure | Avant | Après #128 |
|---|---:|---:|
| Résolu total | 1645/3284 (50,091 %) | 1645/3284 (50,091 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 86/163 | 86/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

Les nouvelles captures ou découvertes normes sont partielles au regard des
règles Palier : aucune ville n'est déclarée complète par inférence et aucun
gain KPI n'est crédité.
