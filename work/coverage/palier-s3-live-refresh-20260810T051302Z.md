# Palier 20×167 — rescan S3 post-usage #117 — 2026-08-10T05:13:02Z

## Réconciliation S3

Après le merge `ee46e5ba` (PR #117), `acquisition/src/coverage-reconcile.ts`
a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. La couverture
fraîche est horodatée `2026-08-10T05:12:36.773Z` : `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0` pour
cette passe). La matrice lot→zone a été régénérée intégralement depuis S3 avant
la génération Palier et son contrôle `--check`.

## Matrice vérifiée

La matrice générée à `2026-08-10T05:13:02.453Z` passe `--check` : partitions
fermées, déterminisme et `unknown != complete`.

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1643/3284 (50,030 %) | 1643/3284 (50,030 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 84/163 | 84/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

Les sondes de sitemap ajoutées par #117 sont partielles et ne ferment aucune
ville de la cohorte selon les critères actuels. Aucun gain Palier n'est déclaré
par inférence.

## Reçu S3 Fortierville

Le job cluster `geo-capture-zones-20260810t051100z` est `Completed`. Son run
S3 `zones-20260810T051100Z-0-5e9ce41f-2d93-48aa-9d42-cfc68b9b7db8` confirme
une réponse HTTP 200 pour Fortierville, 82777 octets dans
`raw/zones-v1-proof-url/cas/722460c0f7563e8d6687cfb48ddf0e44ddd3b9d7ccf75c4d9397860007083b20.bin`,
et le SHA-256
`sha256:722460c0f7563e8d6687cfb48ddf0e44ddd3b9d7ccf75c4d9397860007083b20`.
La sonde relit le manifeste, le CAS et la métadonnée sur S3 : preuve v2 valide.

Cette capture reste brute/CAS, sans objet `normalized/` et sans crédit dans la
matrice Palier.
