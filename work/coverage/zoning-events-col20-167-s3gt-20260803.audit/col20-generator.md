# Col-20 qc-zoning-events par ville (WP5 v3.4 — recall directionnel immo→geo)

Cohorte : 167 villes (source : work/coverage/zoning-events-col20-167-s3gt-20260803.audit/cohort-167.tsv). Source geo : local_file. Source immo : work/coverage/zoning-events-col20-167-s3gt-20260803.audit/gt-adapted-input.json.

Résumé : measured 2 · measured-geo-empty 124 · immo-gt-pending 41. Événements geo émis : 414 sur 2 villes. Match immo→geo : 0/1018.

`recall_pct_si_mesurable` = recall directionnel immo→geo (metric Steve) ; `null`/immo-gt-pending quand la vérité-terrain immo manque — jamais un unknown fabriqué.

| Ville | geo_events | immo_gt | matched/immo | recall | statut |
| --- | ---: | :---: | ---: | ---: | --- |
| westmount | 0 | oui | 0/2 | 0.0 % | measured-geo-empty |
| saint-lambert | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| hampstead | 0 | oui | 0/3 | 0.0 % | measured-geo-empty |
| mont-royal | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| montreal-ouest | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| cote-saint-luc | 0 | oui | 0/1 | 0.0 % | measured-geo-empty |
| longueuil | 0 | oui | 0/3 | 0.0 % | measured-geo-empty |
| brossard | 0 | oui | 0/23 | 0.0 % | measured-geo-empty |
| sainte-catherine | 0 | oui | 0/12 | 0.0 % | measured-geo-empty |
| la-prairie | 0 | oui | 0/11 | 0.0 % | measured-geo-empty |
| delson | 0 | oui | 0/12 | 0.0 % | measured-geo-empty |
| candiac | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| montreal-est | 0 | oui | 0/4 | 0.0 % | measured-geo-empty |
| boucherville | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| dorval | 0 | oui | 0/11 | 0.0 % | measured-geo-empty |
| lile-dorval | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-constant | 0 | oui | 0/14 | 0.0 % | measured-geo-empty |
| saint-bruno-de-montarville | 0 | oui | 0/10 | 0.0 % | measured-geo-empty |
| carignan | 0 | oui | 0/15 | 0.0 % | measured-geo-empty |
| dollard-des-ormeaux | 0 | oui | 0/2 | 0.0 % | measured-geo-empty |
| pointe-claire | 0 | oui | 0/25 | 0.0 % | measured-geo-empty |
| saint-philippe | 0 | oui | 0/7 | 0.0 % | measured-geo-empty |
| saint-mathieu | 0 | oui | 0/10 | 0.0 % | measured-geo-empty |
| chateauguay | 0 | oui | 0/6 | 0.0 % | measured-geo-empty |
| sainte-julie | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| saint-basile-le-grand | 0 | oui | 0/3 | 0.0 % | measured-geo-empty |
| chambly | 0 | oui | 0/1 | 0.0 % | measured-geo-empty |
| rosemere | 0 | oui | 0/8 | 0.0 % | measured-geo-empty |
| varennes | 0 | oui | 0/4 | 0.0 % | measured-geo-empty |
| kirkland | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| bois-des-filion | 0 | oui | 0/8 | 0.0 % | measured-geo-empty |
| saint-isidore--roussillon | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| beaconsfield | 0 | oui | 0/13 | 0.0 % | measured-geo-empty |
| lorraine | 0 | oui | 0/10 | 0.0 % | measured-geo-empty |
| lery | 0 | oui | 0/24 | 0.0 % | measured-geo-empty |
| mercier | 0 | oui | 0/9 | 0.0 % | measured-geo-empty |
| charlemagne | 0 | oui | 0/12 | 0.0 % | measured-geo-empty |
| boisbriand | 0 | oui | 0/12 | 0.0 % | measured-geo-empty |
| deux-montagnes | 0 | oui | 0/9 | 0.0 % | measured-geo-empty |
| mcmasterville | 0 | oui | 0/12 | 0.0 % | measured-geo-empty |
| sainte-therese | 0 | oui | 0/4 | 0.0 % | measured-geo-empty |
| saint-mathias-sur-richelieu | 0 | oui | 0/4 | 0.0 % | measured-geo-empty |
| saint-mathieu-de-beloeil | 37 | oui | 0/18 | 0.0 % | measured |
| saint-amable | 0 | oui | 0/13 | 0.0 % | measured-geo-empty |
| terrebonne | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-remi | 0 | oui | 0/6 | 0.0 % | measured-geo-empty |
| otterburn-park | 0 | oui | 0/7 | 0.0 % | measured-geo-empty |
| saint-jacques-le-mineur | 0 | oui | 0/7 | 0.0 % | measured-geo-empty |
| richelieu | 0 | oui | 0/14 | 0.0 % | measured-geo-empty |
| beloeil | 0 | oui | 0/7 | 0.0 % | measured-geo-empty |
| baie-durfe | 0 | oui | 0/3 | 0.0 % | measured-geo-empty |
| sainte-marthe-sur-le-lac | 0 | oui | 0/11 | 0.0 % | measured-geo-empty |
| saint-jean-sur-richelieu | 0 | oui | 0/13 | 0.0 % | measured-geo-empty |
| mascouche | 0 | oui | 0/6 | 0.0 % | measured-geo-empty |
| saint-eustache | 377 | oui | 0/50 | 0.0 % | measured |
| notre-dame-de-lile-perrot | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| repentigny | 0 | oui | 0/2 | 0.0 % | measured-geo-empty |
| saint-edouard | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| sainte-anne-de-bellevue | 0 | oui | 0/1 | 0.0 % | measured-geo-empty |
| saint-michel | 0 | oui | 0/7 | 0.0 % | measured-geo-empty |
| blainville | 0 | oui | 0/7 | 0.0 % | measured-geo-empty |
| pointe-calumet | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| mont-saint-hilaire | 0 | oui | 0/6 | 0.0 % | measured-geo-empty |
| senneville | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| marieville | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| lile-perrot | 0 | oui | 0/17 | 0.0 % | measured-geo-empty |
| vercheres | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-marc-sur-richelieu | 0 | oui | 0/2 | 0.0 % | measured-geo-empty |
| sainte-martine | 0 | oui | 0/16 | 0.0 % | measured-geo-empty |
| beauharnois | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| sainte-anne-des-plaines | 0 | oui | 0/1 | 0.0 % | measured-geo-empty |
| saint-urbain-premier | 0 | oui | 0/8 | 0.0 % | measured-geo-empty |
| terrasse-vaudreuil | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-joseph-du-lac | 0 | oui | 0/3 | 0.0 % | measured-geo-empty |
| saint-jean-baptiste | 0 | oui | 0/15 | 0.0 % | measured-geo-empty |
| pincourt | 0 | oui | 0/7 | 0.0 % | measured-geo-empty |
| calixa-lavallee | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| lile-cadieux | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| pointe-des-cascades | 0 | oui | 0/7 | 0.0 % | measured-geo-empty |
| saint-charles-sur-richelieu | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| napierville | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| vaudreuil-sur-le-lac | 0 | oui | 0/1 | 0.0 % | measured-geo-empty |
| saint-blaise-sur-richelieu | 0 | oui | 0/7 | 0.0 % | measured-geo-empty |
| mont-saint-gregoire | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| sainte-madeleine | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-cyprien-de-napierville | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-patrice-de-sherrington | 0 | oui | 0/4 | 0.0 % | measured-geo-empty |
| saint-roch-de-lachigan | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| sainte-angele-de-monnoir | 0 | oui | 0/7 | 0.0 % | measured-geo-empty |
| lepiphanie | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| oka | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| sainte-marie-madeleine | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-etienne-de-beauharnois | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| sainte-clotilde | 0 | oui | 0/13 | 0.0 % | measured-geo-empty |
| vaudreuil-dorion | 0 | oui | 0/27 | 0.0 % | measured-geo-empty |
| rougemont | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-roch-ouest | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-sulpice | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| lassomption | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| howick | 0 | oui | 0/3 | 0.0 % | measured-geo-empty |
| mirabel | 0 | oui | 0/9 | 0.0 % | measured-geo-empty |
| sainte-anne-de-sabrevois | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-lin-laurentides | 0 | oui | 0/1 | 0.0 % | measured-geo-empty |
| saint-damase--les-maskoutains | 0 | oui | 0/1 | 0.0 % | measured-geo-empty |
| saint-antoine-sur-richelieu | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-denis-sur-richelieu | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| tres-saint-sacrement | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| la-presentation | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| sainte-brigide-diberville | 0 | oui | 0/2 | 0.0 % | measured-geo-empty |
| les-cedres | 0 | oui | 0/7 | 0.0 % | measured-geo-empty |
| saint-esprit | 0 | oui | 0/19 | 0.0 % | measured-geo-empty |
| saint-valentin | 0 | oui | 0/2 | 0.0 % | measured-geo-empty |
| sainte-sophie | 0 | oui | 0/13 | 0.0 % | measured-geo-empty |
| hudson | 0 | oui | 0/6 | 0.0 % | measured-geo-empty |
| saint-alexandre | 0 | oui | 0/17 | 0.0 % | measured-geo-empty |
| saint-chrysostome | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| hemmingford--les-jardins-de-napierville | 0 | oui | 0/4 | 0.0 % | measured-geo-empty |
| saint-cesaire | 0 | oui | 0/9 | 0.0 % | measured-geo-empty |
| saint-paul-de-lile-aux-noix | 0 | oui | 0/2 | 0.0 % | measured-geo-empty |
| saint-louis-de-gonzague--beauharnois-salaberry | 0 | oui | 0/4 | 0.0 % | measured-geo-empty |
| salaberry-de-valleyfield | 0 | oui | 0/9 | 0.0 % | measured-geo-empty |
| saint-lazare | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-bernard-de-lacolle | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-alexis | 0 | oui | 0/3 | 0.0 % | measured-geo-empty |
| sainte-marie-salome | 0 | oui | 0/2 | 0.0 % | measured-geo-empty |
| lavaltrie | 0 | oui | 0/8 | 0.0 % | measured-geo-empty |
| contrecoeur | 0 | oui | 0/9 | 0.0 % | measured-geo-empty |
| henryville | 0 | oui | 0/1 | 0.0 % | measured-geo-empty |
| saint-jerome | 0 | oui | 0/9 | 0.0 % | measured-geo-empty |
| saint-placide | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-jacques | 0 | oui | 0/1 | 0.0 % | measured-geo-empty |
| hemmingford--les-jardins-de-napierville--2 | 0 | oui | 0/4 | 0.0 % | measured-geo-empty |
| saint-colomban | 0 | oui | 0/10 | 0.0 % | measured-geo-empty |
| saint-hyacinthe | 0 | oui | 0/16 | 0.0 % | measured-geo-empty |
| lacolle | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-sebastien--le-haut-richelieu | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| saint-paul | 0 | oui | 0/16 | 0.0 % | measured-geo-empty |
| saint-pie | 0 | oui | 0/32 | 0.0 % | measured-geo-empty |
| havelock | 0 | oui | 0/3 | 0.0 % | measured-geo-empty |
| sainte-sabine--brome-missisquoi | 0 | oui | 0/6 | 0.0 % | measured-geo-empty |
| saint-bernard-de-michaudville | 0 | oui | 0/8 | 0.0 % | measured-geo-empty |
| crabtree | 0 | oui | 0/1 | 0.0 % | measured-geo-empty |
| coteau-du-lac | 0 | oui | 0/10 | 0.0 % | measured-geo-empty |
| sainte-julienne | 0 | oui | 0/9 | 0.0 % | measured-geo-empty |
| farnham | 0 | oui | 0/2 | 0.0 % | measured-geo-empty |
| saint-paul-dabbotsford | 0 | oui | 0/4 | 0.0 % | measured-geo-empty |
| saint-clet | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-roch-de-richelieu | 0 | oui | 0/8 | 0.0 % | measured-geo-empty |
| saint-jude | 0 | oui | 0/2 | 0.0 % | measured-geo-empty |
| noyan | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| ormstown | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| ange-gardien | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| saint-ours | 0 | oui | 0/3 | 0.0 % | measured-geo-empty |
| prevost | 0 | oui | 0/2 | 0.0 % | measured-geo-empty |
| saint-stanislas-de-kostka | 0 | oui | 0/4 | 0.0 % | measured-geo-empty |
| saint-calixte | 0 | oui | 0/4 | 0.0 % | measured-geo-empty |
| saint-barnabe-sud | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| notre-dame-de-stanbridge | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| franklin | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-pierre | 0 | oui | 0/2 | 0.0 % | measured-geo-empty |
| saint-liguori | 0 | non | 0/0 | immo-gt-pending | immo-gt-pending |
| saint-hippolyte | 0 | oui | 0/30 | 0.0 % | measured-geo-empty |
| venise-en-quebec | 0 | oui | 0/3 | 0.0 % | measured-geo-empty |
| clarenceville | 0 | oui | 0/1 | 0.0 % | measured-geo-empty |
| joliette | 0 | oui | 0/9 | 0.0 % | measured-geo-empty |
| les-coteaux | 0 | oui | 0/5 | 0.0 % | measured-geo-empty |
| saint-dominique | 0 | oui | 0/6 | 0.0 % | measured-geo-empty |
