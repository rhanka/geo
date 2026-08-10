# Palier 20×167 — rescan S3 après intégration #107 — 2026-08-10T04:19:55Z

## Réconciliation S3

Après l'intégration de #107, `acquisition/src/coverage-reconcile.ts` a relu
le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. Le snapshot
obtenu est horodaté `2026-08-10T04:19:11.151Z` : `pv=1064`, `normes=817`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0`). La
matrice lot→zone a ensuite été régénérée depuis S3, avant le rapport Palier et
son contrôle `--check`.

## Résultat vérifié

| Mesure | Passe précédente | S3 courant après #107 |
|---|---:|---:|
| Résolu total | 1642/3284 (50,0 %) | 1642/3284 (50,0 %) |
| Col. 5 — règlement déclarée+preuve complete | 83/163 | 83/163 |
| Col. 9 — provenance qualité complete | 82/163 | 82/163 |
| Col. 10 — preuve v2 exacte complete | 23/163 | 23/163 |
| Col. 11 — URL source servie complete | 47/163 | 47/163 |
| Col. 12 — assignation lot-zone complete | 24/163 | 24/163 |
| Col. 13 — normes pliées complete | 4/163 | 4/163 |

Aucun KPI Palier ne bouge. La preuve Terrasse-Vaudreuil de #107 est présente
dans son artefact de lane, mais la matrice Palier consomme toujours la source
autorisée `completion-regdens-percity-20260808` : sans sa publication dans
cette source, aucune cellule ne peut être déclarée complète.
