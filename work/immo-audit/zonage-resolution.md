# Résolution zonage immo ↔ collections geo OGC

Source: `https://api.geo.sent-tech.ca/collections` — 329 collections `qc-zonage-*`, 1102 `qc-lots-*`.
Méthode: (1) match nom (slug/title), (2) calage spatial — centroïde de la ville via `qc-lots-<slug>` puis requête `bbox=` sur les collections `qc-zonage` (60 base ArcGIS + 58 couches), confirmation par échantillon d'attributs au point ville.
Read-only. Aucune ingestion, aucune publication.

## A. Les 14 prioritaires (« cadastrées sans zone »)

| VILLE | statut | collection à puller | note |
|---|---|---|---|
| sainte-catherine | ABSENT | — | seul hit = `martin-lessard0-arcgis` = couche milieux-humides (ZONE='VOIE MARITIME', Marais), pas du zonage |
| **saint-eustache** | **COUVERT** | `qc-zonage-pantaleona-arcgis` | id compte ArcGIS non-mappé; `ZONAGEMUNICIPALID`=grille municipale; 3 polygones au centroïde |
| saint-mathieu-de-beloeil | ABSENT | — | candidat sample `ludyvine-cnmsh` mais 0 feature au point ville |
| alma | ABSENT | — | aucun hit réel |
| saint-charles-borromee | ABSENT | — | aucun hit réel |
| saint-boniface | ABSENT | — | aucun hit réel |
| **coaticook** | **COUVERT** | `qc-zonage-mrcdecoaticook-arcgis` | filtrer `MuniTopo='Ville de Coaticook'`; `ZONE`/`ETIQUETTE`=A-920 |
| la-sarre | ABSENT | — | aucun hit réel |
| **saint-raphael** | **COUVERT** | `qc-zonage-jdube-mrcbellechasse-arcgis` | filtrer `mun_nom='Saint-Raphaël'`; `no_zone`=AF-111 |
| saint-come-liniere | ABSENT | — | aucun hit réel |
| petite-riviere-saint-francois | ABSENT | — | candidat sample `claudialarrotamrccdb` (MRC Charlevoix) mais 0 feature au point |
| champlain | ABSENT | — | aucun hit réel |
| plaisance | ABSENT | — | aucun hit réel |
| notre-dame-de-lourdes--lerable | ABSENT | — | voir §D — la NDL-Joliette existe mais c'est l'AUTRE ville (130 km) |

**Bilan 14 : 3 COUVERTS (quick win, id non-mappé) — saint-eustache, coaticook, saint-raphael ; 11 ABSENTS** (sainte-catherine, saint-mathieu-de-beloeil, alma, saint-charles-borromee, saint-boniface, la-sarre, saint-come-liniere, petite-riviere-saint-francois, champlain, plaisance, notre-dame-de-lourdes--lerable).

## B. z∩m∩p (vérification couverture + couche primaire)

| VILLE | statut | collection à puller (primaire) | note |
|---|---|---|---|
| mont-tremblant | COUVERT | `qc-zonage-mont-tremblant-arcgis` | ANOMALIE: mélange affectation (CODE_AFFEC) + zonage (NUM_ZONE) |
| rimouski | COUVERT | `qc-zonage-rimouski` | grille propre (NO_ZONAGE + URL_GRILLE PDF); écarter affectations-sol/piia/perimetre/aires-contraintes/sites-patrimoine |
| preissac | COUVERT | `qc-zonage-preissac` | zone_code/kind (geopdf) |
| chelsea | COUVERT | `qc-zonage-chelsea` | zone_code/kind (geopdf) |
| saint-amable | COUVERT | `qc-zonage-saint-amable` | zone_code/kind (geopdf) |
| cowansville | COUVERT | `qc-zonage-cowansville` | zone_code/kind (geopdf) |
| saint-gilbert | COUVERT | `qc-zonage-saint-gilbert` | zone_code/kind (shp MRC Portneuf) |
| rosemere | COUVERT | `qc-zonage-rosemere` | zone_code/kind |
| stratford | COUVERT | `qc-zonage-stratford` | zone_code/kind (vision-read) |
| neuville | COUVERT | `qc-zonage-neuville` | zone_code/kind (shp MRC Portneuf) |
| saint-raymond | COUVERT | `qc-zonage-saint-raymond` | zone_code/kind (shp MRC Portneuf) |
| sutton | COUVERT | `qc-zonage-sutton` | zone_code/kind (geopdf) |
| mont-saint-hilaire | COUVERT | `qc-zonage-mont-saint-hilaire` | zone_code/kind (vision-read) |
| saint-stanislas-de-kostka | COUVERT | `qc-zonage-saint-stanislas-de-kostka` | zone_code/kind (geopdf) |
| hemmingford | COUVERT | `qc-zonage-hemmingford--les-jardins-de-napierville--2` | slug 'hemmingford' absent; id réel suffixé `--les-jardins-de-napierville--2` |
| saint-frederic | COUVERT (dégradé) | `qc-zonage-saint-frederic` | ANOMALIE: zones non attribuées individuellement (group-envelope, anti-invention); `codes_inside` présent mais pas de zone_code par polygone |

**Bilan z∩m∩p : 16/16 COUVERTS.** Anomalies à signaler à immo : mont-tremblant (couche mixte affectation+zonage), saint-frederic (qualité dégradée, zones non attribuées), hemmingford (slug non standard), rimouski (beaucoup de couches-bruit cohabitent — pull la collection de base `qc-zonage-rimouski`).

## C. Anomalies de couche (z∩m∩p)
- **mont-tremblant** `-arcgis` : grille mêlée à l'affectation (NOM_AFFECT/CODE_AFFEC).
- **saint-frederic** : `zone_code=null`, enveloppe groupée non attribuée (anti-invention) → faible valeur.
- **rimouski** : ~6 couches bruit (affectations-sol, aires-contraintes, perimetre-urbanisation, piia, sites-patrimoine) sous le même préfixe → puller seulement `qc-zonage-rimouski`.
- **hemmingford** : pas de slug `qc-zonage-hemmingford` ; id réel `qc-zonage-hemmingford--les-jardins-de-napierville--2`.

## D. Cas notre-dame-de-lourdes (Joliette vs l'Érable)
Deux municipalités homonymes en QC. immo demande la NDL de **l'Érable** (Centre-du-Québec) : ses lots `qc-lots-notre-dame-de-lourdes--lerable` ont pour centroïde **-71.80, 46.34**.
geo possède `qc-zonage-notre-dame-de-lourdes--joliette` (centroïde **-73.47, 46.07**, Lanaudière), soit ~130 km plus à l'ouest — c'est l'AUTRE ville.
→ **NDL-l'Érable = ABSENT.** Ne PAS puller la collection `--joliette` pour cette ville (mauvaise municipalité).

## E. Recommandation
**Quick wins immédiats (pull maintenant, juste indiquer l'id non-mappé à immo) :**
- saint-eustache → `qc-zonage-pantaleona-arcgis`
- coaticook → `qc-zonage-mrcdecoaticook-arcgis` (filtrer `MuniTopo='Ville de Coaticook'`)
- saint-raphael → `qc-zonage-jdube-mrcbellechasse-arcgis` (filtrer `mun_nom='Saint-Raphaël'`)
- + les 16 z∩m∩p (déjà mappables par slug, sauf hemmingford dont l'id est suffixé)

**Action côté immo (mapping) :** ajouter une table d'alias slug-ville → collection_id pour les ids comptes-ArcGIS/MRC (pantaleona, mrcdecoaticook, jdube-mrcbellechasse, hemmingford--les-jardins…), et préférer la collection de base propre quand des couches-bruit coexistent (rimouski).

**À acquérir / extraire (vraiment absents, 11) :** sainte-catherine, saint-mathieu-de-beloeil, alma, saint-charles-borromee, saint-boniface, la-sarre, saint-come-liniere, petite-riviere-saint-francois, champlain, plaisance, notre-dame-de-lourdes--lerable.

**Réserves méthodo :** calage par centroïde de 60-80 lots échantillonnés (point « dans la ville »), confirmé par requête `bbox=` réelle + schéma d'attributs. Les titres de collection ArcGIS sont génériques (« Zonage — <compte> »), donc l'identité municipale des 3 quick wins repose sur le chevauchement spatial + le schéma de zonage, pas sur un nom de ville explicite (confidence: saint-eustache=medium, coaticook/saint-raphael=high car champ municipalité présent dans les features). La collection `qc-zonage-a-mercier-mrchsf-arcgis` est un polygone provincial « ZONAGE NON DISPONIBLE » (faux positif spatial, exclu).
