# WP1 — completion cohorte 30 (palier 3)

Onze dépôts validés cumulés. Longueuil, Candiac, Boucherville et Saint-Constant ont un backup S3 confirmé mais aucun dépôt lot-zone validé; ils restent aux checkpoints.

| muni | état | #12 avant→après | #2 mismatch avant→après | #13 avant→après | inside-served assignés | couverture incomplete restante | backup / miroir / stamp |
|---|---|---:|---:|---:|---:|---:|---|
| westmount | completed | 99.46%→99.46% | 10.99%→10.99% | 0.14%→0.48% | 5013→5013 | 27→27 | done 2026-08-03T003823001ZZ; flat-only; STAMPED |
| saint-lambert | completed | 99.62%→99.62% | 3.93%→3.93% | 99.62%→99.62% | 5451→5451 | 21→21 | done 2026-08-03T004443731ZZ; flat-only; STAMPED_NULL |
| hampstead | completed | 99.73%→99.73% | 11.88%→11.88% | 98.98%→98.98% | 1861→1861 | 5→5 | done 2026-08-03T004944660ZZ; flat-only; STAMPED_NULL |
| mont-royal | completed | 98.55%→98.55% | 2.52%→2.52% | 39.91%→39.91% | 5711→5711 | 84→84 | done 2026-08-03T005016722ZZ; flat-only; STAMPED_NULL |
| montreal-ouest | completed | 100%→100% | 8.99%→8.99% | 5.12%→5.12% | 1601→1601 | 0→0 | done 2026-08-03T005411749ZZ; flat-only; STAMPED_NULL |
| cote-saint-luc | completed | 98.89%→98.89% | 6.69%→6.69% | 71.77%→71.77% | 4890→4890 | 55→55 | done 2026-08-03T005436864ZZ; flat-only; STAMPED_NULL |
| longueuil | checkpoint_backup_only | 99.95%→null | 5.62%→null | 48.47%→null | 66975→null | 35→null | backup-only 2026-08-03T010702463ZZ; —; non lu |
| sainte-catherine | completed | 99.86%→99.86% | null→null | 44.26%→44.26% | 5746→5746 | 8→8 | done 2026-08-03T011309345ZZ; flat-only; STAMPED |
| la-prairie | completed | 99.27%→99.27% | 8.55%→null | 4.99%→4.99% | 9399→9399 | 69→69 | done 2026-08-03T011354756ZZ; flat-only; STAMPED |
| delson | completed | 100%→100% | 5.77%→null | 99.55%→99.55% | 3330→3330 | 0→0 | done 2026-08-03T011523476ZZ; flat-only; STAMPED_NULL |
| candiac | checkpoint_backup_only | 100%→null | 8.52%→null | 13.41%→null | 7725→null | 0→null | backup-only 2026-08-03T011729782ZZ; —; non lu |
| montreal-est | completed | 100%→100% | 6.91%→null | 100%→100% | 1678→1678 | 0→0 | done 2026-08-03T012348579ZZ; flat-only; STAMPED_NULL |
| boucherville | checkpoint_backup_only | 99.83%→null | 6.07%→null | 21.7%→null | 16242→null | 27→null | backup-only 2026-08-03T013438191ZZ; —; non lu |
| dorval | completed | 98.86%→98.86% | 3.9%→3.9% | 97.82%→97.82% | 6174→6174 | 71→71 | done 2026-08-03T013629228ZZ; flat-only; STAMPED_NULL |
| saint-constant | checkpoint_backup_only | 99.94%→null | 3.57%→null | 4.26%→null | 11615→null | 7→null | backup-only 2026-08-03T013709310ZZ; —; non lu |
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

Résumé cumulé : #12 `7/30→7/30` (293078/298390, 98,22 %→98,22 %); #2 `<5 %` `15/30→15/30` (5,22 %→5,22 % sur 28 munis mesurés); #13 live `110230/298390→110230/298390` (36,94 %→36,94 %).

Gains d'opération : `+0` lot avec `code_zone` au palier 3; `+17` lots avec normes pliées au cumul. Les lots hors couverture restent `couverture incomplete`; aucune valeur n'est inventée.

Stamp : readback S3 sans erreur sur Dorval; le zonage n’est pas écrit par la chaîne, donc `zone_source_url`/`zone_source_level` sont préservés par construction.

Sources : matrices `20260802`, stats live des journaux S3, audit `lot-zone-consistency-audit.ts`, readback `_zone-source-readback-audit.ts`.
