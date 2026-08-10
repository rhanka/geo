# Palier 20×167 — rescan S3 courant — 2026-08-10T02:28:31Z

## Périmètre

Passe de mesure après les fusions de captures alors visibles sur `main`, dont le
reçu de capture brute ArcGIS d'Audet. Ce journal ne crédite aucune capture qui
ne fournit pas une géométrie normalisée servie et acceptable par la matrice.

## Reconciliation S3

Commande exécutée avec les paramètres réseau S3 prescrits :

```sh
NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
  npx tsx acquisition/src/coverage-reconcile.ts
```

Résultat : `reconciled_at=2026-08-10T02:28:31.048Z`, scoreboard `/1106` :
`pv=1064`, `normes=815`, `zones=911`, `cadastre=1106`, `role-foncier=1106`,
`tod=39` (tous `+0`).

La matrice lot→zone a ensuite été entièrement remesurée sur S3 : 347 villes
complètes, 543 incomplètes, 210 inconnues et 6 N/A; son entrée
`coverage-matrix.json` porte le SHA-256
`6a74260b30cca7f8a46d3b54337cfd3ae9866b744b5c669cfa6e1a5c98f28e25`.

## Matrice palier vérifiée

La génération complète `scripts/palier-matrix-report.mjs --date=20260810` et
son contrôle `--check` réussissent : partitions fermées, déterminisme et
`unknown != complete` vérifiés.

| Mesure | Snapshot précédent | S3 courant |
|---|---:|---:|
| Résolu total | 1642/3284 (50,0 %) | 1642/3284 (50,0 %) |
| Col. 6 — usage dominant complete | 93/163 | 93/163 |
| Col. 12 — code_zone complet | 24/163 | 24/163 |
| Col. 13 — normes pliées complètes | 4/163 | 4/163 |

Aucune colonne KPI ne change sur cette passe. La capture Audet confirmée sur
S3 reste une preuve brute/CAS : elle n'écrit pas de `normalized/` et ne peut
pas, à elle seule, compléter une cellule palier. Les autres captures intégrées
dans cette fenêtre n'ont pas fermé une ville entière selon les définitions des
KPI.
