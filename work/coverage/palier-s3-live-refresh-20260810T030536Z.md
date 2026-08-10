# Palier 20×167 — rescan S3 post-Ayers Cliff — 2026-08-10T03:05:36Z

## Réconciliation S3

`coverage-reconcile.ts` a été exécuté avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`.

Scoreboard `/1106` : `pv=1064`, `normes=815`, `zones=911`,
`cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0`). La couverture
fraîche est horodatée `2026-08-10T03:05:36.082Z` et la matrice lot→zone a été
entièrement régénérée sur S3; son entrée de couverture porte le SHA-256
`cd87a3b4fd7fa3b3bdf55e6b1cfba5ead0bb59771e438670c081962cbaa864a6`.

## Matrice palier vérifiée

La génération complète `scripts/palier-matrix-report.mjs --date=20260810` et
son contrôle `--check` réussissent : partitions fermées, déterminisme et
`unknown != complete` sont vérifiés.

| Mesure | Avant | S3 courant |
|---|---:|---:|
| Résolu total | 1642/3284 (50,0 %) | 1642/3284 (50,0 %) |
| Col. 6 — usage dominant complete | 93/163 | 93/163 |
| Col. 12 — code_zone complet | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

Aucune colonne KPI ne change sur cette passe. Le reçu Ayers Cliff fusionné
dans cette fenêtre est une capture ArcGIS brute/CAS confirmée sur S3, sans
objet `normalized/`; il ne complète donc aucune ville ni cellule palier.
