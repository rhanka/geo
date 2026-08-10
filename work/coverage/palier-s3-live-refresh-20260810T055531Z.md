# Palier 20×167 — rescan S3 post-merge #131 et Lac-Drolet — 2026-08-10T05:55:31Z

Après le merge `a512be04` (PR #131), la couverture S3 est relue avec
`NODE_OPTIONS=--dns-result-order=ipv4first` et `AWS_MAX_ATTEMPTS=10` à
`2026-08-10T05:55:07.998Z`: `pv=1064`, `normes=818`, `zones=911`,
`cadastre=1106`, `role-foncier=1106`, `tod=39`, tous `+0`.

## Reçu S3 Lac-Drolet

Le job Kubernetes `geo-capture-zones-20260810t055406z` est `Completed`. Son
run `zones-20260810T055406Z-0-e1284d5d-3091-4bab-bea4-060d4c7bc68b` est relu
depuis S3 : Lac-Drolet répond HTTP 200, 8245960 octets, dans
`raw/zones-v1-proof-url/cas/b32fb0f4cb8e84e72548534daf1d59a632ff0dc6c97869e7bab866aa3cd4c226.json`.
Le SHA-256 correspondant et la preuve v2 sont vérifiés. La requête
`robots.txt` HTTP 403 reste une tentative sans octets, séparée du succès.

## Matrice vérifiée

La matrice lot→zone a été recalculée intégralement; le rapport Palier S3 frais
passe `--check` et ne change aucun KPI :

| Mesure | Avant | Après #131 + Lac-Drolet |
|---|---:|---:|
| Résolu total | 1645/3284 (50,091 %) | 1645/3284 (50,091 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 86/163 | 86/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

Lac-Drolet est une capture brute/CAS sans `normalized/`; le raster d'usage
Dundee est également partiel. Ni l'un ni l'autre ne ferme une ville Palier.
