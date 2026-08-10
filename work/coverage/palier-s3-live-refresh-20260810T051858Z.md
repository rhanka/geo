# Palier 20×167 — rescan S3 post-Montréal-Ouest #120 — 2026-08-10T05:18:58Z

## Réconciliation S3

Après le merge `1747d441` (PR #120), `acquisition/src/coverage-reconcile.ts`
a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. La couverture
fraîche est horodatée `2026-08-10T05:18:33.191Z` : `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0` pour
cette passe). La matrice lot→zone a été régénérée intégralement depuis S3 avant
la génération Palier et son contrôle `--check`.

## Gain règlement vérifié

Le nouvel artefact par-ville de #120 fait passer Montréal-Ouest de
`incomplete` à `complete` pour la colonne 5 : `declared=complete` et
`proven=incomplete` deviennent tous deux `complete`. La différence des matrices
avant/après ne contient aucune autre ville modifiée.

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1643/3284 (50,030 %) | 1644/3284 (50,061 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 84/163 | 85/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

## Reçus S3 de zones

Fossambault-sur-le-Lac : le job
`geo-capture-zones-20260810t051500z` est `Completed`. Son run S3
`zones-20260810T051500Z-0-51c41cd7-7d65-4d1f-8d50-b6ac2a0a348a` confirme HTTP
200, 447503 octets dans
`raw/zones-v1-proof-url/cas/902b0de92c7f59711bd3a85883f1ec4ba0312433c38e3afe191d024de42b5737.bin`,
SHA-256 `sha256:902b0de92c7f59711bd3a85883f1ec4ba0312433c38e3afe191d024de42b5737`,
et une preuve v2 relue sur S3.

Frontenac : la première soumission `20260810T051600Z` a échoué avant création
du Job pendant la validation TLS Kubernetes ; seule sa worklist de contrôle
immuable existe sur S3. La soumission neuve
`geo-capture-zones-20260810t051700z` est `Completed`. Son run S3
`zones-20260810T051700Z-0-a6d701b9-17d4-4803-b3f2-c1a812fe84cc` confirme HTTP
200, 8245960 octets dans
`raw/zones-v1-proof-url/cas/b32fb0f4cb8e84e72548534daf1d59a632ff0dc6c97869e7bab866aa3cd4c226.json`,
SHA-256 `sha256:b32fb0f4cb8e84e72548534daf1d59a632ff0dc6c97869e7bab866aa3cd4c226`,
et une preuve v2 relue sur S3.

Les deux captures sont des objets bruts/CAS sans `normalized/`. Elles ne
reçoivent aucun crédit dans la matrice : le seul gain de cette passe est
Montréal-Ouest, en règlement, établi par #120.
