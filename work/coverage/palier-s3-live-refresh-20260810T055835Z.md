# Palier 20×167 — rescan S3 après capture Lac-du-Cerf — 2026-08-10T05:58:35Z

## Reçu S3

Le Job Kubernetes `geo-capture-zones-20260810t055700z` est `Complete`.
La sonde S3 relit le run
`zones-20260810T055700Z-0-9ba07147-49cf-463e-b6db-ed20bc81b47e` : Lac-du-Cerf
répond HTTP 200, 24148392 octets, dans
`raw/zones-v1-proof-url/cas/25aec58cc27cd6600a25fa4d7b8c2a4b97f464844ea96bb4bf402663fce51879.bin`.
Le SHA-256 et la preuve v2 sont validés depuis S3. La tentative `robots.txt`
HTTP 404 n'a pas d'octets et reste explicitement séparée.

## Matrice S3 fraîche

`coverage-reconcile.ts`, la matrice lot→zone intégrale et
`palier-matrix-report.mjs --date=20260810 --check` ont été rejoués depuis S3
avec `NODE_OPTIONS=--dns-result-order=ipv4first` et `AWS_MAX_ATTEMPTS=10`.
Réconciliation à `2026-08-10T05:58:14.337Z` : `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39`, tous `+0`.

| Mesure | Avant | Après Lac-du-Cerf |
|---|---:|---:|
| Résolu total | 1645/3284 (50,091 %) | 1645/3284 (50,091 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 86/163 | 86/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

La capture est brute/CAS, sans objet `normalized/`, et ne ferme aucune ville
Palier. Aucun gain KPI n'est déclaré.
