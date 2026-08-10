# Colonne-20 — recall directionnel immo→geo (GT S3, 2026-08-03)

## Résumé

- GT : s3://radar-immobilier-docs-pocs/gt/designation-events-167-20260803/
- Manifeste vérifié : 12160 octets, SHA-256 `b9664a9e9d904dcf8694bd85b76d73219254d2262c08c21cdbc2ed7993c39eee`.
- Agrégat directionnel sur les 126 munis avec GT : 0/1018 (0 %).
- Statuts : 2 measured · 124 no_geo_events · 41 gap_acquisition.
- `sourceRef` est `null` pour 1 018/1 018 GT : le mapping n’utilise ni `props.refs` ni `props.properties` comme repli. Chaque event est `identity_unmappable`, donc missed. Le crosswalk gelé reste appliqué au type (`category`, sinon `etapeAnnote`).

## Mapping GT → clé

`(muni, source_url_norm, date_iso, type-crosswalké)` = `citySlug`, `sourceRef.url`, `sourceRef.date`, puis `category` (sinon `etapeAnnote`). Ici URL/date sont nulles par construction de la GT, sans fabrication de match.

| Rang | Muni | Statut | Immo | Geo | Matched | Recall | Note |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | westmount | no_geo_events | 2 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 2 | saint-lambert | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 3 | hampstead | no_geo_events | 3 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 4 | mont-royal | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 5 | montreal-ouest | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 6 | cote-saint-luc | no_geo_events | 1 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 7 | longueuil | no_geo_events | 3 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 8 | brossard | no_geo_events | 23 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 9 | sainte-catherine | no_geo_events | 12 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 10 | la-prairie | no_geo_events | 11 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 11 | delson | no_geo_events | 12 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 12 | candiac | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 13 | montreal-est | no_geo_events | 4 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 14 | boucherville | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 15 | dorval | no_geo_events | 11 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 16 | lile-dorval | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 17 | saint-constant | no_geo_events | 14 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 18 | saint-bruno-de-montarville | no_geo_events | 10 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 19 | carignan | no_geo_events | 15 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 20 | dollard-des-ormeaux | no_geo_events | 2 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 21 | pointe-claire | no_geo_events | 25 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 22 | saint-philippe | no_geo_events | 7 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 23 | saint-mathieu | no_geo_events | 10 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 24 | chateauguay | no_geo_events | 6 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 25 | sainte-julie | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 26 | saint-basile-le-grand | no_geo_events | 3 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 27 | chambly | no_geo_events | 1 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 28 | rosemere | no_geo_events | 8 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 29 | varennes | no_geo_events | 4 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 30 | kirkland | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 31 | bois-des-filion | no_geo_events | 8 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 32 | saint-isidore--roussillon | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 33 | beaconsfield | no_geo_events | 13 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 34 | lorraine | no_geo_events | 10 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 35 | lery | no_geo_events | 24 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 36 | mercier | no_geo_events | 9 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 37 | charlemagne | no_geo_events | 12 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 38 | boisbriand | no_geo_events | 12 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 39 | deux-montagnes | no_geo_events | 9 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 40 | mcmasterville | no_geo_events | 12 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 41 | sainte-therese | no_geo_events | 4 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 42 | saint-mathias-sur-richelieu | no_geo_events | 4 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 43 | saint-mathieu-de-beloeil | measured | 18 | 37 | 0 | 0 % | identity_unmappable : sourceRef=null; URL/date non fabriquées; tous les GT restent missed. |
| 44 | saint-amable | no_geo_events | 13 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 45 | terrebonne | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 46 | saint-remi | no_geo_events | 6 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 47 | otterburn-park | no_geo_events | 7 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 48 | saint-jacques-le-mineur | no_geo_events | 7 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 49 | richelieu | no_geo_events | 14 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 50 | beloeil | no_geo_events | 7 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 51 | baie-durfe | no_geo_events | 3 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 52 | sainte-marthe-sur-le-lac | no_geo_events | 11 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 53 | saint-jean-sur-richelieu | no_geo_events | 13 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 54 | mascouche | no_geo_events | 6 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 55 | saint-eustache | measured | 50 | 377 | 0 | 0 % | identity_unmappable : sourceRef=null; URL/date non fabriquées; tous les GT restent missed. |
| 56 | notre-dame-de-lile-perrot | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 57 | repentigny | no_geo_events | 2 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 58 | saint-edouard | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 59 | sainte-anne-de-bellevue | no_geo_events | 1 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 60 | saint-michel | no_geo_events | 7 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 61 | blainville | no_geo_events | 7 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 62 | pointe-calumet | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 63 | mont-saint-hilaire | no_geo_events | 6 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 64 | senneville | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 65 | marieville | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 66 | lile-perrot | no_geo_events | 17 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 67 | vercheres | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 68 | saint-marc-sur-richelieu | no_geo_events | 2 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 69 | sainte-martine | no_geo_events | 16 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 70 | beauharnois | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 71 | sainte-anne-des-plaines | no_geo_events | 1 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 72 | saint-urbain-premier | no_geo_events | 8 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 73 | terrasse-vaudreuil | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 74 | saint-joseph-du-lac | no_geo_events | 3 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 75 | saint-jean-baptiste | no_geo_events | 15 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 76 | pincourt | no_geo_events | 7 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 77 | calixa-lavallee | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 78 | lile-cadieux | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 79 | pointe-des-cascades | no_geo_events | 7 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 80 | saint-charles-sur-richelieu | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 81 | napierville | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 82 | vaudreuil-sur-le-lac | no_geo_events | 1 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 83 | saint-blaise-sur-richelieu | no_geo_events | 7 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 84 | mont-saint-gregoire | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 85 | sainte-madeleine | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 86 | saint-cyprien-de-napierville | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 87 | saint-patrice-de-sherrington | no_geo_events | 4 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 88 | saint-roch-de-lachigan | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 89 | sainte-angele-de-monnoir | no_geo_events | 7 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 90 | lepiphanie | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 91 | oka | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 92 | sainte-marie-madeleine | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 93 | saint-etienne-de-beauharnois | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 94 | sainte-clotilde | no_geo_events | 13 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 95 | vaudreuil-dorion | no_geo_events | 27 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 96 | rougemont | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 97 | saint-roch-ouest | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 98 | saint-sulpice | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 99 | lassomption | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 100 | howick | no_geo_events | 3 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 101 | mirabel | no_geo_events | 9 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 102 | sainte-anne-de-sabrevois | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 103 | saint-lin-laurentides | no_geo_events | 1 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 104 | saint-damase--les-maskoutains | no_geo_events | 1 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 105 | saint-antoine-sur-richelieu | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 106 | saint-denis-sur-richelieu | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 107 | tres-saint-sacrement | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 108 | la-presentation | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 109 | sainte-brigide-diberville | no_geo_events | 2 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 110 | les-cedres | no_geo_events | 7 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 111 | saint-esprit | no_geo_events | 19 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 112 | saint-valentin | no_geo_events | 2 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 113 | sainte-sophie | no_geo_events | 13 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 114 | hudson | no_geo_events | 6 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 115 | saint-alexandre | no_geo_events | 17 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 116 | saint-chrysostome | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 117 | hemmingford--les-jardins-de-napierville | no_geo_events | 4 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 118 | saint-cesaire | no_geo_events | 9 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 119 | saint-paul-de-lile-aux-noix | no_geo_events | 2 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 120 | saint-louis-de-gonzague--beauharnois-salaberry | no_geo_events | 4 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 121 | salaberry-de-valleyfield | no_geo_events | 9 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 122 | saint-lazare | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 123 | saint-bernard-de-lacolle | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 124 | saint-alexis | no_geo_events | 3 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 125 | sainte-marie-salome | no_geo_events | 2 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 126 | lavaltrie | no_geo_events | 8 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 127 | contrecoeur | no_geo_events | 9 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 128 | henryville | no_geo_events | 1 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 129 | saint-jerome | no_geo_events | 9 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 130 | saint-placide | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 131 | saint-jacques | no_geo_events | 1 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 132 | hemmingford--les-jardins-de-napierville--2 | no_geo_events | 4 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 133 | saint-colomban | no_geo_events | 10 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 134 | saint-hyacinthe | no_geo_events | 16 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 135 | lacolle | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 136 | saint-sebastien--le-haut-richelieu | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 137 | saint-paul | no_geo_events | 16 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 138 | saint-pie | no_geo_events | 32 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 139 | havelock | no_geo_events | 3 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 140 | sainte-sabine--brome-missisquoi | no_geo_events | 6 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 141 | saint-bernard-de-michaudville | no_geo_events | 8 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 142 | crabtree | no_geo_events | 1 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 143 | coteau-du-lac | no_geo_events | 10 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 144 | sainte-julienne | no_geo_events | 9 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 145 | farnham | no_geo_events | 2 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 146 | saint-paul-dabbotsford | no_geo_events | 4 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 147 | saint-clet | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 148 | saint-roch-de-richelieu | no_geo_events | 8 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 149 | saint-jude | no_geo_events | 2 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 150 | noyan | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 151 | ormstown | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 152 | ange-gardien | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 153 | saint-ours | no_geo_events | 3 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 154 | prevost | no_geo_events | 2 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 155 | saint-stanislas-de-kostka | no_geo_events | 4 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 156 | saint-calixte | no_geo_events | 4 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 157 | saint-barnabe-sud | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 158 | notre-dame-de-stanbridge | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 159 | franklin | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 160 | saint-pierre | no_geo_events | 2 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 161 | saint-liguori | gap_acquisition | — | 0 | — | — | UNKNOWN honnête : fichier GT S3 absent (manifest events=0), hors dénominateur; jamais N-A. |
| 162 | saint-hippolyte | no_geo_events | 30 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 163 | venise-en-quebec | no_geo_events | 3 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 164 | clarenceville | no_geo_events | 1 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 165 | joliette | no_geo_events | 9 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 166 | les-coteaux | no_geo_events | 5 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |
| 167 | saint-dominique | no_geo_events | 6 | 0 | 0 | 0 % | incomplete/pending : aucune émission geo dans l’entrée dry-run locale; GT comptée au dénominateur. |

Audit événement-par-événement : `work/coverage/zoning-events-col20-167-s3gt-20260803.audit/gt-source-fields-verbatim.ndjson`; exécution du harnais gelé : `recall-gate.json`.
