# Palier 20×167 — rescan S3 post-Hampstead #118 — 2026-08-10T05:05:23Z

## Réconciliation S3

Après le merge `1f6db178` (PR #118), `acquisition/src/coverage-reconcile.ts`
a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. La couverture
fraîche est horodatée `2026-08-10T05:04:59.574Z` : `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0` pour
cette passe). La matrice lot→zone a ensuite été régénérée intégralement depuis
S3 avant la génération Palier et son contrôle `--check`.

## Gain règlement vérifié

Le nouvel artefact par-ville de règlement de #118 fait passer Hampstead de
`incomplete` à `complete` pour la colonne 5 : `declared=complete` et
`proven=incomplete` deviennent tous deux `complete`. La différence des matrices
avant/après ne contient aucune autre ville modifiée.

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1642/3284 (50,000 %) | 1643/3284 (50,030 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 83/163 | 84/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

## Reçu S3 Ferme-Neuve

Le job cluster `geo-capture-zones-20260810t050500z` est `Completed`. Son run
S3 `zones-20260810T050500Z-0-78b360f5-2603-4fdd-ad30-20c9d4804326` confirme
une réponse HTTP 200 pour Ferme-Neuve, 24148392 octets dans
`raw/zones-v1-proof-url/cas/25aec58cc27cd6600a25fa4d7b8c2a4b97f464844ea96bb4bf402663fce51879.bin`,
et le SHA-256
`sha256:25aec58cc27cd6600a25fa4d7b8c2a4b97f464844ea96bb4bf402663fce51879`.
La sonde relit le manifeste, le CAS et la métadonnée depuis S3 : preuve v2
valide.

Cette capture est brute/CAS et n'a pas d'objet `normalized/`; elle ne reçoit
aucun crédit dans la matrice. Le seul gain de cette passe est donc Hampstead,
en règlement, établi par l'artefact #118.
