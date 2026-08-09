# Dry-run re-fold 167 — col-12/13

Lecture S3 seule ; aucun dépôt ni capture. Les 90 candidats restants excluent les 16 entrées du progrès et 7 exclusions préexistantes.

Col-12 mesure les centroïdes de lots sans `code_zone` dans le zonage réellement servi. Col-13 est prudent : `M=F` donne `0`, `M>F` donne le minimum prouvé `M−F`, et une divergence `M<F` reste `null`.

## Verdict

- REAL-GAIN : **37** — col-12 **+274**, col-13 **+419** (minimum prouvé).
- AT-CEILING : **1**.
- COVERAGE-BOUND : **52** — résidus connus **350911** ; total strict = `null` car `sainte-anne-de-bellevue` est non mesurable.

## DEPOSIT-WORTHY

| Municipalité | Col-12 | Col-13 | Gain minimal |
| --- | ---: | ---: | ---: |
| saint-jerome | 2 | 419 | 421 |
| saint-amable | 130 | 0 | 130 |
| rosemere | 32 | null | 32 |
| sainte-julie | 23 | 0 | 23 |
| la-prairie | 9 | null | 9 |
| saint-bruno-de-montarville | 8 | 0 | 8 |
| saint-lazare | 8 | 0 | 8 |
| prevost | 6 | 0 | 6 |
| kirkland | 5 | null | 5 |
| saint-calixte | 5 | 0 | 5 |
| joliette | 4 | 0 | 4 |
| saint-pierre | 4 | 0 | 4 |
| la-presentation | 3 | 0 | 3 |
| saint-eustache | 3 | 0 | 3 |
| sainte-brigide-diberville | 3 | 0 | 3 |
| sainte-catherine | 3 | null | 3 |
| lavaltrie | 2 | null | 2 |
| saint-lambert | 2 | 0 | 2 |
| saint-roch-ouest | 2 | 0 | 2 |
| saint-stanislas-de-kostka | 2 | 0 | 2 |
| sainte-marie-salome | 2 | 0 | 2 |
| hampstead | 1 | 0 | 1 |
| hemmingford--les-jardins-de-napierville | 1 | 0 | 1 |
| hemmingford--les-jardins-de-napierville--2 | 1 | 0 | 1 |
| mont-royal | 1 | 0 | 1 |
| otterburn-park | 1 | 0 | 1 |
| repentigny | 1 | 0 | 1 |
| saint-alexis | 1 | 0 | 1 |
| saint-constant | 1 | 0 | 1 |
| saint-esprit | 1 | 0 | 1 |
| saint-jacques | 1 | null | 1 |
| saint-jean-baptiste | 1 | 0 | 1 |
| saint-jude | 1 | null | 1 |
| saint-lin-laurentides | 1 | 0 | 1 |
| saint-mathias-sur-richelieu | 1 | null | 1 |
| saint-pie | 1 | null | 1 |
| sainte-anne-de-sabrevois | 1 | 0 | 1 |

## COVERAGE-BOUND — escalade zones / normes

| Municipalité | Résidu col-12 | Résidu col-13 | Cause |
| --- | ---: | ---: | --- |
| dorval | 71 | 136 | coverage zones |
| farnham | 0 | 4950 | coverage normes |
| franklin | 1 | 12 | coverage zones |
| havelock | 0 | 554 | coverage normes |
| howick | 0 | 29 | coverage normes |
| hudson | 22 | 2987 | coverage zones |
| lacolle | 30 | 78 | coverage zones |
| lassomption | 1 | 1064 | coverage zones |
| lepiphanie | 11 | 4493 | coverage zones |
| les-coteaux | 0 | 1145 | coverage normes |
| longueuil | 35 | 34531 | coverage zones |
| mirabel | 0 | 7409 | coverage normes |
| montreal-ouest | 0 | 1601 | coverage normes |
| notre-dame-de-stanbridge | 55 | 55 | coverage zones |
| oka | 3 | 34 | coverage zones |
| ormstown | 0 | 2359 | coverage normes |
| pointe-claire | 0 | 3884 | coverage normes |
| rougemont | 8 | 8 | coverage zones |
| saint-alexandre | 77 | 1347 | coverage zones |
| saint-barnabe-sud | 680 | 681 | coverage zones |
| saint-basile-le-grand | 14 | 8339 | coverage zones |
| saint-bernard-de-lacolle | 955 | 1136 | coverage zones |
| saint-bernard-de-michaudville | 2 | 10 | coverage zones |
| saint-charles-sur-richelieu | 3 | 395 | coverage zones |
| saint-chrysostome | 4 | 1740 | coverage zones |
| saint-clet | 112 | 674 | coverage zones |
| saint-colomban | 0 | 10729 | coverage normes |
| saint-damase--les-maskoutains | 2 | 1708 | coverage zones |
| saint-denis-sur-richelieu | 1 | 17 | coverage zones |
| saint-dominique | 2 | 91 | coverage zones |
| saint-etienne-de-beauharnois | 29 | 60 | coverage zones |
| saint-hippolyte | 4757 | 9308 | coverage zones |
| saint-hyacinthe | 0 | 13727 | coverage normes |
| saint-liguori | 8 | 1409 | coverage zones |
| saint-mathieu | 2 | 2 | coverage zones |
| saint-mathieu-de-beloeil | 6 | 48 | coverage zones |
| saint-ours | 0 | 1285 | coverage normes |
| saint-paul | 2 | 3576 | coverage zones |
| saint-philippe | 133 | 226 | coverage zones |
| saint-sulpice | 2 | 1121 | coverage zones |
| sainte-anne-de-bellevue | null | null | mesure incomplète ou millésimes divergents — ne pas inférer |
| sainte-clotilde | 6 | 944 | coverage zones |
| sainte-julienne | 1 | 8247 | coverage zones |
| sainte-madeleine | 1 | 947 | coverage zones |
| sainte-marie-madeleine | 6 | 6 | coverage zones |
| sainte-sophie | 44 | 8276 | coverage zones |
| salaberry-de-valleyfield | 0 | 324 | coverage normes |
| tres-saint-sacrement | 1 | 981 | coverage zones |
| varennes | 0 | 1752 | coverage normes |
| vaudreuil-dorion | 9 | 72 | coverage zones |
| vercheres | 1 | 2856 | coverage zones |
| westmount | 27 | 5016 | coverage zones |
