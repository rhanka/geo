# Palier 20×167 — rescan S3 post-usage #125 — 2026-08-10T05:39:00Z

## Réconciliation S3

Après le merge `e5ddd32d` (PR #125), `acquisition/src/coverage-reconcile.ts`
a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. La couverture
fraîche est horodatée `2026-08-10T05:38:32.151Z` : `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0` pour
cette passe). La matrice lot→zone a été régénérée intégralement depuis S3 avant
la génération Palier et son contrôle `--check`.

## Matrice vérifiée

La matrice générée à `2026-08-10T05:39:00.132Z` passe `--check` : partitions
fermées, déterminisme et `unknown != complete`.

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1645/3284 (50,091 %) | 1645/3284 (50,091 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 86/163 | 86/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

Les sondes VPlus ajoutées par #125 sont partielles et ne ferment aucune ville
de la cohorte selon les critères actuels. Aucun gain Palier n'est déclaré par
inférence.

## Reçu S3 Lac-Beauport

Le job cluster `geo-capture-zones-20260810t053700z` est `Completed`. Son run
S3 `zones-20260810T053700Z-0-8ec0e101-bcd9-45a6-9b2c-0317ce2dc844` confirme
une réponse HTTP 200 pour Lac-Beauport, 655324 octets dans
`raw/zones-v1-proof-url/cas/b815a37d027ea64a32135b13f188eb919cf73d159978006bf4d7dd51d9fab0e5.bin`,
et le SHA-256
`sha256:b815a37d027ea64a32135b13f188eb919cf73d159978006bf4d7dd51d9fab0e5`.
La sonde relit le manifeste, le CAS et la métadonnée sur S3 : preuve v2 valide.

Cette capture reste brute/CAS, sans objet `normalized/` et sans crédit dans la
matrice Palier.
