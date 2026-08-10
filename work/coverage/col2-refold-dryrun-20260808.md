# COL2 refold dry-run (WP5)

- DRY-RUN: true
- Méthode: test point-in-polygon strict sur centroïde + séparation reassignable / coverage-gap / ambiguous
- Sources: `8a3aa91d`, `6cd3dd30`, `9995acf1` (lot-zone-consistency)
- Sortie anti-invention: aucune écriture qc-lots, qc-zonage ou dépôt; aucune correction commitée.

## Statuts par ville
| slug | lots_total | mismatch_total | reassignable_jointures | coverage_gap_zones | ambiguous_overlap | crs_aligned | mode | sample_size | reassign_pct |
|---|---:|---:|---:|---:|---:|---|---|---:|---:|
| varennes | 8287 | 413 | 404 | 9 | 0 | true | full |  | 97.8% |
| amherst | 1833 | 1749 | 1132 | 617 | 0 | true | full |  | 64.7% |
| ormstown | 2421 | 68 | 64 | 4 | 0 | true | full |  | 94.1% |
| laval | 401594 | 7479 | 7339 | 140 | 0 | true | sampled | 2000 | 98.1% |
| longueuil | 67010 | 4018 | 4018 | 0 | 0 | true | sampled | 2000 | 100% |
| quebec | 66054 | 3331 | 3298 | 33 | 0 | true | sampled | 2000 | 99% |
| cowansville | 6820 | 263 | 246 | 17 | 0 | true | full |  | 93.5% |
| granby | 25947 | 1531 | 1453 | 78 | 0 | true | sampled | 2000 | 94.9% |
| brossard | 24823 | 1662 | 1513 | 149 | 0 | true | full |  | 91% |
| drummondville | 30722 | 1828 | 1828 | 0 | 0 | true | sampled | 2000 | 100% |
| montreal | 680087 | 1312 | 1258 | 54 | 0 | true | sampled | 2000 | 95.9% |
| saint-hyacinthe | 19379 | 1271 | 1245 | 8 | 18 | true | full |  | 98% |
| boucherville | 16269 | 987 | 942 | 45 | 0 | true | full |  | 95.4% |
| sorel-tracy | 16736 | 892 | 840 | 51 | 1 | true | full |  | 94.2% |

## Agrégé
- mismatch_total: 26804
- reassignable_jointures_total: 25580
- coverage_gap_zones_total: 1205
- ambiguous_overlap_total: 19
- ALERTE reassign_pct > 50%: varennes, amherst, ormstown, laval, longueuil, quebec, cowansville, granby, brossard, drummondville, montreal, saint-hyacinthe, boucherville, sorel-tracy
