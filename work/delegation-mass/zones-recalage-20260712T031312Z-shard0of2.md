# Recalage PDF zones — shard 0/2

Date de consolidation: 2026-07-12T03:13:12Z. Branche: `feat/cadre-acquisition`. Sélection: slugs triés, index pair (`index % 2 == 0`), avec priorité aux buckets PDF.

## Résultat

Un dépôt net a passé tous les gates: `hatley`, par T2 auto-seed sur le plan officiel page 122. Le GeoJSON `qc-zonage-hatley` est déposé, puis les deux chaînes immo ont été exécutées inline.

- 31 GCP indépendants issus de coins cadastraux réels.
- Résidu max 10,428 m; holdout max 10,589 m; orientation nord-up; anisotropie 1,061.
- Désambiguïsation 0° décisive: marge tight 22,14 points; spatial 0,40 km.
- 43 codes lettrés verbatim; 42 features; 1 107/1 111 lots (99,64%); surface 99,29%.
- `lot-zone-join-run`: 1 111 lots, parquet/stats vérifiés.
- `lots-enriched-run`: 1 111 lots, surface 100%, adresse 90,91%, dépôt vérifié.

Preuves: [rapport JSON](./zones-recalage-20260712T031312Z-shard0of2.json), [GCP](../gcp/hatley.gcp.json), [rapport T2](./zones-recalage-20260711T-hatley-t2.json).

## Rejets stricts

Les rejets ont été conservés avec la mesure observée; aucun code, GCP, dictionnaire ou zonage n’a été fabriqué.

- `amherst`, `bethanie`, `matagami`, `notre-dame-du-portage`, `saint-isidore-de-clifton`, `sainte-marcelline-de-kildare`, `sainte-monique--lac-saint-jean-est`, `sainte-thecle`, `saint-louis-de-gonzague--beauharnois-salaberry`, `tres-saint-redempteur`, `trois-rives`: plans raster/annexes sans vecteurs (`svg_points=0`) et sans graine GCP réelle pour T3.
- `bonaventure`: GeoPDF résidu 0,31 m mais gate spatial 8,64 km > 8 km.
- `duhamel`: résidu 0,08 m, mais spatial 17,60 km / 9,57 km; diagnostic: 2/48 labels dans bbox et seulement 7,34% des lots.
- `lantier`, `riviere-eternite`: moins de six matches indépendants après pruning, aucun fit démontrable.
- `montcalm`, `north-hatley`, `rougemont` agricole, `stanstead`: iso-gate anisotropie/orientation; les arbitrages lot-assignment n’ont pas confirmé une couverture valide.
- `rougemont` urbain: voie Claude vision exécutée conformément à la règle glyphes; 42/43 lectures validées contre 75 codes réels du registre, mais gate spatial 10 624,85 km.
- `saint-telesphore`: résidu compatible mais rotation 0°/180° indécidable, marge 0,1 point et serving 79,59%.
- Les règlements non-GeoPDF et les pages sans carte sont restés des preuves d’entrée insuffisante, jamais des dépôts.

## Traçabilité découverte

Les douze rapports `zones-recalage-20260711T-batch01...batch12-discovery-shard0.json` listent chaque slug examiné et les liens effectivement trouvés dans les pages officielles. Ils sont référencés dans le JSON de consolidation.

`loop-supervise` a été relancé entre chaque lot. Aucun AGOL owner harvest n’a été effectué. Les fichiers `.claude`, `.track` et secrets préexistants ont été laissés intacts.
