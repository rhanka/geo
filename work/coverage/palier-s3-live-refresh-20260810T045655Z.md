# Palier 20×167 — rescan S3 post-Saint-Placide — 2026-08-10T04:56:55Z

## Réconciliation S3

Après le merge `2b2c5af1` (PR #116), `acquisition/src/coverage-reconcile.ts`
a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. La couverture
fraîche est horodatée `2026-08-10T04:56:33.502Z` : `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0` pour
cette passe). La matrice lot→zone a été régénérée intégralement depuis cette
couverture, avant le rapport Palier et son contrôle `--check`.

## Matrice vérifiée

La matrice générée à `2026-08-10T04:56:55.884Z` passe le contrôle complet :
partitions fermées, déterminisme et `unknown != complete`.

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1642/3284 (50,0 %) | 1642/3284 (50,0 %) |
| Col. 5 — règlement complet | 83/163 | 83/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

Aucune cellule Palier ne change. Le merge #116 apporte une configuration et un
artefact de règlement ; il ne constitue pas, à lui seul, une capture normalisée
consommée par les critères par ville. Aucune ville ni cellule Palier n'est donc
promue par inférence.
