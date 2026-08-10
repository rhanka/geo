# Palier 20×167 — rescan S3 post-normes #113 et Escuminac — 2026-08-10T05:01:37Z

## Réconciliation S3

Après le merge `b633ab08` (PR #113), `acquisition/src/coverage-reconcile.ts`
a relu le stockage objet avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10`. La couverture
fraîche est horodatée `2026-08-10T05:01:11.531Z` : `pv=1064`, `normes=818`,
`zones=911`, `cadastre=1106`, `role-foncier=1106`, `tod=39` (tous `+0` pour
cette passe). La matrice lot→zone a été régénérée intégralement depuis S3 avant
la génération de Palier et son contrôle `--check`.

## Reçu S3 Escuminac

Le job cluster `geo-capture-zones-20260810t050200z` a terminé avec succès. Son
run S3 `zones-20260810T050200Z-0-bd69cbe9-b3f5-429c-93e5-afe9c3af6682` confirme
une réponse HTTP 200 pour Escuminac, 321294 octets dans
`raw/zones-v1-proof-url/cas/1cf1ce29ec838bb1e518370c911851c663476bc007cc1d5ddd3c6f062d1db659.bin`,
et le SHA-256
`sha256:1cf1ce29ec838bb1e518370c911851c663476bc007cc1d5ddd3c6f062d1db659`.
La sonde relit le manifeste, le CAS et sa métadonnée sur S3 : preuve v2 valide.

Cette capture reste un objet brut/CAS : aucun objet `normalized/` ne lui est
attribué et elle ne reçoit aucun crédit de complétion-ville ni de Palier.

## Matrice vérifiée

La matrice générée à `2026-08-10T05:01:37.855Z` passe `--check` : partitions
fermées, déterminisme et `unknown != complete`.

| Mesure | Passe précédente | S3 courant |
|---|---:|---:|
| Résolu total | 1642/3284 (50,0 %) | 1642/3284 (50,0 %) |
| Col. 3 — normes complètes | 107/163 | 107/163 |
| Col. 5 — règlement complet | 83/163 | 83/163 |
| Col. 6 — usage dominant complet | 93/163 | 93/163 |
| Col. 12 — assignation lot-zone complète | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

La configuration de normes ajoutée par #113 et la capture brute Escuminac ne
ferment aucune ville de la cohorte suivant les critères actuels. Aucun gain
Palier n'est donc déclaré par inférence.
