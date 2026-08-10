# Palier 20×167 — rescan S3 post-Biencourt — 2026-08-10T03:27:58Z

## Réconciliation S3

`acquisition/src/coverage-reconcile.ts` a été exécuté contre le stockage objet
avec `NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. La
couverture résultante est horodatée `2026-08-10T03:27:14.306Z` :
`pv=1064`, `normes=815`, `zones=911`, `cadastre=1106`, `role-foncier=1106`,
`tod=39` (tous `+0`). La matrice lot→zone a ensuite été régénérée intégralement
sur ce snapshot, puis le rapport `scripts/palier-matrix-report.mjs --date=20260810`
et son contrôle `--check` ont réussi.

## Matrice vérifiée

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1642/3284 (50,0 %) | 1642/3284 (50,0 %) |
| Col. 6 — usage dominant complete | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complete | 24/163 | 24/163 |
| Col. 13 — normes pliées complete | 4/163 | 4/163 |

Aucun KPI ne change. Le reçu Biencourt correspond à une capture ArcGIS
brute/CAS vérifiée sur S3 ; aucun objet `normalized/` ne lui est attribué. Il
ne complète donc aucune ville ni cellule Palier par inférence.
