# COL20 emit readiness split (2026-08-08)

## $meta
- routing_correction: La destination "geo-zones" est incorrecte pour ces 93 villes: le vrai owner est wp5 (jointures-detect) pour émission qc-zoning-events quand le PV est capturé, sinon wp4 (pv-capture) avant émission.
- méthode: Pour chaque ville escalade_geo_zones, association avec immo-events via city_slug puis contrôle URL source dans pv-capture-kpi-20260726-084c868acc968fb1.json (documents[].captures).
- source_file: /home/antoinefa/src/geo/.lanes/jointures/work/coverage/escalade-col20-no-geo-events-20260807.json
- capture_state_source: /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json
- source_commit: d22c3e5c
- DRY-RUN: true
- anti_invention: Aucune invention: si une URL n'est pas vérifiable dans capture state, catégorie unknown_capture_state.

## Résumé
- target cities: 93
- jointures_emit_ready: 0
- pv_capture_needed: 93
- unknown_capture_state: 0
- total immo_events récupérables si emit_ready: 0

| slug | immo_events | url_http_count | pv_captured_count | categorie | evidence |
| --- | --- | --- | --- | --- | --- |
| baie-durfe | 3 | 3 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=baie-durfe; 0 URL capturée) |
| beloeil | 7 | 7 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=beloeil; 0 URL capturée) |
| blainville | 7 | 7 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=blainville; 0 URL capturée) |
| bois-des-filion | 8 | 8 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=bois-des-filion; 0 URL capturée) |
| boisbriand | 12 | 12 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=boisbriand; 0 URL capturée) |
| boucherville | 5 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=boucherville; 0 URL capturée) |
| brossard | 23 | 23 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=brossard; 0 URL capturée) |
| calixa-lavallee | 5 | 5 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=calixa-lavallee; 0 URL capturée) |
| candiac | 5 | 5 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=candiac; 0 URL capturée) |
| carignan | 15 | 15 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=carignan; 0 URL capturée) |
| chambly | 1 | 1 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=chambly; 0 URL capturée) |
| charlemagne | 12 | 11 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=charlemagne; 0 URL capturée) |
| chateauguay | 6 | 6 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=chateauguay; 0 URL capturée) |
| contrecoeur | 9 | 9 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=contrecoeur; 0 URL capturée) |
| coteau-du-lac | 10 | 10 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=coteau-du-lac; 0 URL capturée) |
| delson | 12 | 12 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=delson; 0 URL capturée) |
| deux-montagnes | 9 | 9 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=deux-montagnes; 0 URL capturée) |
| dollard-des-ormeaux | 2 | 2 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=dollard-des-ormeaux; 0 URL capturée) |
| dorval | 11 | 11 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=dorval; 0 URL capturée) |
| hampstead | 3 | 3 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=hampstead; 0 URL capturée) |
| henryville | 1 | 1 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=henryville; 0 URL capturée) |
| hudson | 6 | 6 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=hudson; 0 URL capturée) |
| joliette | 9 | 9 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=joliette; 0 URL capturée) |
| la-prairie | 11 | 11 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=la-prairie; 0 URL capturée) |
| lavaltrie | 8 | 8 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=lavaltrie; 0 URL capturée) |
| les-cedres | 7 | 7 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=les-cedres; 0 URL capturée) |
| les-coteaux | 5 | 5 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=les-coteaux; 0 URL capturée) |
| lile-cadieux | 2 | 2 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=lile-cadieux; 0 URL capturée) |
| lile-perrot | 17 | 17 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=lile-perrot; 0 URL capturée) |
| longueuil | 3 | 3 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=longueuil; 0 URL capturée) |
| lorraine | 10 | 10 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=lorraine; 0 URL capturée) |
| mascouche | 6 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=mascouche; 0 URL capturée) |
| mcmasterville | 12 | 12 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=mcmasterville; 0 URL capturée) |
| mirabel | 9 | 8 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=mirabel; 0 URL capturée) |
| mont-royal | 5 | 5 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=mont-royal; 0 URL capturée) |
| mont-saint-gregoire | 7 | 7 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=mont-saint-gregoire; 0 URL capturée) |
| mont-saint-hilaire | 6 | 6 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=mont-saint-hilaire; 0 URL capturée) |
| montreal-est | 4 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=montreal-est; 0 URL capturée) |
| oka | 2 | 2 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=oka; 0 URL capturée) |
| otterburn-park | 7 | 7 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=otterburn-park; 0 URL capturée) |
| pincourt | 7 | 6 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=pincourt; 0 URL capturée) |
| pointe-claire | 25 | 25 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=pointe-claire; 0 URL capturée) |
| pointe-des-cascades | 7 | 7 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=pointe-des-cascades; 0 URL capturée) |
| prevost | 2 | 2 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=prevost; 0 URL capturée) |
| richelieu | 14 | 14 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=richelieu; 0 URL capturée) |
| rosemere | 8 | 8 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=rosemere; 0 URL capturée) |
| saint-alexis | 3 | 3 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-alexis; 0 URL capturée) |
| saint-amable | 13 | 13 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-amable; 0 URL capturée) |
| saint-basile-le-grand | 3 | 3 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-basile-le-grand; 0 URL capturée) |
| saint-bernard-de-michaudville | 8 | 8 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-bernard-de-michaudville; 0 URL capturée) |
| saint-blaise-sur-richelieu | 7 | 7 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-blaise-sur-richelieu; 0 URL capturée) |
| saint-bruno-de-montarville | 10 | 10 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-bruno-de-montarville; 0 URL capturée) |
| saint-calixte | 4 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-calixte; 0 URL capturée) |
| saint-colomban | 10 | 5 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-colomban; 0 URL capturée) |
| saint-damase--les-maskoutains | 1 | 1 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-damase--les-maskoutains; 0 URL capturée) |
| saint-denis-sur-richelieu | 5 | 5 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-denis-sur-richelieu; 0 URL capturée) |
| saint-dominique | 6 | 6 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-dominique; 0 URL capturée) |
| saint-edouard | 4 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-edouard; 0 URL capturée) |
| saint-hippolyte | 30 | 30 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-hippolyte; 0 URL capturée) |
| saint-hyacinthe | 16 | 16 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-hyacinthe; 0 URL capturée) |
| saint-jacques-le-mineur | 7 | 7 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-jacques-le-mineur; 0 URL capturée) |
| saint-jerome | 9 | 9 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-jerome; 0 URL capturée) |
| saint-joseph-du-lac | 3 | 3 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-joseph-du-lac; 0 URL capturée) |
| saint-jude | 2 | 2 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-jude; 0 URL capturée) |
| saint-lambert | 1 | 1 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-lambert; 0 URL capturée) |
| saint-liguori | 2 | 2 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-liguori; 0 URL capturée) |
| saint-louis-de-gonzague--beauharnois-salaberry | 4 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-louis-de-gonzague--beauharnois-salaberry; 0 URL capturée) |
| saint-mathias-sur-richelieu | 4 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-mathias-sur-richelieu; 0 URL capturée) |
| saint-ours | 3 | 3 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-ours; 0 URL capturée) |
| saint-patrice-de-sherrington | 4 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-patrice-de-sherrington; 0 URL capturée) |
| saint-paul | 16 | 16 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-paul; 0 URL capturée) |
| saint-paul-dabbotsford | 4 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-paul-dabbotsford; 0 URL capturée) |
| saint-pie | 32 | 22 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-pie; 0 URL capturée) |
| saint-pierre | 2 | 2 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-pierre; 0 URL capturée) |
| saint-remi | 6 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-remi; 0 URL capturée) |
| saint-roch-de-richelieu | 8 | 8 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-roch-de-richelieu; 0 URL capturée) |
| saint-roch-ouest | 4 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-roch-ouest; 0 URL capturée) |
| saint-sebastien--le-haut-richelieu | 5 | 5 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-sebastien--le-haut-richelieu; 0 URL capturée) |
| saint-stanislas-de-kostka | 4 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=saint-stanislas-de-kostka; 0 URL capturée) |
| sainte-angele-de-monnoir | 7 | 7 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=sainte-angele-de-monnoir; 0 URL capturée) |
| sainte-anne-de-bellevue | 1 | 1 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=sainte-anne-de-bellevue; 0 URL capturée) |
| sainte-anne-des-plaines | 1 | 1 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=sainte-anne-des-plaines; 0 URL capturée) |
| sainte-catherine | 12 | 11 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=sainte-catherine; 0 URL capturée) |
| sainte-julie | 5 | 5 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=sainte-julie; 0 URL capturée) |
| sainte-julienne | 9 | 9 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=sainte-julienne; 0 URL capturée) |
| sainte-marie-salome | 2 | 1 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=sainte-marie-salome; 0 URL capturée) |
| sainte-therese | 4 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=sainte-therese; 0 URL capturée) |
| salaberry-de-valleyfield | 9 | 9 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=salaberry-de-valleyfield; 0 URL capturée) |
| terrebonne | 4 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=terrebonne; 0 URL capturée) |
| varennes | 4 | 4 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=varennes; 0 URL capturée) |
| vaudreuil-sur-le-lac | 1 | 1 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=vaudreuil-sur-le-lac; 0 URL capturée) |
| venise-en-quebec | 3 | 3 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=venise-en-quebec; 0 URL capturée) |
| westmount | 2 | 2 | 0 | pv_capture_needed | /home/antoinefa/src/geo/.lanes/jointures/work/coverage/pv-capture-kpi-20260726-084c868acc968fb1.json (slug=westmount; 0 URL capturée) |
