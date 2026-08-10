# Palier 20×167 — rescan S3 post-Boucherville #124 — 2026-08-10T05:35:43Z

## Réconciliation S3

Après le merge `7e6d5bea` (PR #124), `acquisition/src/coverage-reconcile.ts`
a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. La couverture
fraîche est horodatée `2026-08-10T05:35:19.272Z` : `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0` pour
cette passe). La matrice lot→zone a été régénérée intégralement depuis S3 avant
la génération Palier et son contrôle `--check`.

## Gain règlement vérifié

Le nouvel artefact par-ville de #124 fait passer Boucherville de `incomplete`
à `complete` pour la colonne 5 : `declared=complete` et
`proven=incomplete` deviennent tous deux `complete`. La différence des
matrices avant/après ne contient aucune autre ville modifiée.

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1644/3284 (50,061 %) | 1645/3284 (50,091 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 85/163 | 86/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

## Reçu S3 La Pêche

Le job cluster `geo-capture-zones-20260810t053300z` est `Completed`. Son run
S3 `zones-20260810T053300Z-0-cdd43a7a-6c13-4366-acfa-039ebb826f2a` confirme
une réponse HTTP 200 pour La Pêche, 1511907 octets dans
`raw/zones-v1-proof-url/cas/b3d243a642eeb59821413002685e512b2941b6fd6a4654faee9c3b2713d15ef0.json`,
et le SHA-256
`sha256:b3d243a642eeb59821413002685e512b2941b6fd6a4654faee9c3b2713d15ef0`.
La sonde relit le manifeste, le CAS et la métadonnée sur S3 : preuve v2 valide.

Cette capture reste brute/CAS, sans objet `normalized/` et sans crédit dans la
matrice. Le seul gain de cette passe est Boucherville, en règlement, établi par
#124.
