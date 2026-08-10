# Palier 20×167 — rescan S3 post-normes #123 — 2026-08-10T05:31:08Z

## Réconciliation S3

Après le merge `63c7b4ea` (PR #123), `acquisition/src/coverage-reconcile.ts`
a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. La couverture
fraîche est horodatée `2026-08-10T05:30:45.402Z` : `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0` pour
cette passe). La matrice lot→zone a été régénérée intégralement depuis S3 avant
la génération Palier et son contrôle `--check`.

## Matrice vérifiée

La matrice générée à `2026-08-10T05:31:08.040Z` passe `--check` : partitions
fermées, déterminisme et `unknown != complete`.

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1644/3284 (50,061 %) | 1644/3284 (50,061 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 85/163 | 85/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

Les artefacts normes de #123 ne ferment aucune ville de la cohorte dans cet
état de S3 ; aucun gain n'est déclaré par inférence.

## Reçu S3 La Macaza

Le job cluster `geo-capture-zones-20260810t052900z` est `Completed`. Son run
S3 `zones-20260810T052900Z-0-e1a21b7c-cb01-4c28-95ca-8f5bbe4ec56e` confirme
une réponse HTTP 200 pour La Macaza, 24148392 octets dans
`raw/zones-v1-proof-url/cas/25aec58cc27cd6600a25fa4d7b8c2a4b97f464844ea96bb4bf402663fce51879.bin`,
et le SHA-256
`sha256:25aec58cc27cd6600a25fa4d7b8c2a4b97f464844ea96bb4bf402663fce51879`.
La sonde relit le manifeste, le CAS et la métadonnée sur S3 : preuve v2 valide.

Cette capture reste brute/CAS, sans objet `normalized/` et sans crédit dans la
matrice Palier.
