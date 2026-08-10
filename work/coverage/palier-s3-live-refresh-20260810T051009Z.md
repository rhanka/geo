# Palier 20×167 — rescan S3 post-normes #119 — 2026-08-10T05:10:09Z

## Réconciliation S3

Après le merge `95971e8` (PR #119), `acquisition/src/coverage-reconcile.ts`
a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. La couverture
fraîche est horodatée `2026-08-10T05:09:46.219Z` : `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0` pour
cette passe). La matrice lot→zone a été régénérée intégralement depuis S3 avant
la génération Palier et son contrôle `--check`.

## Matrice vérifiée

La matrice générée à `2026-08-10T05:10:09.697Z` passe `--check` : partitions
fermées, déterminisme et `unknown != complete`.

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1643/3284 (50,030 %) | 1643/3284 (50,030 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 84/163 | 84/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

Les configurations de découverte de normes de #119 ne ferment aucune ville de
la cohorte dans cet état du stockage objet ; aucun gain n'est déclaré par
inférence.

## Reçu S3 Fort-Coulonge

Le job cluster `geo-capture-zones-20260810t050800z` est `Completed`. Son run
S3 `zones-20260810T050800Z-0-890d2c1d-707c-439b-aaca-bb96e5cca7e3` confirme
une réponse HTTP 200 pour Fort-Coulonge, 172987 octets dans
`raw/zones-v1-proof-url/cas/672f2119dcf70bcd83630915d083414f11e0af141909f8bf8c4b57a810eeeb14.json`,
et le SHA-256
`sha256:672f2119dcf70bcd83630915d083414f11e0af141909f8bf8c4b57a810eeeb14`.
La sonde relit le manifeste, le CAS et la métadonnée sur S3 : preuve v2 valide.

Cette capture reste brute/CAS, sans objet `normalized/` et sans crédit dans la
matrice Palier.
