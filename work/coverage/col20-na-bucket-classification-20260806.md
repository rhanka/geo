# Col-20 — classification N-A / incomplete par ville (2026-08-06)

## Méthode

Source : manifest GT v2 committé dans `c9889944` —
`work/coverage/zoning-events-col20-167-s3gt-v2-20260803.audit/gt-v2/_manifest.json`

Règle de classification :
- **Bucket A → `na_proven`** : `perCity.<slug>.events = 0` dans le manifest S3.  
  Preuve directe : radar-immobilier a exporté le graphe de ce muni et a trouvé 0 `DesignationEvent`.  
  Pas d'invention — le fichier ndjson S3 existe et est vide.
- **Bucket B → `incomplete`** : `events > 0`, `geo_events = 0`.  
  Vrai trou geo : immo connaît des rezoning densifiants, geo n'en a pas capturé. PAS N-A.
- **Bucket C → `complete`** : `events > 0`, `geo_events > 0`, recall ≥ 100 %.  
  Actuellement 1 seule ville (saint-eustache).
- **`measured-incomplete`** : recall mesuré mais < 100 % (saint-mathieu-de-beloeil 66,7 %).  
  Compté dans `incomplete` pour la matrice palier.
- **`gap`** : fichier S3 absent (`ABSENT_S3`) — hors dénominateur.

## Comptes

| Bucket | N |
| --- | ---: |
| `complete` | 1 |
| `na_proven` total | 37 |
| — dont antérieurs (attestation docs) | 7 |
| — dont **nouveaux bucket A** (GT vide S3) | **30** |
| `incomplete` | 125 |
| — dont bucket B pur (geo=0, immo>0) | 124 |
| — dont measured-66pct | 1 |
| `gap` (hors dénominateur) | 4 |
| **Total** | **167** |

## Levier col-20

**30 nouveaux N-A prouvés** — chaque muni avait `events=0` dans le GT S3 v2.
Cellule col-20 résolue légitimement sans aucune émission geo nécessaire.

Total na_proven : 7 (antérieurs) + 30 (nouveaux) = **37 cellules col-20 résolues**.

## N-A prouvés ANTÉRIEURS (7)

| # | Muni | Preuve |
| ---: | --- | --- |
| 1 | montreal-ouest | attestation OPTIONA_NA_FINAL.txt |
| 2 | senneville | attestation OPTIONA_NA_FINAL.txt |
| 3 | vercheres | attestation OPTIONA_NA_FINAL.txt |
| 4 | terrasse-vaudreuil | attestation OPTIONA_NA_FINAL.txt |
| 5 | saint-charles-sur-richelieu | attestation OPTIONA_NA_FINAL.txt |
| 6 | saint-chrysostome | attestation OPTIONA_NA_FINAL.txt |
| 7 | franklin | attestation OPTIONA_NA_FINAL.txt |

## N-A prouvés NOUVEAUX — bucket A (30)

Preuve commune : `gt-v2/_manifest.json` committé, `perCity.<slug>.events = 0`.

| # | Muni | immo_events (GT S3) |
| ---: | --- | ---: |
| 1 | saint-lambert | 0 |
| 2 | saint-isidore--roussillon | 0 |
| 3 | terrebonne | 0 |
| 4 | notre-dame-de-lile-perrot | 0 |
| 5 | saint-edouard | 0 |
| 6 | beauharnois | 0 |
| 7 | lile-cadieux | 0 |
| 8 | napierville | 0 |
| 9 | mont-saint-gregoire | 0 |
| 10 | sainte-madeleine | 0 |
| 11 | saint-cyprien-de-napierville | 0 |
| 12 | lepiphanie | 0 |
| 13 | oka | 0 |
| 14 | sainte-marie-madeleine | 0 |
| 15 | saint-etienne-de-beauharnois | 0 |
| 16 | rougemont | 0 |
| 17 | saint-roch-ouest | 0 |
| 18 | saint-sulpice | 0 |
| 19 | sainte-anne-de-sabrevois | 0 |
| 20 | saint-antoine-sur-richelieu | 0 |
| 21 | tres-saint-sacrement | 0 |
| 22 | la-presentation | 0 |
| 23 | saint-lazare | 0 |
| 24 | saint-bernard-de-lacolle | 0 |
| 25 | lacolle | 0 |
| 26 | saint-clet | 0 |
| 27 | noyan | 0 |
| 28 | saint-barnabe-sud | 0 |
| 29 | saint-liguori | 0 |
| 30 | saint-placide | 0 |

## Incomplete — Bucket B (124 + 1 measured)

Tous ont `geo_events = 0` et `immo_events > 0` (immo a trouvé des rezoning densifiants, geo n'a pas de corpus PV capté). Vrai trou geo — PAS N-A.

| Muni | immo_events | Note |
| --- | ---: | --- |
| westmount | 2 | |
| hampstead | 3 | |
| mont-royal | 5 | |
| cote-saint-luc | 1 | 0 HTTP |
| longueuil | 3 | |
| brossard | 23 | |
| sainte-catherine | 12 | |
| la-prairie | 11 | |
| delson | 12 | |
| candiac | 5 | |
| montreal-est | 4 | |
| boucherville | 5 | |
| dorval | 11 | |
| saint-constant | 14 | 0 HTTP |
| saint-bruno-de-montarville | 10 | |
| carignan | 15 | |
| dollard-des-ormeaux | 2 | |
| pointe-claire | 25 | |
| saint-philippe | 7 | 0 HTTP |
| saint-mathieu | 10 | 0 HTTP |
| chateauguay | 6 | |
| sainte-julie | 5 | |
| saint-basile-le-grand | 3 | |
| chambly | 1 | |
| rosemere | 8 | |
| varennes | 4 | |
| bois-des-filion | 8 | |
| beaconsfield | 13 | 0 HTTP |
| lorraine | 10 | |
| lery | 24 | 0 HTTP |
| mercier | 9 | 0 HTTP |
| charlemagne | 12 | |
| boisbriand | 12 | |
| deux-montagnes | 9 | |
| mcmasterville | 12 | |
| sainte-therese | 4 | |
| saint-mathias-sur-richelieu | 4 | |
| saint-mathieu-de-beloeil | 18 | **measured 66,7 %** — incomplete |
| saint-amable | 13 | |
| saint-remi | 6 | |
| otterburn-park | 7 | |
| saint-jacques-le-mineur | 7 | |
| richelieu | 14 | |
| beloeil | 7 | |
| baie-durfe | 3 | |
| sainte-marthe-sur-le-lac | 11 | 0 HTTP |
| saint-jean-sur-richelieu | 13 | 0 HTTP |
| mascouche | 6 | |
| repentigny | 2 | 0 HTTP |
| sainte-anne-de-bellevue | 1 | |
| saint-michel | 7 | 0 HTTP |
| blainville | 7 | |
| pointe-calumet | 5 | 0 HTTP |
| mont-saint-hilaire | 6 | |
| lile-perrot | 17 | |
| saint-marc-sur-richelieu | 2 | 0 HTTP |
| sainte-martine | 16 | 0 HTTP |
| sainte-anne-des-plaines | 1 | |
| saint-urbain-premier | 8 | 0 HTTP |
| saint-joseph-du-lac | 3 | |
| saint-jean-baptiste | 15 | 0 HTTP |
| pincourt | 7 | |
| calixa-lavallee | 5 | |
| pointe-des-cascades | 7 | |
| vaudreuil-sur-le-lac | 1 | |
| saint-blaise-sur-richelieu | 7 | |
| saint-patrice-de-sherrington | 4 | |
| saint-roch-de-lachigan | 5 | 0 HTTP |
| sainte-angele-de-monnoir | 7 | |
| sainte-clotilde | 13 | 0 HTTP |
| vaudreuil-dorion | 27 | 0 HTTP |
| lassomption | 5 | 0 HTTP |
| howick | 3 | |
| mirabel | 9 | |
| saint-lin-laurentides | 1 | 0 HTTP |
| saint-damase--les-maskoutains | 1 | |
| saint-denis-sur-richelieu | 5 | |
| sainte-brigide-diberville | 2 | 0 HTTP |
| les-cedres | 7 | |
| saint-esprit | 19 | 0 HTTP |
| saint-valentin | 2 | 0 HTTP |
| sainte-sophie | 13 | 0 HTTP |
| hudson | 6 | |
| saint-alexandre | 17 | 0 HTTP |
| hemmingford--les-jardins-de-napierville | 4 | 0 HTTP |
| saint-cesaire | 9 | 0 HTTP |
| saint-paul-de-lile-aux-noix | 2 | 0 HTTP |
| saint-louis-de-gonzague--beauharnois-salaberry | 4 | |
| salaberry-de-valleyfield | 9 | |
| saint-alexis | 3 | |
| sainte-marie-salome | 2 | |
| lavaltrie | 8 | |
| contrecoeur | 9 | |
| henryville | 1 | |
| saint-jerome | 9 | |
| saint-jacques | 1 | 0 HTTP |
| hemmingford--les-jardins-de-napierville--2 | 4 | 0 HTTP |
| saint-colomban | 10 | |
| saint-hyacinthe | 16 | |
| saint-sebastien--le-haut-richelieu | 5 | |
| saint-paul | 16 | |
| saint-pie | 32 | |
| havelock | 3 | 0 HTTP |
| sainte-sabine--brome-missisquoi | 6 | 0 HTTP |
| saint-bernard-de-michaudville | 8 | |
| crabtree | 1 | 0 HTTP |
| coteau-du-lac | 10 | |
| sainte-julienne | 9 | |
| farnham | 2 | 0 HTTP |
| saint-paul-dabbotsford | 4 | |
| saint-roch-de-richelieu | 8 | |
| saint-jude | 2 | |
| ormstown | 5 | 0 HTTP |
| ange-gardien | 5 | 0 HTTP |
| saint-ours | 3 | |
| prevost | 2 | |
| saint-stanislas-de-kostka | 4 | |
| saint-calixte | 4 | |
| saint-pierre | 2 | |
| saint-hippolyte | 30 | |
| venise-en-quebec | 3 | |
| clarenceville | 1 | 0 HTTP |
| joliette | 9 | |
| les-coteaux | 5 | |
| saint-dominique | 6 | |

## Gap acquisition (4 — hors dénominateur)

- lile-dorval
- kirkland
- marieville
- notre-dame-de-stanbridge

---

Handoff : ce fichier est l'artefact col-20 par ville {complete / na_proven / incomplete} à ingérer par la lane qa pour régénérer la matrice palier.
