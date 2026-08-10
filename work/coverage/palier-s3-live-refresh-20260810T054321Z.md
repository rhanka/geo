# Palier 20×167 — rescan S3 après capture Lac-Delage — 2026-08-10T05:43:21Z

## Reçu de capture S3

Le job Kubernetes `geo-capture-zones-20260810t054159z` est `Completed`. La
sonde de bout en bout relit depuis S3 le run
`zones-20260810T054159Z-0-5d208453-9400-4da6-8b0c-f387bfe9529d` : Lac-Delage
répond HTTP 200, pour 80121 octets, dans
`raw/zones-v1-proof-url/cas/313d6bce57886f57a938975c836f280167361fcae49b23b87aaca84a4a8dc687.bin`.
Le SHA-256 vérifié est
`sha256:313d6bce57886f57a938975c836f280167361fcae49b23b87aaca84a4a8dc687` et
la preuve v2 est valide. Le `robots.txt` HTTP 404 est conservé comme tentative
distincte sans octets.

## Réconciliation et matrice S3 fraîche

Après ce dépôt, `coverage-reconcile.ts`, la matrice lot→zone complète et
`palier-matrix-report.mjs --date=20260810 --check` ont été rejoués depuis le
stockage objet avec `NODE_OPTIONS=--dns-result-order=ipv4first` et
`AWS_MAX_ATTEMPTS=10`. Réconciliation : `pv=1064`, `normes=818`, `zones=911`,
`cadastre=1106`, `role-foncier=1106`, `tod=39`, tous à `+0` sur cette passe.

| Mesure | Avant | S3 après Lac-Delage |
|---|---:|---:|
| Résolu total | 1645/3284 (50,091 %) | 1645/3284 (50,091 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 86/163 | 86/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

La capture est brute/CAS : elle n'ajoute pas d'objet `normalized/` et ne ferme
aucune ville selon la définition Palier. Aucun gain KPI n'est donc déclaré.
