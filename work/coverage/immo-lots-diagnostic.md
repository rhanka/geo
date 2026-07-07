# Diagnostic immo-lots restants

Généré: 2026-07-07T03:23:23.171Z

Base: 239 munis servis, 810164 lots. Sources utilisées: sidecars S3 qc-lots existants + backfill lot-zone/lots-enriched sur sources rôle/cadastre/zonage-normes existantes; aucune valeur inventée.

## Synthèse après backfill

- surface_m2: 810164/810164 = 100% (done); munis >=90%: 239; munis >0%: 239
- adresse: 762675/810164 = 94.14% (in-progress); munis >=90%: 159; munis >0%: 237
- code_postal: 809836/810164 = 99.96% (done); munis >=90%: 239; munis >0%: 239
- folded-normes: 335323/810164 = 41.39% (in-progress); munis >=90%: 51; munis >0%: 146
- in_tod: 28431/28431 = 100% (in-progress); munis >=90%: 4; munis >0%: 4

## Backfill appliqué

Plan work/coverage/immo-folded-normes-refresh-plan.json: 7 munis stale détectées; backfill effectué pour baie-saint-paul, degelis, saint-francois-xavier-de-brompton, saint-zacharie, val-morin, saint-louis-du-ha-ha, amos. Gain folded-normes: 40.62% -> 41.39%; feuilles track 100%: 5 -> 6. Résultats détaillés: work/coverage/immo-folded-normes-refresh-progress.json et .log.

## Principaux responsables restants


### adresse
| muni | lots | avec | manquants | pct | normesStatus |
|---|---:|---:|---:|---:|---|
| longueuil | 67010 | 62140 | 4870 | 92.73 | done |
| brossard | 24823 | 22797 | 2026 | 91.84 | done |
| saint-hyacinthe | 19379 | 17489 | 1890 | 90.25 | done |
| victoriaville | 19961 | 18373 | 1588 | 92.04 | done |
| boucherville | 16269 | 14970 | 1299 | 92.02 | done |
| stanstead--memphremagog | 3087 | 1954 | 1133 | 63.3 | done |
| saint-bruno-de-montarville | 10261 | 9228 | 1033 | 89.93 | done |
| saint-felix-de-dalquier | 936 | 0 | 936 | 0 | to-research |
| mont-royal | 5795 | 4893 | 902 | 84.43 | done |
| dollard-des-ormeaux | 12563 | 11667 | 896 | 92.87 | done |
| riviere-du-loup | 8812 | 8012 | 800 | 90.92 | done |
| pointe-claire | 10815 | 10030 | 785 | 92.74 | done |
| repentigny | 28902 | 28294 | 608 | 97.9 | done |
| beauceville | 5045 | 4462 | 583 | 88.44 | done |
| candiac | 7725 | 7147 | 578 | 92.52 | done |
| amqui | 4191 | 3633 | 558 | 86.69 | done |
| levis | 30225 | 29669 | 556 | 98.16 | done |
| saint-lambert | 5472 | 4917 | 555 | 89.86 | done |
| saint-apollinaire | 5371 | 4827 | 544 | 89.87 | done |
| beaconsfield | 7111 | 6570 | 541 | 92.39 | done |

### code_postal
| muni | lots | avec | manquants | pct | normesStatus |
|---|---:|---:|---:|---:|---|
| levis | 30225 | 30120 | 105 | 99.65 | done |
| beaconsfield | 7111 | 7077 | 34 | 99.52 | done |
| vaudreuil-dorion | 14135 | 14113 | 22 | 99.84 | done |
| salaberry-de-valleyfield | 15510 | 15489 | 21 | 99.86 | done |
| pointe-claire | 10815 | 10802 | 13 | 99.88 | done |
| rosemere | 5767 | 5756 | 11 | 99.81 | done |
| carleton-sur-mer | 2450 | 2439 | 11 | 99.55 | done |
| longueuil | 67010 | 67002 | 8 | 99.99 | done |
| boucherville | 16269 | 16261 | 8 | 99.95 | done |
| boisbriand | 9969 | 9961 | 8 | 99.92 | done |
| beauharnois | 6003 | 5995 | 8 | 99.87 | done |
| stanstead--memphremagog | 3087 | 3079 | 8 | 99.74 | done |
| riviere-bleue | 1209 | 1203 | 6 | 99.5 | to-research |
| saint-andre-dargenteuil | 3224 | 3219 | 5 | 99.84 | done |
| berthierville | 1987 | 1982 | 5 | 99.75 | done |
| baie-durfe | 1730 | 1725 | 5 | 99.71 | done |
| champlain | 1682 | 1677 | 5 | 99.7 | to-research |
| brossard | 24823 | 24819 | 4 | 99.98 | done |
| lanoraie | 3591 | 3587 | 4 | 99.89 | done |
| beaupre | 2933 | 2929 | 4 | 99.86 | done |

### folded-normes
| muni | lots | avec | manquants | pct | normesStatus |
|---|---:|---:|---:|---:|---|
| longueuil | 67010 | 32479 | 34531 | 48.47 | done |
| levis | 30225 | 60 | 30165 | 0.2 | done |
| brossard | 24823 | 366 | 24457 | 1.47 | done |
| granby | 25947 | 3468 | 22479 | 13.37 | done |
| blainville | 20962 | 0 | 20962 | 0 | done |
| boucherville | 16269 | 3530 | 12739 | 21.7 | done |
| dollard-des-ormeaux | 12563 | 0 | 12563 | 0 | done |
| saint-constant | 11622 | 0 | 11622 | 0 | done |
| saint-bruno-de-montarville | 10261 | 0 | 10261 | 0 | done |
| riviere-du-loup | 8812 | 16 | 8796 | 0.18 | done |
| boisbriand | 9969 | 1399 | 8570 | 14.03 | done |
| mont-tremblant | 10016 | 1600 | 8416 | 15.97 | done |
| saint-hyacinthe | 19379 | 11188 | 8191 | 57.73 | done |
| bromont | 7359 | 0 | 7359 | 0 | done |
| beaconsfield | 7111 | 0 | 7111 | 0 | done |
| candiac | 7725 | 1025 | 6700 | 13.27 | done |
| deux-montagnes | 6429 | 0 | 6429 | 0 | done |
| beauharnois | 6003 | 0 | 6003 | 0 | done |
| cantley | 5768 | 0 | 5768 | 0 | done |
| rosemere | 5767 | 134 | 5633 | 2.32 | done |

## Actions recommandées

- adresse: 47 489 lots manquants. Deux zéros seulement (saint-felix-de-dalquier 936, remigny 1) sont dus à absence/échec de correspondance rôle; le reste est structurel dans le rôle par lot (lots sans adresse civique). Ne pas inférer depuis géométrie.
- code_postal: 328 lots manquants seulement, résidus FSA/centroïdes hors polygone; plafond ouvert quasi atteint. Ne pas inventer le CP complet (source propriétaire).
- folded-normes: 474 867 lots manquants après refresh. Priorité: relancer lot-zone-join + lots-enriched sur munis done à 0% ou très bas (blainville, dollard-des-ormeaux, saint-constant, saint-bruno-de-montarville, bromont, beaconsfield, etc.) uniquement après diagnostic des zones codes vs grilles; les 7 refresh rapides n'ont corrigé que les stale connus.
