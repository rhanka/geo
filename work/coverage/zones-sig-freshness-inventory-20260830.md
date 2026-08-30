# Inventaire fraîcheur SIG zonage servi — 2026-08-30 (lecture seule)

Feed de l'axe §3 « zone-SIG-freshness » de geo-archi (fiabilité par priorité owner)
+ pré-scope de la worklist re-source (le re-source réel est OWNER-GATED, PAS maintenant).

## ⚠ Deux axes DISTINCTS (à ne pas confondre)

1. **Fraîcheur de CAPTURE** = `retrieved_at` : quand la géométrie a été fetchée.
   Mesurable seulement si une preuve v2/v1 porte un `retrieved_at`.
2. **Vintage AMONT** = âge de la donnée source elle-même. Un `retrieved_at` FRAIS sur
   une couche amont périmée reste **MEASURED-FRESH en capture** mais
   **SOURCE-PÉRIMÉ-SUSPECT en vintage** — c'est le cas de **mont-tremblant** (servi
   depuis `.../Ancien_zonage/…`, règlement 2008). Le vintage amont n'est mesurable que
   par un marqueur EXPLICITE (URL "ancien/old/…" ou millésime propriété) ; sinon non
   mesurable, jamais inventé.

## Méthode & anti-invention

- `retrieved_at` extrait **verbatim** de la preuve géométrique servie (feature-proof
  v2/v1 d'abord, puis collection-proof). **Aucune date inventée.**
- Fraîcheur **non mesurable** (pas de `retrieved_at`) → **SOURCE-GAP**, jamais un périmé
  affirmé sans base.
- Seuil périmé **préliminaire** : retrieved_at ≥ **18 mois** (aujourd'hui
  2026-08-30). L'âge exact est reporté → re-tunable quand geo-archi fixe le seuil.
- Autorité-layout : niché-gagne (`selectServedZoneCollections`), même règle que les sondes voisines.

## Totaux (S3, lecture seule)

- collections servies sélectionnées : **873**
- inventoriées : **873** (erreurs de lecture : 0)
- **retrieved_at MESURABLE : 364** / 873
- **fraîcheur NON mesurable (SOURCE-GAP) : 509**
- **source-périmé-suspects (vintage amont, axe distinct) : 1**
- sources servies depuis un miroir Wayback (enjeu de liveness, ≠ périmé) : 1

## Comptes par classe de fraîcheur

- **SOURCE-GAP** : 509
- **MEASURED-FRESH** : 364

## Par `zone_source_level`

- legacy-traceable : 370
- documented : 365
- orphan : 75
- candidate : 35
- historical-verified : 27
- (absent/null) : 1

## Par `method`

- (aucun) : 509
- natif : 364

## Cross-tab classe × `zone_source_level`

Un level `documented`/`historical-verified` ne garantit PAS un `retrieved_at` mesurable :
le level a pu être stampé additivement sans capture v2.

| level | MEASURED-FRESH | SOURCE-GAP |
|-------|----------------|------------|
| documented | 364 | 1 |
| legacy-traceable | 0 | 370 |
| candidate | 0 | 35 |
| orphan | 0 | 75 |
| historical-verified | 0 | 27 |
| (absent/null) | 0 | 1 |

## Périmés cités par geo-archi (vérif explicite)

- **repentigny** : capture=MEASURED-FRESH (retrieved_at=2026-08-02T22:10:28.179Z, 0 mois), level=documented, method=natif, **source-périmé-suspect=no**; zone_source_url=`https://www.donneesquebec.ca/recherche/dataset/d8dffd21-359d-43dd-af8f-32d44a274cfe/resource/74ee6756-9d5d-4c9e-9b0d-8d694aeb1a7d/download/zonage_municipal.geojson`
- **beaupre** : capture=MEASURED-FRESH (retrieved_at=2026-08-16T04:31:40.965Z, 0 mois), level=documented, method=natif, **source-périmé-suspect=no**; millésime propriété: reglement_millesime=2016, densite_apres_millesime=2016; zone_source_url=`https://services6.arcgis.com/osUKB2jztkflrQhx/arcgis/rest/services/Zonage/FeatureServer/17/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`
- **mont-tremblant** : capture=MEASURED-FRESH (retrieved_at=2026-07-26T13:44:34.897Z, 1 mois), level=documented, method=natif, **source-périmé-suspect=yes** (zone_source_url marque une couche amont périmée/superseded ("Ancien")); millésime propriété: reglement_millesime="2008", densite_apres_millesime="2008"; zone_source_url=`https://services6.arcgis.com/GnhEJPl3z9NGOl6b/arcgis/rest/services/Ancien_zonage/FeatureServer/1/query?where=1%3D1&outFields=Zone&outSR=4326&geometryPrecision=6&resultOffset=0&resultRecordCount=1000&f=geojson`

## SOURCE-PÉRIMÉ-SUSPECT (vintage amont — axe distinct de la capture) — 1

Capture fraîche mais couche source marquée superseded/ancienne dans `zone_source_url`.

- **mont-tremblant** : marqueur=`Ancien`, retrieved_at=2026-07-26T13:44:34.897Z (capture MEASURED-FRESH), url=`https://services6.arcgis.com/GnhEJPl3z9NGOl6b/arcgis/rest/services/Ancien_zonage/FeatureServer/1/query?where=1%3D1&outFields=Zone&outSR=4326&geometryPrecision=6&resultOffset=0&resultRecordCount=1000&f=geojson`

## MEASURED-STALE (capture périmée) — retrieved_at ≥ 18 mois

_(aucun muni avec un retrieved_at mesurable au-delà du seuil)_

## MEASURED-FRESH — retrieved_at < 18 mois

- adstock : 2026-08-10T15:17:31.640Z (0 mois), level=documented, method=natif
- albertville : 2026-08-10T15:36:24.107Z (0 mois), level=documented, method=natif
- amqui : 2026-08-10T15:36:22.257Z (0 mois), level=documented, method=natif
- audet : 2026-08-02T22:04:02.453Z (0 mois), level=documented, method=natif
- baie-comeau : 2026-08-10T15:17:29.566Z (0 mois), level=documented, method=natif
- baie-trinite : 2026-08-10T15:36:21.707Z (0 mois), level=documented, method=natif
- barraute : 2026-08-10T15:36:21.689Z (0 mois), level=documented, method=natif
- beauceville : 2026-08-10T15:17:29.520Z (0 mois), level=documented, method=natif
- beaulac-garthby : 2026-08-10T15:36:41.380Z (0 mois), level=documented, method=natif
- beaupre : 2026-08-16T04:31:40.965Z (0 mois), level=documented, method=natif
- berry : 2026-08-10T15:36:21.777Z (0 mois), level=documented, method=natif
- berthier-sur-mer : 2026-08-10T15:36:21.291Z (0 mois), level=documented, method=natif
- berthierville : 2026-08-10T15:36:43.908Z (0 mois), level=documented, method=natif
- biencourt : 2026-08-02T22:04:13.328Z (0 mois), level=documented, method=natif
- boucherville : 2026-08-10T18:47:25.049Z (0 mois), level=documented, method=natif
- brossard : 2026-08-10T18:47:32.238Z (0 mois), level=documented, method=natif
- cap-saint-ignace : 2026-08-10T15:37:00.345Z (0 mois), level=documented, method=natif
- caplan : 2026-08-02T22:04:20.644Z (0 mois), level=documented, method=natif
- carleton-sur-mer : 2026-08-02T22:04:23.352Z (0 mois), level=documented, method=natif
- cascapedia-saint-jules : 2026-08-02T22:04:27.478Z (0 mois), level=documented, method=natif
- causapscal : 2026-08-10T15:36:49.543Z (0 mois), level=documented, method=natif
- champneuf : 2026-08-10T15:36:43.950Z (0 mois), level=documented, method=natif
- chateauguay : 2026-08-10T15:36:44.113Z (0 mois), level=documented, method=natif
- chesterville : 2026-08-10T17:24:01.701Z (0 mois), level=documented, method=natif
- chute-aux-outardes : 2026-08-10T15:37:11.356Z (0 mois), level=documented, method=natif
- chute-saint-philippe : 2026-08-16T03:21:48.441Z (0 mois), level=documented, method=natif
- cleveland : 2026-08-02T22:04:31.053Z (0 mois), level=documented, method=natif
- contrecoeur : 2026-08-03T13:55:10.159Z (0 mois), level=documented, method=natif
- crabtree : 2026-08-10T15:37:10.610Z (0 mois), level=documented, method=natif
- danville : 2026-08-10T15:36:43.892Z (0 mois), level=documented, method=natif
- degelis : 2026-08-02T22:04:36.457Z (0 mois), level=documented, method=natif
- deschaillons-sur-saint-laurent : 2026-08-02T22:04:38.920Z (0 mois), level=documented, method=natif
- disraeli--les-appalaches--2 : 2026-08-10T15:36:27.235Z (0 mois), level=documented, method=natif
- dosquet : 2026-08-02T22:04:44.254Z (0 mois), level=documented, method=natif
- drummondville : 2026-08-02T22:04:49.423Z (0 mois), level=documented, method=natif
- dundee : 2026-08-10T15:36:24.838Z (0 mois), level=documented, method=natif
- east-broughton : 2026-08-10T15:36:24.302Z (0 mois), level=documented, method=natif
- elgin : 2026-08-10T15:36:24.707Z (0 mois), level=documented, method=natif
- escuminac : 2026-08-02T22:04:53.992Z (0 mois), level=documented, method=natif
- esterel : 2026-08-10T15:36:44.208Z (0 mois), level=documented, method=natif
- farnham : 2026-08-10T15:36:24.845Z (0 mois), level=documented, method=natif
- ferme-neuve : 2026-08-02T22:05:07.914Z (0 mois), level=documented, method=natif
- fermont : 2026-08-10T15:36:24.068Z (0 mois), level=documented, method=natif
- fort-coulonge : 2026-08-02T22:05:12.731Z (0 mois), level=documented, method=natif
- fortierville : 2026-08-02T22:05:18.963Z (0 mois), level=documented, method=natif
- fossambault-sur-le-lac : 2026-08-02T22:05:21.825Z (0 mois), level=documented, method=natif
- franquelin : 2026-08-10T15:36:46.575Z (0 mois), level=documented, method=natif
- frontenac : 2026-08-02T22:05:28.379Z (0 mois), level=documented, method=natif
- gaspe : 2026-08-10T17:05:39.329Z (0 mois), level=documented, method=natif
- gatineau : 2026-08-10T15:37:03.886Z (0 mois), level=documented, method=natif
- godmanchester : 2026-08-10T15:36:52.438Z (0 mois), level=documented, method=natif
- ham-nord : 2026-08-10T17:24:08.008Z (0 mois), level=documented, method=natif
- hampstead : 2026-08-10T11:26:59.235Z (0 mois), level=documented, method=natif
- havelock : 2026-08-10T15:36:47.343Z (0 mois), level=documented, method=natif
- hinchinbrooke : 2026-08-10T15:36:46.635Z (0 mois), level=documented, method=natif
- hope-town : 2026-08-10T17:05:35.918Z (0 mois), level=documented, method=natif
- howick : 2026-08-10T15:37:13.939Z (0 mois), level=documented, method=natif
- huntingdon : 2026-08-10T15:37:15.054Z (0 mois), level=documented, method=natif
- irlande : 2026-08-10T15:36:47.331Z (0 mois), level=documented, method=natif
- joliette : 2026-08-10T15:36:30.142Z (0 mois), level=documented, method=natif
- kiamika : 2026-08-02T22:05:42.685Z (0 mois), level=documented, method=natif
- kingsbury : 2026-08-02T22:05:46.601Z (0 mois), level=documented, method=natif
- kingsey-falls : 2026-08-10T17:24:00.054Z (0 mois), level=documented, method=natif
- kinnears-mills : 2026-08-10T15:36:28.051Z (0 mois), level=documented, method=natif
- la-corne : 2026-08-10T15:36:27.320Z (0 mois), level=documented, method=natif
- la-macaza : 2026-08-02T22:06:00.849Z (0 mois), level=documented, method=natif
- la-motte : 2026-08-10T15:36:27.778Z (0 mois), level=documented, method=natif
- la-peche : 2026-08-02T22:06:04.821Z (0 mois), level=documented, method=natif
- la-redemption : 2026-08-10T15:36:46.988Z (0 mois), level=documented, method=natif
- la-visitation-de-lile-dupas : 2026-08-10T15:36:27.467Z (0 mois), level=documented, method=natif
- lac-au-saumon : 2026-08-10T15:36:27.358Z (0 mois), level=documented, method=natif
- lac-beauport : 2026-08-02T22:06:11.939Z (0 mois), level=documented, method=natif
- lac-delage : 2026-08-02T22:06:16.520Z (0 mois), level=documented, method=natif
- lac-des-ecorces : 2026-08-16T03:21:51.773Z (0 mois), level=documented, method=natif
- lac-des-seize-iles : 2026-08-10T15:36:49.138Z (0 mois), level=documented, method=natif
- lac-drolet : 2026-08-02T22:06:20.434Z (0 mois), level=documented, method=natif
- lac-du-cerf : 2026-08-02T22:06:33.409Z (0 mois), level=documented, method=natif
- lac-frontiere : 2026-08-10T15:37:06.698Z (0 mois), level=documented, method=natif
- lac-megantic : 2026-08-02T22:06:36.910Z (0 mois), level=documented, method=natif
- lac-saguay : 2026-08-02T22:06:51.475Z (0 mois), level=documented, method=natif
- lac-saint-paul : 2026-08-02T22:07:04.995Z (0 mois), level=documented, method=natif
- lambton : 2026-08-02T22:07:08.983Z (0 mois), level=documented, method=natif
- landrienne : 2026-08-10T15:36:55.151Z (0 mois), level=documented, method=natif
- lanoraie : 2026-08-10T16:00:59.924Z (0 mois), level=documented, method=natif
- lascension : 2026-08-16T03:21:54.985Z (0 mois), level=documented, method=natif
- lascension-de-patapedia : 2026-08-02T22:07:11.865Z (0 mois), level=documented, method=natif
- lassomption : 2026-08-02T22:07:16.170Z (0 mois), level=documented, method=natif
- launay : 2026-08-10T16:00:58.419Z (0 mois), level=documented, method=natif
- laurier-station : 2026-08-02T22:07:22.733Z (0 mois), level=documented, method=natif
- laval : 2026-08-02T22:07:30.321Z (0 mois), level=documented, method=natif
- lavaltrie : 2026-08-10T16:00:58.742Z (0 mois), level=documented, method=natif
- leclercville : 2026-08-02T22:07:36.262Z (0 mois), level=documented, method=natif
- lejeune : 2026-08-02T22:07:40.814Z (0 mois), level=documented, method=natif
- lemieux : 2026-08-02T22:07:47.637Z (0 mois), level=documented, method=natif
- les-hauteurs : 2026-08-02T22:07:51.388Z (0 mois), level=documented, method=natif
- longueuil : 2026-08-10T10:07:11.312Z (0 mois), level=documented, method=natif
- lotbiniere : 2026-08-02T22:07:56.895Z (0 mois), level=documented, method=natif
- maddington-falls : 2026-08-10T17:24:00.507Z (0 mois), level=documented, method=natif
- mandeville : 2026-08-10T16:00:58.989Z (0 mois), level=documented, method=natif
- manseau : 2026-08-02T22:07:59.681Z (0 mois), level=documented, method=natif
- maria : 2026-08-02T22:08:02.288Z (0 mois), level=documented, method=natif
- maricourt : 2026-08-02T22:08:07.108Z (0 mois), level=documented, method=natif
- marston : 2026-08-02T22:08:10.820Z (0 mois), level=documented, method=natif
- melbourne : 2026-08-02T22:08:14.569Z (0 mois), level=documented, method=natif
- milan : 2026-08-02T22:08:20.569Z (0 mois), level=documented, method=natif
- mille-isles : 2026-08-16T04:31:38.167Z (0 mois), level=documented, method=natif
- mirabel : 2026-08-02T22:08:23.766Z (0 mois), level=documented, method=natif
- mont-joli : 2026-08-10T16:00:58.909Z (0 mois), level=documented, method=natif
- mont-laurier : 2026-08-02T22:08:36.699Z (0 mois), level=documented, method=natif
- mont-saint-michel : 2026-08-02T22:08:49.474Z (0 mois), level=documented, method=natif
- montmagny : 2026-08-10T16:01:17.997Z (0 mois), level=documented, method=natif
- montreal : 2026-08-02T22:08:52.896Z (0 mois), level=documented, method=natif
- morin-heights : 2026-08-10T16:00:59.027Z (0 mois), level=documented, method=natif
- murdochville : 2026-08-10T17:05:35.840Z (0 mois), level=documented, method=natif
- new-carlisle : 2026-08-02T22:08:56.830Z (0 mois), level=documented, method=natif
- new-richmond : 2026-08-02T22:09:01.117Z (0 mois), level=documented, method=natif
- nominingue : 2026-08-02T22:09:15.399Z (0 mois), level=documented, method=natif
- notre-dame-de-pontmain : 2026-08-02T22:09:28.429Z (0 mois), level=documented, method=natif
- notre-dame-des-bois : 2026-08-02T22:09:32.159Z (0 mois), level=documented, method=natif
- notre-dame-des-prairies : 2026-08-10T16:01:51.385Z (0 mois), level=documented, method=natif
- notre-dame-du-laus : 2026-08-02T22:09:46.048Z (0 mois), level=documented, method=natif
- notre-dame-du-sacre-coeur-dissoudun : 2026-08-02T22:09:52.087Z (0 mois), level=documented, method=natif
- nouvelle : 2026-08-02T22:09:56.255Z (0 mois), level=documented, method=natif
- packington : 2026-08-02T22:10:00.159Z (0 mois), level=documented, method=natif
- parisville : 2026-08-02T22:10:05.580Z (0 mois), level=documented, method=natif
- paspebiac : 2026-08-10T17:05:37.342Z (0 mois), level=documented, method=natif
- piedmont : 2026-08-10T16:01:48.895Z (0 mois), level=documented, method=natif
- piopolis : 2026-08-02T22:10:12.308Z (0 mois), level=documented, method=natif
- pohenegamook : 2026-08-02T22:10:16.102Z (0 mois), level=documented, method=natif
- pointe-a-la-croix : 2026-08-02T22:10:20.562Z (0 mois), level=documented, method=natif
- pointe-aux-outardes : 2026-08-10T18:28:21.741Z (0 mois), level=documented, method=natif
- pointe-lebel : 2026-08-10T16:01:21.545Z (0 mois), level=documented, method=natif
- potton : 2026-08-02T22:10:24.425Z (0 mois), level=documented, method=natif
- price : 2026-08-10T16:01:21.449Z (0 mois), level=documented, method=natif
- ragueneau : 2026-08-10T16:01:28.140Z (0 mois), level=documented, method=natif
- repentigny : 2026-08-02T22:10:28.179Z (0 mois), level=documented, method=natif
- ristigouche-sud-est : 2026-08-02T22:10:39.282Z (0 mois), level=documented, method=natif
- riviere-bleue : 2026-08-02T22:10:43.667Z (0 mois), level=documented, method=natif
- riviere-rouge : 2026-08-02T22:11:08.773Z (0 mois), level=documented, method=natif
- sacre-coeur-de-jesus : 2026-08-10T16:01:20.689Z (0 mois), level=documented, method=natif
- saint-adolphe-dhoward : 2026-08-10T16:01:03.076Z (0 mois), level=documented, method=natif
- saint-adrien : 2026-08-10T16:01:01.117Z (0 mois), level=documented, method=natif
- saint-adrien-dirlande : 2026-08-10T16:01:01.479Z (0 mois), level=documented, method=natif
- saint-agapit : 2026-08-02T22:11:28.097Z (0 mois), level=documented, method=natif
- saint-aime-du-lac-des-iles : 2026-08-02T22:11:42.595Z (0 mois), level=documented, method=natif
- saint-albert : 2026-08-10T17:23:59.594Z (0 mois), level=documented, method=natif
- saint-alexandre-des-lacs : 2026-08-10T16:01:01.501Z (0 mois), level=documented, method=natif
- saint-alexis-de-matapedia : 2026-08-02T22:11:46.888Z (0 mois), level=documented, method=natif
- saint-alfred : 2026-08-10T16:01:01.514Z (0 mois), level=documented, method=natif
- saint-alphonse : 2026-08-02T22:11:50.764Z (0 mois), level=documented, method=natif
- saint-anaclet-de-lessard : 2026-08-10T18:28:21.540Z (0 mois), level=documented, method=natif
- saint-andre-de-restigouche : 2026-08-02T22:11:55.553Z (0 mois), level=documented, method=natif
- saint-anicet : 2026-08-10T16:01:01.774Z (0 mois), level=documented, method=natif
- saint-antoine-de-lisle-aux-grues : 2026-08-10T16:01:54.311Z (0 mois), level=documented, method=natif
- saint-antoine-de-tilly : 2026-08-02T22:12:00.801Z (0 mois), level=documented, method=natif
- saint-apollinaire : 2026-08-02T22:12:09.125Z (0 mois), level=documented, method=natif
- saint-athanase : 2026-08-02T22:12:14.665Z (0 mois), level=documented, method=natif
- saint-augustin-de-desmaures : 2026-08-02T22:12:24.207Z (0 mois), level=documented, method=natif
- saint-augustin-de-woburn : 2026-08-02T22:12:31.772Z (0 mois), level=documented, method=natif
- saint-barthelemy : 2026-08-10T16:01:23.768Z (0 mois), level=documented, method=natif
- saint-camille : 2026-08-10T16:01:51.879Z (0 mois), level=documented, method=natif
- saint-camille-de-lellis : 2026-08-10T18:28:23.881Z (0 mois), level=documented, method=natif
- saint-charles-borromee : 2026-08-10T16:01:25.086Z (0 mois), level=documented, method=natif
- saint-charles-sur-richelieu : 2026-08-03T12:26:02.721Z (0 mois), level=documented, method=natif
- saint-christophe-darthabaska : 2026-08-10T17:24:08.067Z (0 mois), level=documented, method=natif
- saint-chrysostome : 2026-08-10T16:01:31.113Z (0 mois), level=documented, method=natif
- saint-claude : 2026-08-02T22:12:35.882Z (0 mois), level=documented, method=natif
- saint-cleophas : 2026-08-10T16:01:23.451Z (0 mois), level=documented, method=natif
- saint-cleophas-de-brandon : 2026-08-10T16:01:06.242Z (0 mois), level=documented, method=natif
- saint-colomban : 2026-08-10T10:49:30.796Z (0 mois), level=documented, method=natif
- saint-cuthbert : 2026-08-10T16:01:04.068Z (0 mois), level=documented, method=natif
- saint-cyrille-de-lessard : 2026-08-10T16:01:04.003Z (0 mois), level=documented, method=natif
- saint-damase--la-matapedia : 2026-08-10T16:01:04.354Z (0 mois), level=documented, method=natif
- saint-denis-de-brompton : 2026-08-02T22:12:38.919Z (0 mois), level=documented, method=natif
- saint-denis-sur-richelieu : 2026-08-10T16:38:45.780Z (0 mois), level=documented, method=natif
- saint-didace : 2026-08-10T16:01:05.284Z (0 mois), level=documented, method=natif
- saint-dominique : 2026-08-03T12:26:53.965Z (0 mois), level=documented, method=natif
- saint-dominique-du-rosaire : 2026-08-10T16:01:23.595Z (0 mois), level=documented, method=natif
- saint-edouard-de-lotbiniere : 2026-08-02T22:12:45.756Z (0 mois), level=documented, method=natif
- saint-elzear--bonaventure : 2026-08-02T22:12:49.748Z (0 mois), level=documented, method=natif
- saint-elzear-de-temiscouata : 2026-08-02T22:12:54.785Z (0 mois), level=documented, method=natif
- saint-eusebe : 2026-08-02T22:12:58.252Z (0 mois), level=documented, method=natif
- saint-fabien-de-panet : 2026-08-10T16:01:57.531Z (0 mois), level=documented, method=natif
- saint-felix-de-dalquier : 2026-08-02T22:13:01.309Z (0 mois), level=documented, method=natif
- saint-flavien : 2026-08-10T17:05:49.574Z (0 mois), level=documented, method=natif
- saint-fortunat : 2026-08-10T16:01:26.999Z (0 mois), level=documented, method=natif
- saint-francois-dassise : 2026-08-10T17:05:36.607Z (0 mois), level=documented, method=natif
- saint-francois-de-lile-dorleans : 2026-08-10T17:05:35.505Z (0 mois), level=documented, method=natif
- saint-francois-xavier-de-brompton : 2026-08-10T17:51:24.243Z (0 mois), level=documented, method=natif
- saint-gabriel-de-brandon : 2026-08-10T16:19:11.097Z (0 mois), level=documented, method=natif
- saint-gabriel-de-rimouski : 2026-08-10T16:19:08.656Z (0 mois), level=documented, method=natif
- saint-gabriel-de-valcartier : 2026-08-10T17:05:51.912Z (0 mois), level=documented, method=natif
- saint-georges : 2026-08-10T16:19:09.503Z (0 mois), level=documented, method=natif
- saint-georges-de-windsor : 2026-08-10T16:19:28.113Z (0 mois), level=documented, method=natif
- saint-hippolyte : 2026-08-10T11:21:17.445Z (0 mois), level=documented, method=natif
- saint-honore-de-temiscouata : 2026-08-10T17:51:21.592Z (0 mois), level=documented, method=natif
- saint-hyacinthe : 2026-08-10T13:02:28.279Z (0 mois), level=documented, method=natif
- saint-ignace-de-loyola : 2026-08-10T18:28:20.940Z (0 mois), level=documented, method=natif
- saint-jacques-de-leeds : 2026-08-10T16:19:09.108Z (0 mois), level=documented, method=natif
- saint-jacques-le-majeur-de-wolfestown : 2026-08-10T16:19:09.502Z (0 mois), level=documented, method=natif
- saint-janvier-de-joly : 2026-08-10T17:05:52.481Z (0 mois), level=documented, method=natif
- saint-jean-de-brebeuf : 2026-08-10T16:19:30.640Z (0 mois), level=documented, method=natif
- saint-jean-de-la-lande : 2026-08-10T17:51:21.207Z (0 mois), level=documented, method=natif
- saint-jean-de-lile-dorleans : 2026-08-10T17:51:21.249Z (0 mois), level=documented, method=natif
- saint-joseph-de-beauce : 2026-08-10T16:19:32.675Z (0 mois), level=documented, method=natif
- saint-joseph-de-coleraine : 2026-08-10T16:19:38.314Z (0 mois), level=documented, method=natif
- saint-joseph-des-erables : 2026-08-10T16:19:31.909Z (0 mois), level=documented, method=natif
- saint-jules : 2026-08-10T16:19:59.354Z (0 mois), level=documented, method=natif
- saint-julien : 2026-08-10T16:20:03.207Z (0 mois), level=documented, method=natif
- saint-just-de-bretenieres : 2026-08-10T16:19:31.908Z (0 mois), level=documented, method=natif
- saint-juste-du-lac : 2026-08-10T17:51:21.674Z (0 mois), level=documented, method=natif
- saint-leon-le-grand--la-matapedia : 2026-08-10T16:19:14.428Z (0 mois), level=documented, method=natif
- saint-lin-laurentides : 2026-08-10T11:21:13.965Z (0 mois), level=documented, method=natif
- saint-louis-de-blandford : 2026-08-02T22:13:04.780Z (0 mois), level=documented, method=natif
- saint-louis-du-ha-ha : 2026-08-10T17:51:39.859Z (0 mois), level=documented, method=natif
- saint-ludger : 2026-08-10T18:28:41.043Z (0 mois), level=documented, method=natif
- saint-marc-de-figuery : 2026-08-10T16:19:11.368Z (0 mois), level=documented, method=natif
- saint-marc-du-lac-long : 2026-08-10T17:51:20.854Z (0 mois), level=documented, method=natif
- saint-marcel : 2026-08-10T18:28:23.172Z (0 mois), level=documented, method=natif
- saint-marcellin : 2026-08-10T18:28:33.632Z (0 mois), level=documented, method=natif
- saint-martin : 2026-08-02T22:13:08.327Z (0 mois), level=documented, method=natif
- saint-mathieu-dharricana : 2026-08-10T16:19:11.763Z (0 mois), level=documented, method=natif
- saint-michel : 2026-08-03T12:31:05.836Z (0 mois), level=documented, method=natif
- saint-michel-du-squatec : 2026-08-10T17:51:52.460Z (0 mois), level=documented, method=natif
- saint-moise : 2026-08-10T16:19:12.698Z (0 mois), level=documented, method=natif
- saint-narcisse-de-beaurivage : 2026-08-02T22:13:14.032Z (0 mois), level=documented, method=natif
- saint-noel : 2026-08-10T16:19:12.558Z (0 mois), level=documented, method=natif
- saint-octave-de-metis : 2026-08-10T16:19:34.200Z (0 mois), level=documented, method=natif
- saint-patrice-de-beaurivage : 2026-08-02T22:13:19.892Z (0 mois), level=documented, method=natif
- saint-patrice-de-sherrington : 2026-08-03T12:31:56.225Z (0 mois), level=documented, method=natif
- saint-paul : 2026-08-10T16:19:36.051Z (0 mois), level=documented, method=natif
- saint-pie : 2026-08-03T13:07:40.282Z (0 mois), level=documented, method=natif
- saint-pierre : 2026-08-10T16:19:40.898Z (0 mois), level=documented, method=natif
- saint-pierre-de-broughton : 2026-08-10T16:19:51.435Z (0 mois), level=documented, method=natif
- saint-pierre-de-la-riviere-du-sud : 2026-08-10T16:19:34.659Z (0 mois), level=documented, method=natif
- saint-pierre-de-lamy : 2026-08-10T17:51:37.172Z (0 mois), level=documented, method=natif
- saint-pierre-de-lile-dorleans : 2026-08-10T17:05:53.598Z (0 mois), level=documented, method=natif
- saint-pierre-les-becquets : 2026-08-02T22:13:26.125Z (0 mois), level=documented, method=natif
- saint-remi-de-tingwick : 2026-08-10T17:24:12.679Z (0 mois), level=documented, method=natif
- saint-romain : 2026-08-10T17:51:35.741Z (0 mois), level=documented, method=natif
- saint-rosaire : 2026-08-10T17:24:27.941Z (0 mois), level=documented, method=natif
- saint-sebastien--le-granit : 2026-08-10T17:51:37.073Z (0 mois), level=documented, method=natif
- saint-severin--beauce-centre : 2026-08-10T16:20:02.742Z (0 mois), level=documented, method=natif
- saint-sylvestre : 2026-08-02T22:13:31.878Z (0 mois), level=documented, method=natif
- saint-tharcisius : 2026-08-10T16:20:06.117Z (0 mois), level=documented, method=natif
- saint-vianney : 2026-08-10T16:19:35.083Z (0 mois), level=documented, method=natif
- saint-zenon-du-lac-humqui : 2026-08-10T16:19:17.015Z (0 mois), level=documented, method=natif
- sainte-agathe-de-lotbiniere : 2026-08-02T22:13:36.883Z (0 mois), level=documented, method=natif
- sainte-angele-de-merici : 2026-08-10T16:19:14.254Z (0 mois), level=documented, method=natif
- sainte-anne-de-la-rochelle : 2026-08-02T22:13:42.908Z (0 mois), level=documented, method=natif
- sainte-anne-des-lacs : 2026-08-10T16:19:15.415Z (0 mois), level=documented, method=natif
- sainte-anne-du-lac : 2026-08-02T22:13:57.607Z (0 mois), level=documented, method=natif
- sainte-apolline-de-patton : 2026-08-10T16:19:33.794Z (0 mois), level=documented, method=natif
- sainte-barbe : 2026-08-10T16:19:15.822Z (0 mois), level=documented, method=natif
- sainte-brigitte-de-laval : 2026-08-02T22:14:01.608Z (0 mois), level=documented, method=natif
- sainte-catherine-de-la-jacques-cartier : 2026-08-02T22:14:04.434Z (0 mois), level=documented, method=natif
- sainte-cecile-de-levrard : 2026-08-02T22:14:10.224Z (0 mois), level=documented, method=natif
- sainte-cecile-de-whitton : 2026-08-02T22:14:14.530Z (0 mois), level=documented, method=natif
- sainte-clotilde-de-beauce : 2026-08-10T16:19:15.307Z (0 mois), level=documented, method=natif
- sainte-clotilde-de-horton : 2026-08-10T17:24:17.271Z (0 mois), level=documented, method=natif
- sainte-croix : 2026-08-02T22:14:19.694Z (0 mois), level=documented, method=natif
- sainte-elizabeth-de-warwick : 2026-08-10T17:24:27.709Z (0 mois), level=documented, method=natif
- sainte-euphemie-sur-riviere-du-sud : 2026-08-10T16:19:15.144Z (0 mois), level=documented, method=natif
- sainte-famille-de-lile-dorleans : 2026-08-02T22:14:23.146Z (0 mois), level=documented, method=natif
- sainte-flavie : 2026-08-10T16:19:37.800Z (0 mois), level=documented, method=natif
- sainte-florence : 2026-08-10T16:19:39.603Z (0 mois), level=documented, method=natif
- sainte-francoise--becancour : 2026-08-02T22:14:29.281Z (0 mois), level=documented, method=natif
- sainte-genevieve-de-berthier : 2026-08-10T16:19:43.681Z (0 mois), level=documented, method=natif
- sainte-gertrude-manneville : 2026-08-10T16:38:44.856Z (0 mois), level=documented, method=natif
- sainte-irene : 2026-08-10T16:38:45.644Z (0 mois), level=documented, method=natif
- sainte-luce : 2026-08-10T16:39:02.479Z (0 mois), level=documented, method=natif
- sainte-lucie-de-beauregard : 2026-08-10T16:38:45.465Z (0 mois), level=documented, method=natif
- sainte-marguerite-du-lac-masson : 2026-08-10T16:38:45.923Z (0 mois), level=documented, method=natif
- sainte-marguerite-marie : 2026-08-10T16:39:06.133Z (0 mois), level=documented, method=natif
- sainte-marie-de-blandford : 2026-08-02T22:14:37.613Z (0 mois), level=documented, method=natif
- sainte-melanie : 2026-08-10T16:39:05.237Z (0 mois), level=documented, method=natif
- sainte-praxede : 2026-08-10T16:39:05.613Z (0 mois), level=documented, method=natif
- sainte-seraphine : 2026-08-10T17:24:16.119Z (0 mois), level=documented, method=natif
- sainte-sophie : 2026-08-10T10:49:30.745Z (0 mois), level=documented, method=natif
- sainte-sophie-de-levrard : 2026-08-02T22:14:44.124Z (0 mois), level=documented, method=natif
- salaberry-de-valleyfield : 2026-08-10T10:07:10.328Z (0 mois), level=documented, method=natif
- schefferville : 2026-08-10T16:39:06.101Z (0 mois), level=documented, method=natif
- senneterre--la-vallee-de-lor : 2026-08-10T16:39:14.014Z (0 mois), level=documented, method=natif
- sept-iles : 2026-08-10T16:38:51.943Z (0 mois), level=documented, method=natif
- shannon : 2026-08-02T22:14:48.295Z (0 mois), level=documented, method=natif
- sherbrooke : 2026-08-02T22:14:54.855Z (0 mois), level=documented, method=natif
- sorel-tracy : 2026-08-10T16:38:49.089Z (0 mois), level=documented, method=natif
- stoneham-et-tewkesbury : 2026-08-02T22:15:00.602Z (0 mois), level=documented, method=natif
- stornoway : 2026-08-10T17:51:37.760Z (0 mois), level=documented, method=natif
- thetford-mines : 2026-08-10T16:38:47.826Z (0 mois), level=documented, method=natif
- tingwick : 2026-08-10T17:24:22.041Z (0 mois), level=documented, method=natif
- trecesson : 2026-08-10T16:38:48.273Z (0 mois), level=documented, method=natif
- tres-saint-sacrement : 2026-08-10T16:39:05.386Z (0 mois), level=documented, method=natif
- tring-jonction : 2026-08-10T16:38:48.612Z (0 mois), level=documented, method=natif
- ulverton : 2026-08-10T17:51:27.732Z (0 mois), level=documented, method=natif
- val-brillant : 2026-08-10T16:38:49.444Z (0 mois), level=documented, method=natif
- val-des-sources : 2026-08-10T16:39:09.610Z (0 mois), level=documented, method=natif
- val-dor : 2026-08-02T22:15:09.167Z (0 mois), level=documented, method=natif
- val-racine : 2026-08-10T17:51:24.743Z (0 mois), level=documented, method=natif
- vaudreuil-dorion : 2026-08-10T16:39:07.921Z (0 mois), level=documented, method=natif
- vercheres : 2026-08-02T22:15:12.887Z (0 mois), level=documented, method=natif
- warwick : 2026-08-10T16:39:09.183Z (0 mois), level=documented, method=natif
- wentworth-nord : 2026-08-10T16:39:09.095Z (0 mois), level=documented, method=natif
- westmount : 2026-08-10T10:07:07.648Z (0 mois), level=documented, method=natif
- wotton : 2026-08-10T16:39:18.019Z (0 mois), level=documented, method=natif
- armagh : 2026-07-26T01:59:23.117Z (1 mois), level=documented, method=natif
- auclair : 2026-07-26T13:42:40.550Z (1 mois), level=documented, method=natif
- ayers-cliff : 2026-07-28T04:05:03.508Z (1 mois), level=documented, method=natif
- baie-des-sables : 2026-07-26T10:45:28.882Z (1 mois), level=documented, method=natif
- barnston-ouest : 2026-07-26T06:40:38.500Z (1 mois), level=documented, method=natif
- boisbriand : 2026-07-28T04:05:10.079Z (1 mois), level=documented, method=natif
- chambly : 2026-07-26T07:25:33.265Z (1 mois), level=documented, method=natif
- cloridorme : 2026-07-28T15:10:13.804Z (1 mois), level=documented, method=natif
- coaticook : 2026-07-26T06:43:51.075Z (1 mois), level=documented, method=natif
- deux-montagnes : 2026-07-26T12:21:54.796Z (1 mois), level=documented, method=natif
- disraeli--les-appalaches : 2026-07-26T10:38:53.278Z (1 mois), level=documented, method=natif
- franklin : 2026-07-26T10:37:13.874Z (1 mois), level=documented, method=natif
- godbout : 2026-07-26T10:38:08.640Z (1 mois), level=documented, method=natif
- grand-metis : 2026-07-26T10:44:01.172Z (1 mois), level=documented, method=natif
- ham-sud : 2026-07-26T10:39:47.283Z (1 mois), level=documented, method=natif
- honfleur : 2026-07-26T01:59:42.640Z (1 mois), level=documented, method=natif
- hope : 2026-07-28T15:10:18.849Z (1 mois), level=documented, method=natif
- la-durantaye : 2026-07-26T01:59:56.284Z (1 mois), level=documented, method=natif
- la-prairie : 2026-07-25T19:42:05.768Z (1 mois), level=documented, method=natif
- lac-saint-joseph : 2026-07-26T11:15:37.150Z (1 mois), level=documented, method=natif
- levis : 2026-07-28T15:10:01.218Z (1 mois), level=documented, method=natif
- lislet : 2026-07-26T10:46:12.699Z (1 mois), level=documented, method=natif
- metis-sur-mer : 2026-07-26T11:16:23.487Z (1 mois), level=documented, method=natif
- mont-saint-hilaire : 2026-07-26T06:20:19.091Z (1 mois), level=documented, method=natif
- mont-tremblant : 2026-07-26T13:44:34.897Z (1 mois), level=documented, method=natif
- nantes : 2026-07-26T12:22:56.288Z (1 mois), level=documented, method=natif
- notre-dame-auxiliatrice-de-buckland : 2026-07-26T02:00:08.700Z (1 mois), level=documented, method=natif
- notre-dame-du-rosaire : 2026-07-26T11:17:42.587Z (1 mois), level=documented, method=natif
- ormstown : 2026-07-26T10:03:16.866Z (1 mois), level=documented, method=natif
- saint-antoine-sur-richelieu : 2026-07-25T19:42:50.930Z (1 mois), level=documented, method=natif
- saint-charles-de-bellechasse : 2026-07-26T01:07:01.165Z (1 mois), level=documented, method=natif
- saint-damien-de-buckland : 2026-07-26T02:07:55.222Z (1 mois), level=documented, method=natif
- saint-eustache : 2026-07-28T15:09:59.211Z (1 mois), level=documented, method=natif
- saint-francois-de-la-riviere-du-sud : 2026-07-26T11:18:58.613Z (1 mois), level=documented, method=natif
- saint-frederic : 2026-07-26T07:42:01.109Z (1 mois), level=documented, method=natif
- saint-gervais : 2026-07-26T01:07:23.802Z (1 mois), level=documented, method=natif
- saint-gilles : 2026-07-26T13:43:37.693Z (1 mois), level=documented, method=natif
- saint-godefroi : 2026-07-28T15:10:16.593Z (1 mois), level=documented, method=natif
- saint-jean-baptiste : 2026-07-26T10:05:02.283Z (1 mois), level=documented, method=natif
- saint-lazare-de-bellechasse : 2026-07-26T02:08:10.763Z (1 mois), level=documented, method=natif
- saint-leon-de-standon : 2026-07-26T02:08:28.669Z (1 mois), level=documented, method=natif
- saint-mathieu-de-beloeil : 2026-07-26T10:05:54.495Z (1 mois), level=documented, method=natif
- saint-odilon-de-cranbourne : 2026-07-26T11:19:53.323Z (1 mois), level=documented, method=natif
- saint-paul-de-montminy : 2026-07-26T11:20:49.581Z (1 mois), level=documented, method=natif
- saint-philemon : 2026-07-26T01:07:42.781Z (1 mois), level=documented, method=natif
- saint-raphael : 2026-07-26T06:21:31.913Z (1 mois), level=documented, method=natif
- saint-robert-bellarmin : 2026-07-26T13:47:14.833Z (1 mois), level=documented, method=natif
- saint-sauveur : 2026-07-26T12:16:31.440Z (1 mois), level=documented, method=natif
- saint-sylvere : 2026-07-26T13:47:53.739Z (1 mois), level=documented, method=natif
- saint-victor : 2026-07-26T10:06:43.817Z (1 mois), level=documented, method=natif
- sainte-adele : 2026-07-26T12:17:23.831Z (1 mois), level=documented, method=natif
- sainte-anne-de-beaupre : 2026-07-25T19:43:03.261Z (1 mois), level=documented, method=natif
- sainte-catherine : 2026-07-26T10:07:36.341Z (1 mois), level=documented, method=natif
- sainte-clotilde : 2026-07-26T12:20:10.144Z (1 mois), level=documented, method=natif
- sayabec : 2026-07-26T12:21:01.203Z (1 mois), level=documented, method=natif
- shigawake : 2026-07-28T15:10:15.604Z (1 mois), level=documented, method=natif
- val-alain : 2026-07-26T13:48:41.270Z (1 mois), level=documented, method=natif
- varennes : 2026-07-26T10:04:09.686Z (1 mois), level=documented, method=natif
- victoriaville : 2026-07-28T15:10:04.111Z (1 mois), level=documented, method=natif

## Worklist re-source pré-scopée (OWNER-GATED — pas maintenant)

STALE + SOURCE-GAP = 510 candidats. Tri : STALE le plus vieux d'abord,
puis SOURCE-GAP par provenance la moins prouvée. **Impact lot-count = externe.**
Top 40 :

1. mont-tremblant — source-perime-suspect (retrieved_at=2026-07-26T13:44:34.897Z, 1 mois), level=documented, marqueur="Ancien"
2. les-cedres — source-gap, level=∅
3. amos — source-gap, level=orphan
4. brownsburg-chatham — source-gap, level=orphan
5. cap-sante — source-gap, level=orphan
6. charlemagne — source-gap, level=orphan
7. chateau-richer — source-gap, level=orphan
8. compton — source-gap, level=orphan
9. cote-saint-luc — source-gap, level=orphan
10. denholm — source-gap, level=orphan
11. deschambault-grondines — source-gap, level=orphan
12. dixville — source-gap, level=orphan
13. donnacona — source-gap, level=orphan
14. dorval — source-gap, level=orphan
15. east-hereford — source-gap, level=orphan
16. frampton — source-gap, level=orphan
17. grenville — source-gap, level=orphan
18. grenville-sur-la-rouge — source-gap, level=orphan
19. harrington — source-gap, level=orphan
20. hatley-township-municipality — source-gap, level=orphan
21. l-assomption — source-gap, level=orphan
22. l-epiphanie — source-gap, level=orphan
23. la-presentation — source-gap, level=orphan
24. lac-tremblant-nord — source-gap, level=orphan
25. lachute — source-gap, level=orphan
26. lepiphanie — source-gap, level=orphan
27. les-escoumins — source-gap, level=orphan
28. martinville — source-gap, level=orphan
29. peribonka — source-gap, level=orphan
30. pont-rouge — source-gap, level=orphan
31. portneuf — source-gap, level=orphan
32. riviere-a-pierre — source-gap, level=orphan
33. roxton-falls — source-gap, level=orphan
34. saint-alban — source-gap, level=orphan
35. saint-andre-dargenteuil — source-gap, level=orphan
36. saint-aubert — source-gap, level=orphan
37. saint-barnabe-sud — source-gap, level=orphan
38. saint-basile — source-gap, level=orphan
39. saint-bernard-de-michaudville — source-gap, level=orphan
40. saint-damien — source-gap, level=orphan


_(+ 470 autres — voir le JSON.)_

Liste complète : `work/coverage/zones-sig-freshness-inventory-20260830.json` → `resource_worklist_prescoped.items`.

## Erreurs de lecture

aucune.
