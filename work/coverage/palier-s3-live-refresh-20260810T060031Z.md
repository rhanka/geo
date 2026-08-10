# Palier 20×167 — rescan S3 post-merge #133 — 2026-08-10T06:00:31Z

Le merge `6e37cac7` (PR #133) est intégré avant cette passe. La réconciliation
S3 à `2026-08-10T06:00:04.350Z`, lancée avec
`NODE_OPTIONS=--dns-result-order=ipv4first` et `AWS_MAX_ATTEMPTS=10`, donne
`pv=1064`, `normes=818`, `zones=911`, `cadastre=1106`,
`role-foncier=1106`, `tod=39`, tous `+0`.

Après recalcul intégral lot→zone, le rapport Palier frais passe `--check` :

| Mesure | Avant | Après #133 |
|---|---:|---:|
| Résolu total | 1645/3284 (50,091 %) | 1645/3284 (50,091 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 86/163 | 86/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

La preuve Grand-Saint-Esprit est partielle : elle ne complète aucune ville et
aucun gain KPI n'est attribué.
