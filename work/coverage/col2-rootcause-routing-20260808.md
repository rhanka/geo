# COL2-ROOTCAUSE-ROUTING (2026-08-08)

- Méthode: top-15 priorisées par volume (misassigned + outside_all)
- Echantillonnage: 80 mismatches max/ville, min preuve 12.
- DRY-RUN: true
- Sources: work/coverage/col2-jointure-triage-20260807.json (31c9af61), work/coverage/lot-zone-consistency-scale-20260725.json (9995acf1)

## Résumé
- owner=zones: 0
- owner=jointures: 14
- owner=insufficient: 1

## Par ville
| slug | root_cause | owner | sample | %outside | %overlap | %label-mismatch | offset_mean_m | action_concrete |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| varennes | code_zone_label_mismatch | jointures | 80 | 2.5 | 0 | 97.5 | 249.23 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| amherst | code_zone_label_mismatch | jointures | 80 | 32.5 | 0 | 67.5 | 1040.74 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| ormstown | code_zone_label_mismatch | jointures | 68 | 5.88 | 0 | 94.12 | 564.62 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| laval | code_zone_label_mismatch | jointures | 80 | 2.5 | 0 | 97.5 | 338.93 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| longueuil | code_zone_label_mismatch | jointures | 80 | 2.5 | 0 | 97.5 | 181.9 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| quebec | code_zone_label_mismatch | jointures | 80 | 5 | 0 | 95 | 1564.58 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| cowansville | code_zone_label_mismatch | jointures | 80 | 2.5 | 0 | 97.5 | 194.15 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| granby | code_zone_label_mismatch | jointures | 80 | 2.5 | 0 | 97.5 | 392.43 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| brossard | code_zone_label_mismatch | jointures | 80 | 3.75 | 0 | 96.25 | 972.1 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| drummondville | code_zone_label_mismatch | jointures | 80 | 0 | 0 | 100 | 189.31 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| montreal | code_zone_label_mismatch | jointures | 80 | 6.25 | 0 | 93.75 | 220.4 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| saint-hyacinthe | code_zone_label_mismatch | jointures | 80 | 1.25 | 0 | 98.75 | 309.95 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| notre-dame-de-lourdes--joliette | insufficient_data | unknown | 28 | 53.57 | 0 | 46.43 | 513.89 | Manuel: verdict non tranché avec preuve échantillonnée actuelle. |
| boucherville | code_zone_label_mismatch | jointures | 80 | 7.5 | 0 | 92.5 | 804.41 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |
| sorel-tracy | code_zone_label_mismatch | jointures | 80 | 12.5 | 0 | 87.5 | 307.26 | Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage. |

## Actions concrètes pour owner=jointures

- varennes: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- amherst: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- ormstown: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- laval: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- longueuil: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- quebec: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- cowansville: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- granby: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- brossard: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- drummondville: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- montreal: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- saint-hyacinthe: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- boucherville: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.
- sorel-tracy: Fix lane jointures: reclassement `code_zone` du lot selon zone géométriquement contenante unique sans modifier qc-zonage.

## Top villes par volume mismatch

1. varennes: code_zone_label_mismatch (jointures)
2. amherst: code_zone_label_mismatch (jointures)
3. ormstown: code_zone_label_mismatch (jointures)
4. laval: code_zone_label_mismatch (jointures)
5. longueuil: code_zone_label_mismatch (jointures)
6. quebec: code_zone_label_mismatch (jointures)
7. cowansville: code_zone_label_mismatch (jointures)
8. granby: code_zone_label_mismatch (jointures)
9. brossard: code_zone_label_mismatch (jointures)
10. drummondville: code_zone_label_mismatch (jointures)
11. montreal: code_zone_label_mismatch (jointures)
12. saint-hyacinthe: code_zone_label_mismatch (jointures)
13. notre-dame-de-lourdes--joliette: insufficient_data (owner=insufficient)
14. boucherville: code_zone_label_mismatch (jointures)
15. sorel-tracy: code_zone_label_mismatch (jointures)
