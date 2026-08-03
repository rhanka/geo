# WP1 — completion cohorte 30 (palier 1)

État daté `20260802`; palier 1 : 6 dépôts validés. Longueuil a un backup S3 confirmé mais aucun dépôt lot-zone validé; il reste au checkpoint.

| muni | état | #12 avant→après | #2 mismatch avant→après | #13 avant→après | inside-served assignés | couverture incomplete restante | backup / miroir / stamp |
|---|---|---:|---:|---:|---:|---:|---|
| westmount | completed | 99.46%→99.46% | 10.99%→10.99% | 0.14%→0.48% | 5013→5013 | 27→27 | done 2026-08-03T003823001ZZ; flat-only; STAMPED |
| saint-lambert | completed | 99.62%→99.62% | 3.93%→3.93% | 99.62%→99.62% | 5451→5451 | 21→21 | done 2026-08-03T004443731ZZ; flat-only; STAMPED_NULL |
| hampstead | completed | 99.73%→99.73% | 11.88%→11.88% | 98.98%→98.98% | 1861→1861 | 5→5 | done 2026-08-03T004944660ZZ; flat-only; STAMPED_NULL |
| mont-royal | completed | 98.55%→98.55% | 2.52%→2.52% | 39.91%→39.91% | 5711→5711 | 84→84 | done 2026-08-03T005016722ZZ; flat-only; STAMPED_NULL |
| montreal-ouest | completed | 100%→100% | 8.99%→8.99% | 5.12%→5.12% | 1601→1601 | 0→0 | done 2026-08-03T005411749ZZ; flat-only; STAMPED_NULL |
| cote-saint-luc | completed | 98.89%→98.89% | 6.69%→6.69% | 71.77%→71.77% | 4890→4890 | 55→55 | done 2026-08-03T005436864ZZ; flat-only; STAMPED_NULL |
| longueuil | checkpoint_backup_only | 99.95%→null | 5.62%→null | 48.47%→null | 66975→null | 35→null | — |
| sainte-catherine | pending | 99.86%→null | null→null | 44.26%→null | 5746→null | 8→null | — |
| la-prairie | pending | 99.27%→null | 8.55%→null | 5.63%→null | 9399→null | 69→null | — |
| delson | pending | 100%→null | 5.77%→null | 99.55%→null | 3330→null | 0→null | — |
| candiac | pending | 100%→null | 8.52%→null | 13.41%→null | 7725→null | 0→null | — |
| montreal-est | pending | 100%→null | 6.91%→null | 100%→null | 1678→null | 0→null | — |
| boucherville | pending | 99.83%→null | 6.07%→null | 21.7%→null | 16242→null | 27→null | — |
| dorval | pending | 98.86%→null | 3.9%→null | 97.82%→null | 6174→null | 71→null | — |
| saint-constant | pending | 99.94%→null | 3.57%→null | 4.26%→null | 11615→null | 7→null | — |
| saint-bruno-de-montarville | pending | 98.66%→null | 3.58%→null | 0%→null | 10123→null | 138→null | — |
| carignan | pending | 100%→null | 3.62%→null | 43%→null | 6654→null | 0→null | — |
| dollard-des-ormeaux | pending | 99.99%→null | 4.4%→null | 15.13%→null | 12562→null | 1→null | — |
| pointe-claire | pending | 100%→null | 3.77%→null | 64.09%→null | 10815→null | 0→null | — |
| saint-philippe | pending | 97.44%→null | 3.69%→null | 95.66%→null | 5069→null | 133→null | — |
| saint-mathieu | pending | 99.86%→null | 2.57%→null | 99.86%→null | 1442→null | 2→null | — |
| chateauguay | pending | 94.4%→null | 2.68%→null | 0.03%→null | 17715→null | 1050→null | — |
| sainte-julie | pending | 84.91%→null | 3.24%→null | 0.68%→null | 9147→null | 1625→null | — |
| saint-basile-le-grand | pending | 99.86%→null | 3.29%→null | 19.13%→null | 10298→null | 14→null | — |
| chambly | pending | 99.93%→null | 5.22%→null | 99.93%→null | 12018→null | 9→null | — |
| rosemere | pending | 73.63%→null | 7.47%→null | 73.63%→null | 4246→null | 1521→null | — |
| varennes | pending | 100%→null | 4.98%→null | 39.44%→null | 8287→null | 0→null | — |
| brossard | pending | 99.88%→null | 6.7%→null | 1.47%→null | 24793→null | 30→null | — |
| ile-dorval | pending | null→null | null→null | null→null | null→null | null→null | — |
| kirkland | pending | 94.48%→null | 4.89%→null | 76.23%→null | 6498→null | 380→null | — |

Résumé palier : #12 `7/30→7/30` (293078/298390, 98,22 %→98,22 %); #2 `<5 %` `15/30→15/30` (5,22 %→5,22 % sur 28 munis mesurés); #13 `1/30→1/30` (110274/298390, 36,96 %→110291/298390, 36,96 %).

Gains réels : `+0` lot avec `code_zone`, `+17` lots avec normes pliées. Les lots hors couverture restent nommés `couverture incomplete`; `saint-catherine` et `ile-dorval` sont escaladés à zones faute de zonage servi.

Stamp : readback S3 sans erreur sur les six dépôts; le zonage n’est pas écrit par la chaîne, donc `zone_source_url`/`zone_source_level` sont préservés par construction et les valeurs servies actuelles sont consignées dans le JSON.

Sources : `immo-lot-zone-assignment-matrix-20260802.json`, `immo-folded-normes-city-matrix-20260802.json`, audit `lot-zone-consistency-audit.ts`, readback stamp `_zone-source-readback-audit.ts`.
