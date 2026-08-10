# Palier 20×167 — rescan S3 post-merge #121 — 2026-08-10T05:28:04Z

## Réconciliation S3

Après le merge `da876879` (PR #121), `acquisition/src/coverage-reconcile.ts`
a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. La couverture
fraîche est horodatée `2026-08-10T05:27:37.649Z` : `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0` pour
cette passe). La matrice lot→zone a été régénérée intégralement depuis S3 avant
la génération Palier et son contrôle `--check`.

## Matrice vérifiée

La matrice générée à `2026-08-10T05:28:04.167Z` passe `--check` : partitions
fermées, déterminisme et `unknown != complete`.

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1644/3284 (50,061 %) | 1644/3284 (50,061 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 85/163 | 85/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

## Reçus S3 Kiamika et Kingsbury

Kiamika : le job `geo-capture-zones-20260810t052400z` est `Completed`. Son
run S3 `zones-20260810T052400Z-0-b7613ef0-77b6-4ade-8d0e-6181a07b352c`
confirme HTTP 200, 24148392 octets dans
`raw/zones-v1-proof-url/cas/25aec58cc27cd6600a25fa4d7b8c2a4b97f464844ea96bb4bf402663fce51879.bin`,
et le SHA-256
`sha256:25aec58cc27cd6600a25fa4d7b8c2a4b97f464844ea96bb4bf402663fce51879`.

Kingsbury : le job `geo-capture-zones-20260810t052600z` est `Completed`. Son
run S3 `zones-20260810T052600Z-0-e25e21a6-40e9-46b0-9fd8-7cebf2232222`
confirme HTTP 200, 5193517 octets dans
`raw/zones-v1-proof-url/cas/7a0c5c212a7473c7203e96dafa3363760193f72056ae8cd7e9eae31117b28acd.json`,
et le SHA-256
`sha256:7a0c5c212a7473c7203e96dafa3363760193f72056ae8cd7e9eae31117b28acd`.

Les sondes relisent manifestes, CAS et métadonnées sur S3 : les deux preuves
v2 sont valides. Les deux captures restent brutes/CAS sans objet `normalized/`
et sans crédit dans la matrice Palier.
