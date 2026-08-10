# Colonne-20 — recall directionnel immo→geo (GT S3 v2, 2026-08-03)

## Résumé

- GT v2 : s3://radar-immobilier-docs-pocs/gt/designation-events-167-v2-20260803/
- Manifeste vérifié : 17385 octets, SHA-256 `da26a196b74d50f8109b447ca0377e9e8d146b2caf69ebc3832c25e948f15e1b`.
- Agrégat directionnel sur les munis measured : 62/68 (91.2 %).
- Statuts : 2 measured · 154 no_geo_events · 7 na_proven · 4 gap_acquisition.
- 332/1018 GT sans source_url HTTP sont des missed honnêtes, non matchables par URL.
- Option A owner : la précision symétrique est retirée du gate; seul le recall directionnel immo→geo est rapporté.
- Saint-Mathieu : slugs distincts, non fusionnés — `saint-mathieu` = 10 GT; `saint-mathieu-de-beloeil` = 18 GT, 12 matched.

| Rang | Muni | Statut | Immo | Geo | Matched | Recall | URL HTTP | Note |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | westmount | no_geo_events | 2 | 0 | 0 | 0.0 % | 2 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 2 | saint-lambert | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 3 | hampstead | no_geo_events | 3 | 0 | 0 | 0.0 % | 3 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 4 | mont-royal | no_geo_events | 5 | 0 | 0 | 0.0 % | 5 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 5 | montreal-ouest | na_proven | 0 | 0 | 0 | — | 0 | N-A prouvé : PV parsés, date_scrape=2026-06-11, 0 DesignationEvent prod densifiant; attestation docs/reports/recette/OPTIONA_NA_FINAL.txt, message conducteur env-cond-geojoint-7na-confirmed. |
| 6 | cote-saint-luc | no_geo_events | 1 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 1 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 7 | longueuil | no_geo_events | 3 | 0 | 0 | 0.0 % | 3 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 8 | brossard | no_geo_events | 23 | 0 | 0 | 0.0 % | 23 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 9 | sainte-catherine | no_geo_events | 12 | 0 | 0 | 0.0 % | 11 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 1 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 10 | la-prairie | no_geo_events | 11 | 0 | 0 | 0.0 % | 11 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 11 | delson | no_geo_events | 12 | 0 | 0 | 0.0 % | 12 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 12 | candiac | no_geo_events | 5 | 0 | 0 | 0.0 % | 5 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 13 | montreal-est | no_geo_events | 4 | 0 | 0 | 0.0 % | 4 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 14 | boucherville | no_geo_events | 5 | 0 | 0 | 0.0 % | 4 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 1 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 15 | dorval | no_geo_events | 11 | 0 | 0 | 0.0 % | 11 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 16 | lile-dorval | gap_acquisition | — | 0 | — | — | — | UNKNOWN honnête : fichier GT v2 S3 absent, hors dénominateur; jamais N-A. |
| 17 | saint-constant | no_geo_events | 14 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 14 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 18 | saint-bruno-de-montarville | no_geo_events | 10 | 0 | 0 | 0.0 % | 10 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 19 | carignan | no_geo_events | 15 | 0 | 0 | 0.0 % | 15 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 20 | dollard-des-ormeaux | no_geo_events | 2 | 0 | 0 | 0.0 % | 2 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 21 | pointe-claire | no_geo_events | 25 | 0 | 0 | 0.0 % | 25 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 22 | saint-philippe | no_geo_events | 7 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 7 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 23 | saint-mathieu | no_geo_events | 10 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 10 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 24 | chateauguay | no_geo_events | 6 | 0 | 0 | 0.0 % | 6 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 25 | sainte-julie | no_geo_events | 5 | 0 | 0 | 0.0 % | 5 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 26 | saint-basile-le-grand | no_geo_events | 3 | 0 | 0 | 0.0 % | 3 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 27 | chambly | no_geo_events | 1 | 0 | 0 | 0.0 % | 1 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 28 | rosemere | no_geo_events | 8 | 0 | 0 | 0.0 % | 8 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 29 | varennes | no_geo_events | 4 | 0 | 0 | 0.0 % | 4 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 30 | kirkland | gap_acquisition | — | 0 | — | — | — | UNKNOWN honnête : fichier GT v2 S3 absent, hors dénominateur; jamais N-A. |
| 31 | bois-des-filion | no_geo_events | 8 | 0 | 0 | 0.0 % | 8 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 32 | saint-isidore--roussillon | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 33 | beaconsfield | no_geo_events | 13 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 13 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 34 | lorraine | no_geo_events | 10 | 0 | 0 | 0.0 % | 10 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 35 | lery | no_geo_events | 24 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 24 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 36 | mercier | no_geo_events | 9 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 9 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 37 | charlemagne | no_geo_events | 12 | 0 | 0 | 0.0 % | 11 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 1 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 38 | boisbriand | no_geo_events | 12 | 0 | 0 | 0.0 % | 12 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 39 | deux-montagnes | no_geo_events | 9 | 0 | 0 | 0.0 % | 9 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 40 | mcmasterville | no_geo_events | 12 | 0 | 0 | 0.0 % | 12 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 41 | sainte-therese | no_geo_events | 4 | 0 | 0 | 0.0 % | 4 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 42 | saint-mathias-sur-richelieu | no_geo_events | 4 | 0 | 0 | 0.0 % | 4 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 43 | saint-mathieu-de-beloeil | measured | 18 | 37 | 12 | 66.7 % | 18 | Mesure directionnelle immo→geo par multiset min-based sur la clé URL/date/type gelée. |
| 44 | saint-amable | no_geo_events | 13 | 0 | 0 | 0.0 % | 13 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 45 | terrebonne | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 46 | saint-remi | no_geo_events | 6 | 0 | 0 | 0.0 % | 4 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 2 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 47 | otterburn-park | no_geo_events | 7 | 0 | 0 | 0.0 % | 7 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 48 | saint-jacques-le-mineur | no_geo_events | 7 | 0 | 0 | 0.0 % | 7 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 49 | richelieu | no_geo_events | 14 | 0 | 0 | 0.0 % | 14 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 50 | beloeil | no_geo_events | 7 | 0 | 0 | 0.0 % | 7 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 51 | baie-durfe | no_geo_events | 3 | 0 | 0 | 0.0 % | 3 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 52 | sainte-marthe-sur-le-lac | no_geo_events | 11 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 11 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 53 | saint-jean-sur-richelieu | no_geo_events | 13 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 13 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 54 | mascouche | no_geo_events | 6 | 0 | 0 | 0.0 % | 4 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 2 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 55 | saint-eustache | measured | 50 | 377 | 50 | 100.0 % | 50 | Mesure directionnelle immo→geo par multiset min-based sur la clé URL/date/type gelée. |
| 56 | notre-dame-de-lile-perrot | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 57 | repentigny | no_geo_events | 2 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 2 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 58 | saint-edouard | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 59 | sainte-anne-de-bellevue | no_geo_events | 1 | 0 | 0 | 0.0 % | 1 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 60 | saint-michel | no_geo_events | 7 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 7 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 61 | blainville | no_geo_events | 7 | 0 | 0 | 0.0 % | 7 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 62 | pointe-calumet | no_geo_events | 5 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 5 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 63 | mont-saint-hilaire | no_geo_events | 6 | 0 | 0 | 0.0 % | 6 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 64 | senneville | na_proven | 0 | 0 | 0 | — | 0 | N-A prouvé : PV parsés, date_scrape=2026-06-11, 0 DesignationEvent prod densifiant; attestation docs/reports/recette/OPTIONA_NA_FINAL.txt, message conducteur env-cond-geojoint-7na-confirmed. |
| 65 | marieville | gap_acquisition | — | 0 | — | — | — | UNKNOWN honnête : fichier GT v2 S3 absent, hors dénominateur; jamais N-A. |
| 66 | lile-perrot | no_geo_events | 17 | 0 | 0 | 0.0 % | 17 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 67 | vercheres | na_proven | 0 | 0 | 0 | — | 0 | N-A prouvé : PV parsés, date_scrape=2026-06-11, 0 DesignationEvent prod densifiant; attestation docs/reports/recette/OPTIONA_NA_FINAL.txt, message conducteur env-cond-geojoint-7na-confirmed. |
| 68 | saint-marc-sur-richelieu | no_geo_events | 2 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 2 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 69 | sainte-martine | no_geo_events | 16 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 16 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 70 | beauharnois | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 71 | sainte-anne-des-plaines | no_geo_events | 1 | 0 | 0 | 0.0 % | 1 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 72 | saint-urbain-premier | no_geo_events | 8 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 8 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 73 | terrasse-vaudreuil | na_proven | 0 | 0 | 0 | — | 0 | N-A prouvé : PV parsés, date_scrape=2026-06-12, 0 DesignationEvent prod densifiant; attestation docs/reports/recette/OPTIONA_NA_FINAL.txt, message conducteur env-cond-geojoint-7na-confirmed. |
| 74 | saint-joseph-du-lac | no_geo_events | 3 | 0 | 0 | 0.0 % | 3 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 75 | saint-jean-baptiste | no_geo_events | 15 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 15 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 76 | pincourt | no_geo_events | 7 | 0 | 0 | 0.0 % | 6 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 1 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 77 | calixa-lavallee | no_geo_events | 5 | 0 | 0 | 0.0 % | 5 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 78 | lile-cadieux | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 79 | pointe-des-cascades | no_geo_events | 7 | 0 | 0 | 0.0 % | 7 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 80 | saint-charles-sur-richelieu | na_proven | 0 | 0 | 0 | — | 0 | N-A prouvé : PV parsés, date_scrape=2026-06-12, 0 DesignationEvent prod densifiant; attestation docs/reports/recette/OPTIONA_NA_FINAL.txt, message conducteur env-cond-geojoint-7na-confirmed. |
| 81 | napierville | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 82 | vaudreuil-sur-le-lac | no_geo_events | 1 | 0 | 0 | 0.0 % | 1 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 83 | saint-blaise-sur-richelieu | no_geo_events | 7 | 0 | 0 | 0.0 % | 7 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 84 | mont-saint-gregoire | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 85 | sainte-madeleine | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 86 | saint-cyprien-de-napierville | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 87 | saint-patrice-de-sherrington | no_geo_events | 4 | 0 | 0 | 0.0 % | 4 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 88 | saint-roch-de-lachigan | no_geo_events | 5 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 5 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 89 | sainte-angele-de-monnoir | no_geo_events | 7 | 0 | 0 | 0.0 % | 7 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 90 | lepiphanie | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 91 | oka | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 92 | sainte-marie-madeleine | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 93 | saint-etienne-de-beauharnois | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 94 | sainte-clotilde | no_geo_events | 13 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 13 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 95 | vaudreuil-dorion | no_geo_events | 27 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 27 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 96 | rougemont | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 97 | saint-roch-ouest | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 98 | saint-sulpice | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 99 | lassomption | no_geo_events | 5 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 5 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 100 | howick | no_geo_events | 3 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 3 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 101 | mirabel | no_geo_events | 9 | 0 | 0 | 0.0 % | 8 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 1 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 102 | sainte-anne-de-sabrevois | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 103 | saint-lin-laurentides | no_geo_events | 1 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 1 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 104 | saint-damase--les-maskoutains | no_geo_events | 1 | 0 | 0 | 0.0 % | 1 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 105 | saint-antoine-sur-richelieu | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 106 | saint-denis-sur-richelieu | no_geo_events | 5 | 0 | 0 | 0.0 % | 5 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 107 | tres-saint-sacrement | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 108 | la-presentation | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 109 | sainte-brigide-diberville | no_geo_events | 2 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 2 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 110 | les-cedres | no_geo_events | 7 | 0 | 0 | 0.0 % | 7 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 111 | saint-esprit | no_geo_events | 19 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 19 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 112 | saint-valentin | no_geo_events | 2 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 2 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 113 | sainte-sophie | no_geo_events | 13 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 13 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 114 | hudson | no_geo_events | 6 | 0 | 0 | 0.0 % | 6 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 115 | saint-alexandre | no_geo_events | 17 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 17 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 116 | saint-chrysostome | na_proven | 0 | 0 | 0 | — | 0 | N-A prouvé : PV parsés, date_scrape=2026-06-12, 0 DesignationEvent prod densifiant; attestation docs/reports/recette/OPTIONA_NA_FINAL.txt, message conducteur env-cond-geojoint-7na-confirmed. |
| 117 | hemmingford--les-jardins-de-napierville | no_geo_events | 4 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 4 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 118 | saint-cesaire | no_geo_events | 9 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 9 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 119 | saint-paul-de-lile-aux-noix | no_geo_events | 2 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 2 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 120 | saint-louis-de-gonzague--beauharnois-salaberry | no_geo_events | 4 | 0 | 0 | 0.0 % | 4 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 121 | salaberry-de-valleyfield | no_geo_events | 9 | 0 | 0 | 0.0 % | 9 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 122 | saint-lazare | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 123 | saint-bernard-de-lacolle | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 124 | saint-alexis | no_geo_events | 3 | 0 | 0 | 0.0 % | 3 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 125 | sainte-marie-salome | no_geo_events | 2 | 0 | 0 | 0.0 % | 1 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 1 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 126 | lavaltrie | no_geo_events | 8 | 0 | 0 | 0.0 % | 8 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 127 | contrecoeur | no_geo_events | 9 | 0 | 0 | 0.0 % | 9 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 128 | henryville | no_geo_events | 1 | 0 | 0 | 0.0 % | 1 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 129 | saint-jerome | no_geo_events | 9 | 0 | 0 | 0.0 % | 9 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 130 | saint-placide | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 131 | saint-jacques | no_geo_events | 1 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 1 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 132 | hemmingford--les-jardins-de-napierville--2 | no_geo_events | 4 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 4 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 133 | saint-colomban | no_geo_events | 10 | 0 | 0 | 0.0 % | 5 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 5 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 134 | saint-hyacinthe | no_geo_events | 16 | 0 | 0 | 0.0 % | 16 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 135 | lacolle | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 136 | saint-sebastien--le-haut-richelieu | no_geo_events | 5 | 0 | 0 | 0.0 % | 5 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 137 | saint-paul | no_geo_events | 16 | 0 | 0 | 0.0 % | 16 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 138 | saint-pie | no_geo_events | 32 | 0 | 0 | 0.0 % | 22 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 10 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 139 | havelock | no_geo_events | 3 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 3 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 140 | sainte-sabine--brome-missisquoi | no_geo_events | 6 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 6 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 141 | saint-bernard-de-michaudville | no_geo_events | 8 | 0 | 0 | 0.0 % | 8 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 142 | crabtree | no_geo_events | 1 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 1 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 143 | coteau-du-lac | no_geo_events | 10 | 0 | 0 | 0.0 % | 10 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 144 | sainte-julienne | no_geo_events | 9 | 0 | 0 | 0.0 % | 9 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 145 | farnham | no_geo_events | 2 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 2 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 146 | saint-paul-dabbotsford | no_geo_events | 4 | 0 | 0 | 0.0 % | 4 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 147 | saint-clet | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 148 | saint-roch-de-richelieu | no_geo_events | 8 | 0 | 0 | 0.0 % | 8 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 149 | saint-jude | no_geo_events | 2 | 0 | 0 | 0.0 % | 2 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 150 | noyan | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 151 | ormstown | no_geo_events | 5 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 5 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 152 | ange-gardien | no_geo_events | 5 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 5 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 153 | saint-ours | no_geo_events | 3 | 0 | 0 | 0.0 % | 3 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 154 | prevost | no_geo_events | 2 | 0 | 0 | 0.0 % | 2 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 155 | saint-stanislas-de-kostka | no_geo_events | 4 | 0 | 0 | 0.0 % | 4 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 156 | saint-calixte | no_geo_events | 4 | 0 | 0 | 0.0 % | 4 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 157 | saint-barnabe-sud | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 158 | notre-dame-de-stanbridge | gap_acquisition | — | 0 | — | — | — | UNKNOWN honnête : fichier GT v2 S3 absent, hors dénominateur; jamais N-A. |
| 159 | franklin | na_proven | 0 | 0 | 0 | — | 0 | N-A prouvé : PV parsés, date_scrape=2026-06-11, 0 DesignationEvent prod densifiant; attestation docs/reports/recette/OPTIONA_NA_FINAL.txt, message conducteur env-cond-geojoint-7na-confirmed. |
| 160 | saint-pierre | no_geo_events | 2 | 0 | 0 | 0.0 % | 2 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 161 | saint-liguori | no_geo_events | 0 | 0 | 0 | — | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 162 | saint-hippolyte | no_geo_events | 30 | 0 | 0 | 0.0 % | 30 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 163 | venise-en-quebec | no_geo_events | 3 | 0 | 0 | 0.0 % | 3 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 164 | clarenceville | no_geo_events | 1 | 0 | 0 | 0.0 % | 0 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. 1 événement(s) GT sans source_url HTTP : non-matchables à la clé URL et missed honnêtes. |
| 165 | joliette | no_geo_events | 9 | 0 | 0 | 0.0 % | 9 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 166 | les-coteaux | no_geo_events | 5 | 0 | 0 | 0.0 % | 5 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |
| 167 | saint-dominique | no_geo_events | 6 | 0 | 0 | 0.0 % | 6 | incomplete/pending : aucune émission geo; GT conservée au dénominateur. |

Preuve événement-par-événement SET-RECALL (matched + missed, `source_fields` verbatim) : `set-recall-event-partition.ndjson`. Les octets GT v2 et le manifeste relu sont conservés dans `gt-v2/`.
