# COL2 CRS + Containment vérification (varennes / amherst)
Generated: 2026-08-08T12:11:49.323Z
Mode: DRY-RUN
Méthode: preuve directe: centre de gravité des lots (shoelace) + point-in-polygon contre qc-zonage servi
Note anti-invention: preuve directe: CRS explicitement déterminé par métadonnées/boîte d'encadrement, puis containment géométrique strict point-in-polygon; aucune heuristique de réparation.

## varennes
- lots_crs: EPSG:4326 (inferred via bounds)
- zones_crs: EPSG:4326 (inferred via bounds)
- crs_aligned: true
- verdict: real_label_mismatch
- examples: 20
  - 1. lot_id=5 881 874 assigned=A-102 containing=[] unique=false centroid=(-73.374489919,45.631996981)@EPSG:4326 (inferred via bounds)
  - 2. lot_id=6 224 373 assigned=A-212 containing=A-213 unique=true centroid=(-73.386039736,45.664163477)@EPSG:4326 (inferred via bounds)
  - 3. lot_id=6 224 249 assigned=C-220 containing=I-207 unique=true centroid=(-73.393214863,45.633294288)@EPSG:4326 (inferred via bounds)
  - 4. lot_id=6 224 847 assigned=I-221 containing=A-212 unique=true centroid=(-73.386408887,45.63412993)@EPSG:4326 (inferred via bounds)
  - 5. lot_id=6 224 834 assigned=A-301 containing=A-214 unique=true centroid=(-73.39567392,45.679070972)@EPSG:4326 (inferred via bounds)
  - 6. lot_id=6 224 827 assigned=A-212 containing=A-211 unique=true centroid=(-73.400507517,45.644171501)@EPSG:4326 (inferred via bounds)
  - 7. lot_id=6 224 850 assigned=A-213 containing=A-103 unique=true centroid=(-73.386285482,45.673391793)@EPSG:4326 (inferred via bounds)
  - 8. lot_id=6 223 818 assigned=A-106 containing=[] unique=false centroid=(-73.334749738,45.674680195)@EPSG:4326 (inferred via bounds)
  - 9. lot_id=6 223 817 assigned=A-106 containing=[] unique=false centroid=(-73.335497071,45.674615647)@EPSG:4326 (inferred via bounds)
  - 10. lot_id=6 224 859 assigned=A-102 containing=I-231 unique=true centroid=(-73.373931984,45.638947788)@EPSG:4326 (inferred via bounds)
  - 11. lot_id=6 223 973 assigned=A-107 containing=A-103 unique=true centroid=(-73.371714932,45.666256992)@EPSG:4326 (inferred via bounds)
  - 12. lot_id=6 004 551 assigned=P-421 containing=H-483 unique=true centroid=(-73.405973372,45.681399838)@EPSG:4326 (inferred via bounds)
  - 13. lot_id=6 224 825 assigned=A-305 containing=A-304 unique=true centroid=(-73.401911598,45.722432719)@EPSG:4326 (inferred via bounds)
  - 14. lot_id=6 224 839 assigned=A-305 containing=[] unique=false centroid=(-73.459957382,45.750821117)@EPSG:4326 (inferred via bounds)
  - 15. lot_id=6 006 823 assigned=H-483 containing=H-422 unique=true centroid=(-73.405517382,45.682398066)@EPSG:4326 (inferred via bounds)
  - 16. lot_id=6 224 438 assigned=A-107 containing=[] unique=false centroid=(-73.341754914,45.708893801)@EPSG:4326 (inferred via bounds)
  - 17. lot_id=6 148 373 assigned=H-563 containing=H-557 unique=true centroid=(-73.427597886,45.655077981)@EPSG:4326 (inferred via bounds)
  - 18. lot_id=6 148 289 assigned=H-571 containing=H-563 unique=true centroid=(-73.425010055,45.65408833)@EPSG:4326 (inferred via bounds)
  - 19. lot_id=6 148 287 assigned=H-571 containing=H-563 unique=true centroid=(-73.425069477,45.653817673)@EPSG:4326 (inferred via bounds)
  - 20. lot_id=6 148 421 assigned=H-570 containing=H-567 unique=true centroid=(-73.423011927,45.652436386)@EPSG:4326 (inferred via bounds)

### Dry-run correction sample
  - 1. lot_id=6 224 373 A-212 -> A-213
  - 2. lot_id=6 224 249 C-220 -> I-207
  - 3. lot_id=6 224 847 I-221 -> A-212
  - 4. lot_id=6 224 834 A-301 -> A-214
  - 5. lot_id=6 224 827 A-212 -> A-211
  - 6. lot_id=6 224 850 A-213 -> A-103
  - 7. lot_id=6 224 859 A-102 -> I-231
  - 8. lot_id=6 223 973 A-107 -> A-103
  - 9. lot_id=6 004 551 P-421 -> H-483
  - 10. lot_id=6 224 825 A-305 -> A-304
  - 11. lot_id=6 006 823 H-483 -> H-422
  - 12. lot_id=6 148 373 H-563 -> H-557
  - 13. lot_id=6 148 289 H-571 -> H-563
  - 14. lot_id=6 148 287 H-571 -> H-563
  - 15. lot_id=6 148 421 H-570 -> H-567
  - 16. lot_id=6 148 444 H-566 -> H-567
  - 17. lot_id=PC-40896 H-567 -> P-550
  - 18. lot_id=6 148 435 H-566 -> H-571
  - 19. lot_id=6 224 813 A-204 -> A-203
  - 20. lot_id=6 148 430 H-567 -> P-550
- total_lots=8287
- assigned_lots=8287
- matched=7874
- real_unique_mismatch=404
- outside_all=9

## amherst
- lots_crs: EPSG:4326 (inferred via bounds)
- zones_crs: EPSG:4326 (inferred via bounds)
- crs_aligned: true
- verdict: real_label_mismatch
- examples: 20
  - 1. lot_id=4 942 061 assigned=14F containing=[] unique=false centroid=(-74.711507757,46.058692417)@EPSG:4326 (inferred via bounds)
  - 2. lot_id=4 961 605 assigned=10F containing=[] unique=false centroid=(-74.787262335,46.078751283)@EPSG:4326 (inferred via bounds)
  - 3. lot_id=4 941 534 assigned=10F containing=[] unique=false centroid=(-74.788271928,46.078468026)@EPSG:4326 (inferred via bounds)
  - 4. lot_id=4 941 537 assigned=10F containing=[] unique=false centroid=(-74.787224049,46.079384956)@EPSG:4326 (inferred via bounds)
  - 5. lot_id=6 637 329 assigned=16V containing=97-F unique=true centroid=(-74.713035936,46.039284878)@EPSG:4326 (inferred via bounds)
  - 6. lot_id=4 420 049 assigned=3V containing=[] unique=false centroid=(-74.827658349,46.100493932)@EPSG:4326 (inferred via bounds)
  - 7. lot_id=4 420 044 assigned=3V containing=[] unique=false centroid=(-74.827891723,46.101213365)@EPSG:4326 (inferred via bounds)
  - 8. lot_id=4 420 062 assigned=3V containing=[] unique=false centroid=(-74.827106159,46.10052039)@EPSG:4326 (inferred via bounds)
  - 9. lot_id=4 420 061 assigned=3V containing=[] unique=false centroid=(-74.829423756,46.104207608)@EPSG:4326 (inferred via bounds)
  - 10. lot_id=4 420 047 assigned=3V containing=[] unique=false centroid=(-74.827217088,46.101019703)@EPSG:4326 (inferred via bounds)
  - 11. lot_id=4 420 056 assigned=3V containing=[] unique=false centroid=(-74.826821172,46.099635532)@EPSG:4326 (inferred via bounds)
  - 12. lot_id=4 420 045 assigned=3V containing=[] unique=false centroid=(-74.828321777,46.101756493)@EPSG:4326 (inferred via bounds)
  - 13. lot_id=4 420 063 assigned=3V containing=[] unique=false centroid=(-74.82970246,46.104137614)@EPSG:4326 (inferred via bounds)
  - 14. lot_id=5 197 784 assigned=15V containing=[] unique=false centroid=(-74.712190901,46.058163265)@EPSG:4326 (inferred via bounds)
  - 15. lot_id=4 941 466 assigned=11F containing=10-F unique=true centroid=(-74.800809353,46.068950933)@EPSG:4326 (inferred via bounds)
  - 16. lot_id=4 941 461 assigned=11F containing=10-F unique=true centroid=(-74.801576946,46.066669173)@EPSG:4326 (inferred via bounds)
  - 17. lot_id=4 941 464 assigned=11F containing=10-F unique=true centroid=(-74.801315805,46.067910138)@EPSG:4326 (inferred via bounds)
  - 18. lot_id=4 941 465 assigned=11F containing=10-F unique=true centroid=(-74.801269387,46.068288889)@EPSG:4326 (inferred via bounds)
  - 19. lot_id=4 941 495 assigned=11F containing=10-F unique=true centroid=(-74.799280964,46.070801797)@EPSG:4326 (inferred via bounds)
  - 20. lot_id=4 941 468 assigned=11F containing=10-F unique=true centroid=(-74.800288412,46.06959049)@EPSG:4326 (inferred via bounds)

### Dry-run correction sample
  - 1. lot_id=6 637 329 16V -> 97-F
  - 2. lot_id=4 941 466 11F -> 10-F
  - 3. lot_id=4 941 461 11F -> 10-F
  - 4. lot_id=4 941 464 11F -> 10-F
  - 5. lot_id=4 941 465 11F -> 10-F
  - 6. lot_id=4 941 495 11F -> 10-F
  - 7. lot_id=4 941 468 11F -> 10-F
  - 8. lot_id=4 941 459 11F -> 10-F
  - 9. lot_id=4 961 594 11F -> 58-M
  - 10. lot_id=6 602 118 33V -> 95-R
  - 11. lot_id=6 585 288 33V -> 39-V
  - 12. lot_id=6 585 289 33V -> 39-V
  - 13. lot_id=4 961 516 52V -> 53-V
  - 14. lot_id=4 941 107 52V -> 53-V
  - 15. lot_id=4 613 868 44V -> 41-V
  - 16. lot_id=6 510 707 41V -> 39-V
  - 17. lot_id=6 510 699 41V -> 39-V
  - 18. lot_id=4 941 155 82M -> 76-F
  - 19. lot_id=4 961 710 15V -> 97-F
  - 20. lot_id=6 449 886 33V -> 95-R
- total_lots=1833
- assigned_lots=1749
- matched=0
- real_unique_mismatch=1132
- outside_all=617

