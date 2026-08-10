# deposit-37-realgain-fold — vérification S3 et re-fold QA (2026-08-09)

## Périmètre immuable

- Cohorte : les 37 `REAL-GAIN` de `work/coverage/refold-167-dryrun-20260808.md`
  (commit `781b9230`).
- Ce journal ne réattribue pas l'écriture à une session locale : il constate
  uniquement l'état actuellement servi sur S3.
- Aucun candidat `COVERAGE-BOUND` n'est inclus.

## Vérification S3 en lecture seule

Les deux runners committés ont été exécutés avec
`NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10` :

1. `acquisition/src/lot-zone-join-run.ts --verify-only` : **37 OK, 0 SKIP,
   0 failed_verify**. Pour chaque municipalité, le parquet
   `normalized/qc-lot-zonage/<slug>.parquet`, son sidecar et son nombre de
   lignes sont présents et le nombre de lignes égale `num_lots`.
2. `acquisition/src/lots-enriched-run.ts --verify-only` : **37 OK, 0 SKIP,
   0 failed_deposit**. Chaque produit
   `normalized/qc-lots/qc-lots-<slug>.geojson` et son sidecar est présent;
   les compteurs S3 exposent `num_with_zone_code` (col-12) et
   `num_with_norms` (col-13).

Les 37 municipalités confirmées sont :

`saint-jerome`, `saint-amable`, `rosemere`, `sainte-julie`, `la-prairie`,
`saint-bruno-de-montarville`, `saint-lazare`, `prevost`, `kirkland`,
`saint-calixte`, `joliette`, `saint-pierre`, `la-presentation`,
`saint-eustache`, `sainte-brigide-diberville`, `sainte-catherine`,
`lavaltrie`, `saint-lambert`, `saint-roch-ouest`,
`saint-stanislas-de-kostka`, `sainte-marie-salome`, `hampstead`,
`hemmingford--les-jardins-de-napierville`,
`hemmingford--les-jardins-de-napierville--2`, `mont-royal`,
`otterburn-park`, `repentigny`, `saint-alexis`, `saint-constant`,
`saint-esprit`, `saint-jacques`, `saint-jean-baptiste`, `saint-jude`,
`saint-lin-laurentides`, `saint-mathias-sur-richelieu`, `saint-pie`,
`sainte-anne-de-sabrevois`.

## Re-mesure palier 20 × 167

La matrice a été régénérée après une lecture complète des sidecars S3
(`immo-lots-audit`, puis partition col-12 sur 1 106 villes) et une partition
col-13 sur le snapshot Immo rafraîchi. `palier-matrix-report --check` est
vert : partitions fermées, déterminisme et `unknown != complete` vérifiés.

| KPI | Baseline QA | Re-mesure S3 | Delta |
| --- | ---: | ---: | ---: |
| col-12 — assignation lot-zone complète | 23/163 | 24/163 | +1 |
| col-13 — normes pliées complètes | 4/163 | 4/163 | 0 |
| Résolu, 20 KPI | 1 658/3 284 (50,5 %) | 1 659/3 284 (50,5 % arrondi) | +1 cellule |

La variation col-12 provient de `saint-michel` (`unknown -> complete`).
`saint-patrice-de-sherrington` passe aussi de `unknown` à `incomplete` : ce
changement rend l'état mesuré, mais ne le crédite pas complet. Aucune
interprétation n'est appliquée aux autres absences : elles restent
`unknown`/`incomplete` suivant le sidecar réellement servi.

La sortie autoritaire est
`work/coverage/palier-matrix-30x167-20260809.{json,md}`; ses sources fraîches
col-12/13 sont les deux matrices datées `20260809` voisines.
