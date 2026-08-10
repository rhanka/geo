# Palier 20×167 — rescan S3 post-normes #122 — 2026-08-10T05:22:39Z

## Réconciliation S3

Après le merge `3b8d664b` (PR #122), `acquisition/src/coverage-reconcile.ts`
a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. La couverture
fraîche est horodatée `2026-08-10T05:22:16.133Z` : `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0` pour
cette passe). La matrice lot→zone a été régénérée intégralement depuis S3 avant
la génération Palier et son contrôle `--check`.

## Matrice vérifiée

La matrice générée à `2026-08-10T05:22:39.811Z` passe `--check` : partitions
fermées, déterminisme et `unknown != complete`.

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1644/3284 (50,061 %) | 1644/3284 (50,061 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 85/163 | 85/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

Les correctifs et la configuration de capture de normes de #122 ne ferment
aucune ville de la cohorte dans cet état de S3 ; aucun gain n'est déclaré par
inférence.

## Reçu S3 Hope

Le job cluster `geo-capture-zones-20260810t051900z` est `Completed`. Son run
S3 `zones-20260810T051900Z-0-42ac0043-3609-4630-8498-fb7944b09136` confirme
une réponse HTTP 200 pour Hope, 39840 octets dans
`raw/zones-v1-proof-url/cas/d521556e25e6308bbcb69d3807076a5584ed250fa57564aa8da614e2c65f1311.bin`,
et le SHA-256
`sha256:d521556e25e6308bbcb69d3807076a5584ed250fa57564aa8da614e2c65f1311`.
La sonde relit le manifeste, le CAS et la métadonnée sur S3 : preuve v2 valide.

Cette capture reste brute/CAS, sans objet `normalized/` et sans crédit dans la
matrice Palier.
