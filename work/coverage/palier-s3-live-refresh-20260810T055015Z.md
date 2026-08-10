# Palier 20×167 — rescan S3 post-merge #129 et Lac-des-Écorces — 2026-08-10T05:50:15Z

Le merge `b3b52b74` (PR #129) est présent dans la branche avant cette passe.
La couverture a été réconciliée depuis S3 à `2026-08-10T05:49:48.027Z` avec
`NODE_OPTIONS=--dns-result-order=ipv4first` et `AWS_MAX_ATTEMPTS=10` :
`pv=1064`, `normes=818`, `zones=911`, `cadastre=1106`,
`role-foncier=1106`, `tod=39`, tous `+0`.

## Reçu S3 Lac-des-Écorces

Le job `geo-capture-zones-20260810t054641z` est `Complete`. Son run S3
`zones-20260810T054641Z-0-dfd4d75f-732d-445b-a14a-71eb4671f890` contient pour
Lac-des-Écorces une réponse HTTP 200 de 24148392 octets dans
`raw/zones-v1-proof-url/cas/25aec58cc27cd6600a25fa4d7b8c2a4b97f464844ea96bb4bf402663fce51879.bin`.
Le SHA-256 `sha256:25aec58cc27cd6600a25fa4d7b8c2a4b97f464844ea96bb4bf402663fce51879`
et la preuve v2 ont été relus et vérifiés sur S3. Le `robots.txt` HTTP 404 est
une ligne de tentative sans octets, conservée séparément.

## Matrice vérifiée

Après régénération intégrale lot→zone, le rapport Palier S3 frais passe
`--check`; il est inchangé par rapport à la passe précédente :

| Mesure | Avant | Après #129 + Lac-des-Écorces |
|---|---:|---:|
| Résolu total | 1645/3284 (50,091 %) | 1645/3284 (50,091 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 86/163 | 86/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

La capture reste brute/CAS, sans `normalized/`. Les captures et le bloc
règlement intégrés ne terminent aucune ville de la cohorte; aucun gain n'est
attribué par inférence.
