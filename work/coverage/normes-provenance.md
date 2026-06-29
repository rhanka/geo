# Registre de provenance — normes 2-moteurs (keep-best)

_Généré 2026-06-29T13:28:31.364Z — 301 villes._

**Gagnants:** OCR-4.0 = 38 · Claude-4.8 = 4 · existant gardé = 188 · déposés (apply) = 42

Recall = recoupement SIG si grille SIG dispo, sinon nb de zone_codes distincts. Anti-invention: garde `buildVisionField` partagée (verbatim ou null) → invention_ok partout.

| ville | grilleSIG | recall exist | recall OCR | recall Claude | gagnant | publié e/O/C | sig_ovlp | déposé | raison garde |
|---|---|---|---|---|---|---|---|---|---|
| acton-vale | — | 5 | 5 | 0 | ocr-4.0 | 20/25/0 | 0 | ✓ | claude rate-limit (sauté); recall 5->5, publié 20->25 |
| amherst | — | 98 | 6 | 0 | kept-existing | 375/8/0 | 0 |  | claude rate-limit (sauté); recall régresserait 98->6 |
| amqui | — | 228 | 0 | 0 | kept-existing | 398/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 228->0 |
| arundel | — | 25 | 0 | 0 | error | 159/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| ascot-corner | — | 126 | 115 | 0 | kept-existing | 52/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 126->115 |
| baie-durfe | — | 43 | 0 | 0 | error | 239/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| baie-saint-paul | — | 80 | 0 | 0 | error | 373/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| barkmere | — | 9 | 0 | 0 | kept-existing | 49/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| beaconsfield | — | 77 | 12 | 0 | kept-existing | 273/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 77->12 |
| becancour | — | 17 | 61 | 0 | kept-existing | 69/57/0 | 0 |  | claude rate-limit (sauté); payload régresserait 69->57 |
| berthier-sur-mer | — | 1 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 1->0 |
| berthierville | — | 4 | 0 | 0 | kept-existing | 17/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| blue-sea | — | 12 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | moins de 3 zones extraites |
| bois-des-filion | — | 1 | 0 | 0 | kept-existing | 7/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| boisbriand | — | 55 | 0 | 0 | error | 317/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| boischatel | — | 29 | 5 | 0 | kept-existing | 53/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 29->5 |
| bolton-est | — | 16 | 48 | 0 | ocr-4.0 | 31/48/0 | 0 | ✓ | claude rate-limit (sauté); recall 16->48, publié 31->48 |
| bolton-ouest | — | 21 | 5 | 0 | kept-existing | 89/15/0 | 0 |  | claude rate-limit (sauté); recall régresserait 21->5 |
| brossard | — | 55 | 4 | 0 | kept-existing | 53/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 55->4 |
| brownsburg-chatham | — | 21 | 53 | 0 | kept-existing | 68/32/0 | 0 |  | claude rate-limit (sauté); payload régresserait 68->32 |
| bury | — | 73 | 72 | 0 | kept-existing | 100/14/0 | 0 |  | claude rate-limit (sauté); recall régresserait 73->72 |
| cantley | — | 10 | 0 | 0 | error | 57/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| carleton-sur-mer | 160 | 0 | 0 | 0 | kept-existing | 422/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| chambly | — | 247 | 20 | 0 | kept-existing | 789/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 247->20 |
| chambord | — | 80 | 0 | 0 | kept-existing | 337/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| charlemagne | — | 47 | 0 | 0 | error | 211/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| chateau-richer | — | 66 | 95 | 0 | kept-existing | 144/51/0 | 0 |  | claude rate-limit (sauté); payload régresserait 144->51 |
| chelsea | 164 | 154 | 0 | 0 | error | 1230/0/0 | 0 |  | fetch failed |
| chertsey | — | 26 | 0 | 0 | error | 152/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| chesterville | — | 1 | 18 | 0 | ocr-4.0 | 6/18/0 | 0 | ✓ | claude rate-limit (sauté); recall 1->18, publié 6->18 |
| contrecoeur | — | 15 | 0 | 0 | kept-existing | 81/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| cookshire-eaton | — | 175 | 161 | 0 | kept-existing | 662/391/0 | 0 |  | claude rate-limit (sauté); recall régresserait 175->161 |
| coteau-du-lac | — | 124 | 15 | 0 | kept-existing | 525/4/0 | 0 |  | claude rate-limit (sauté); recall régresserait 124->15 |
| daveluyville | — | 55 | 0 | 0 | kept-existing | 177/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| deleage | — | 3 | 7 | 0 | kept-existing | 1/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 1->0 |
| delson | — | 102 | 0 | 0 | kept-existing | 426/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| deschaillons-sur-saint-laurent | — | 33 | 0 | 0 | kept-existing | 79/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| deux-montagnes | — | 41 | 0 | 0 | error | 190/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| disraeli--les-appalaches | — | 3 | 0 | 0 | kept-existing | 12/4/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| dixville | — | 46 | 0 | 0 | kept-existing | 30/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| dollard-des-ormeaux | — | 32 | 7 | 0 | kept-existing | 247/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 32->7 |
| dorval | — | 12 | 23 | 0 | kept-existing | 42/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 42->0 |
| duhamel | — | 49 | 0 | 0 | kept-existing | 76/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| east-angus | — | 104 | 74 | 0 | kept-existing | 447/129/0 | 0 |  | claude rate-limit (sauté); recall régresserait 104->74 |
| east-hereford | — | 51 | 32 | 0 | kept-existing | 193/68/0 | 0 |  | claude rate-limit (sauté); recall régresserait 51->32 |
| eastman | — | 112 | 109 | 27 | kept-existing | 1/0/70 | 0 |  | recall régresserait 112->109 |
| egan-sud | — | 4 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| farnham | — | 173 | 0 | 0 | error | 925/0/0 | 0 |  | fetch failed |
| fassett | — | 30 | 90 | 0 | kept-existing | 46/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 46->0 |
| fossambault-sur-le-lac | — | 1 | 0 | 0 | kept-existing | 2/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| franklin | — | 87 | 0 | 0 | error | 455/0/0 | 0 |  | fetch failed |
| frelighsburg | — | 6 | 0 | 0 | kept-existing | 6/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| gore | — | 26 | 0 | 0 | kept-existing | 115/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| granby | — | 74 | 43 | 0 | kept-existing | 302/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 74->43 |
| grenville-sur-la-rouge | — | 40 | 30 | 0 | kept-existing | 172/9/0 | 0 |  | claude rate-limit (sauté); recall régresserait 40->30 |
| ham-nord | — | 19 | 203 | 0 | ocr-4.0 | 126/392/0 | 0 | ✓ | claude rate-limit (sauté); recall 19->203, publié 126->392 |
| ham-sud | — | 9 | 0 | 0 | kept-existing | 8/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 9->0 |
| harrington | — | 7 | 0 | 0 | error | 35/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| hemmingford | — | 3 | 0 | 0 | error | 18/0/0 | 0 |  | fetch failed |
| herouxville | — | 88 | 0 | 0 | kept-existing | 151/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| hinchinbrooke | — | 4 | 4 | 0 | kept-existing | 20/4/0 | 4 |  | claude rate-limit (sauté); payload régresserait 20->4 |
| hudson | — | 7 | 0 | 0 | error | 32/0/0 | 0 |  | fetch failed |
| joliette | — | 10 | 0 | 0 | kept-existing | 28/6/0 | 0 |  | claude rate-limit (sauté); recall régresserait 10->0 |
| kiamika | — | 42 | 37 | 0 | kept-existing | 164/144/0 | 0 |  | claude rate-limit (sauté); recall régresserait 42->37 |
| kingsey-falls | — | 43 | 0 | 0 | error | 132/0/0 | 0 |  | HTTP 404 |
| la-conception | — | 12 | 0 | 0 | error | 57/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| la-durantaye | — | 30 | 154 | 0 | kept-existing | 101/4/0 | 0 |  | claude rate-limit (sauté); payload régresserait 101->4 |
| la-minerve | — | 19 | 134 | 0 | kept-existing | 68/30/0 | 0 |  | claude rate-limit (sauté); payload régresserait 68->30 |
| la-motte | — | 29 | 0 | 0 | kept-existing | 30/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 29->0 |
| la-peche | — | 44 | 0 | 0 | error | 181/0/0 | 0 |  | HTTP 404 |
| labelle | — | 79 | 0 | 0 | error | 422/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| lac-beauport | — | 80 | 0 | 0 | error | 154/0/0 | 0 |  | HTTP 404 |
| lac-des-aigles | — | 2 | 0 | 0 | kept-existing | 5/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| lac-des-ecorces | — | 122 | 0 | 0 | error | 431/0/0 | 0 |  | HTTP 404 |
| lac-des-seize-iles | — | 5 | 0 | 0 | kept-existing | 2/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 5->0 |
| lac-du-cerf | — | 30 | 30 | 0 | kept-existing | 120/120/0 | 0 |  | claude rate-limit (sauté); aucun gain strict (égalité) |
| lac-etchemin | — | 124 | 0 | 0 | error | 561/0/0 | 0 |  | HTTP 404 |
| lac-saguay | — | 33 | 30 | 0 | kept-existing | 111/108/0 | 0 |  | claude rate-limit (sauté); recall régresserait 33->30 |
| lac-sainte-marie | — | 57 | 0 | 0 | error | 169/0/0 | 0 |  | HTTP 404 |
| lac-simon | 74 | 1 | 0 | 0 | kept-existing | 221/8/0 | 0 |  | claude rate-limit (sauté); recall régresserait 1->0 |
| lac-tremblant-nord | — | 28 | 6 | 0 | kept-existing | 59/18/0 | 0 |  | claude rate-limit (sauté); recall régresserait 28->6 |
| lacolle | — | 92 | 0 | 0 | error | 91/0/0 | 0 |  | fetch failed |
| lancienne-lorette | — | 8 | 15 | 0 | kept-existing | 4/1/0 | 0 |  | claude rate-limit (sauté); payload régresserait 4->1 |
| lanoraie | — | 32 | 0 | 0 | kept-existing | 25/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 32->0 |
| lascension | — | 51 | 0 | 0 | kept-existing | 172/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| laurier-station | — | 52 | 0 | 0 | kept-existing | 88/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| lebel-sur-quevillon | — | 408 | 154 | 0 | kept-existing | 548/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 408->154 |
| leclercville | — | 27 | 115 | 0 | kept-existing | 105/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 105->0 |
| lejeune | — | 2 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| les-coteaux | — | 130 | 9 | 0 | kept-existing | 206/2/0 | 0 |  | claude rate-limit (sauté); recall régresserait 130->9 |
| lile-perrot | — | 10 | 42 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 10->42, publié 0->0 |
| lisle-aux-coudres | — | 4 | 0 | 0 | error | 17/0/0 | 0 |  | HTTP 404 |
| louiseville | — | 142 | 205 | 0 | kept-existing | 37/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 37->0 |
| magog | — | 23 | 0 | 0 | kept-existing | 32/4/0 | 0 |  | claude rate-limit (sauté); recall régresserait 23->0 |
| maniwaki | — | 288 | 332 | 0 | kept-existing | 290/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 290->0 |
| marston | — | 46 | 45 | 0 | kept-existing | 45/35/0 | 0 |  | claude rate-limit (sauté); recall régresserait 46->45 |
| mascouche | — | 8 | 116 | 0 | kept-existing | 7/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 7->0 |
| matane | — | 40 | 844 | 0 | kept-existing | 108/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 108->0 |
| melbourne | — | 8 | 219 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 8->219, publié 0->0 |
| mercier | — | 15 | 0 | 0 | error | 85/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| metis-sur-mer | — | 73 | 0 | 0 | kept-existing | 80/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 73->0 |
| milan | — | 9 | 47 | 0 | ocr-4.0 | 9/45/0 | 0 | ✓ | claude rate-limit (sauté); recall 9->47, publié 9->45 |
| mont-blanc | — | 3 | 3 | 1 | ocr-4.0 | 4/6/7 | 0 | ✓ | recall 3->3, publié 4->6 |
| mont-laurier | — | 6 | 0 | 0 | error | 20/0/0 | 0 |  | HTTP 404 |
| mont-saint-gregoire | — | 67 | 69 | 0 | ocr-4.0 | 41/204/0 | 0 | ✓ | claude rate-limit (sauté); recall 67->69, publié 41->204 |
| mont-saint-hilaire | 170 | 158 | 0 | 0 | error | 840/0/0 | 0 |  | fetch failed |
| mont-saint-michel | — | 21 | 0 | 0 | error | 77/0/0 | 0 |  | HTTP 404 |
| mont-tremblant | 585 | 0 | 0 | 0 | kept-existing | 200/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| montcalm | — | 1 | 6 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 1->6, publié 0->0 |
| montcerf-lytton | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| montebello | — | 40 | 103 | 0 | kept-existing | 1/0/0 | 0 |  | payload régresserait 1->0 |
| montreal-est | — | 75 | 0 | 0 | kept-existing | 326/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| montreal-ouest | — | 30 | 14 | 0 | kept-existing | 97/6/0 | 0 |  | claude rate-limit (sauté); recall régresserait 30->14 |
| nominingue | — | 75 | 0 | 0 | error | 366/0/0 | 0 |  | HTTP 404 |
| notre-dame-de-la-merci | — | 73 | 0 | 0 | error | 436/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| notre-dame-de-lile-perrot | — | 119 | 76 | 0 | kept-existing | 534/123/0 | 0 |  | claude rate-limit (sauté); recall régresserait 119->76 |
| notre-dame-de-lourdes--joliette | 43 | 6 | 0 | 0 | error | 146/0/0 | 0 |  | not a PDF |
| notre-dame-des-bois | — | 43 | 47 | 0 | ocr-4.0 | 28/40/0 | 0 | ✓ | claude rate-limit (sauté); recall 43->47, publié 28->40 |
| notre-dame-du-sacre-coeur-dissoudun | — | 7 | 0 | 0 | error | 34/0/0 | 0 |  | HTTP 404 |
| orford | — | 80 | 0 | 0 | error | 499/0/0 | 0 |  | not a PDF |
| plessisville | — | 4 | 8 | 0 | kept-existing | 4/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 4->0 |
| pointe-des-cascades | — | 43 | 50 | 0 | kept-existing | 164/104/0 | 0 |  | claude rate-limit (sauté); payload régresserait 164->104 |
| pointe-fortune | — | 47 | 2 | 0 | kept-existing | 200/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| potton | — | 1 | 0 | 0 | error | 5/0/0 | 0 |  | not a PDF |
| preissac | 25 | 12 | 0 | 0 | kept-existing | 25/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 12->0 |
| prevost | — | 32 | 0 | 0 | error | 53/0/0 | 0 |  | fetch failed |
| rawdon | — | 20 | 0 | 0 | error | 108/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| richmond | — | 26 | 104 | 83 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 26->104, publié 0->0 |
| riviere-beaudette | — | 41 | 8 | 0 | kept-existing | 115/9/0 | 0 |  | claude rate-limit (sauté); recall régresserait 41->8 |
| riviere-rouge | — | 5 | 159 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 5->159, publié 0->0 |
| rougemont | — | 75 | 0 | 0 | error | 178/0/0 | 0 |  | fetch failed |
| roxton-pond | — | 4 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 4->0 |
| saint-adolphe-dhoward | — | 1 | 43 | 0 | ocr-4.0 | 3/208/0 | 43 | ✓ | claude rate-limit (sauté); recall 1->43, publié 3->208 |
| saint-agapit | — | 22 | 0 | 0 | kept-existing | 66/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-aime | — | 5 | 0 | 0 | kept-existing | 17/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-alexandre | — | 1 | 0 | 0 | kept-existing | 7/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-alexis | — | 11 | 0 | 0 | error | 16/0/0 | 0 |  | HTTP 404 |
| saint-amable | 104 | 95 | 0 | 0 | error | 402/0/0 | 0 |  | fetch failed |
| saint-ambroise-de-kildare | — | 145 | 0 | 0 | kept-existing | 595/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-andre-dargenteuil | — | 37 | 0 | 0 | error | 579/0/0 | 0 |  | fetch failed |
| saint-anicet | — | 47 | 0 | 0 | kept-existing | 203/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-antoine-de-lisle-aux-grues | — | 6 | 0 | 0 | kept-existing | 6/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 6->0 |
| saint-apollinaire | — | 22 | 0 | 0 | error | 1/0/0 | 0 |  | not a PDF |
| saint-augustin-de-woburn | — | 18 | 49 | 0 | ocr-4.0 | 30/33/0 | 0 | ✓ | claude rate-limit (sauté); recall 18->49, publié 30->33 |
| saint-barnabe-sud | — | 1 | 27 | 0 | ocr-4.0 | 4/94/0 | 0 | ✓ | claude rate-limit (sauté); recall 1->27, publié 4->94 |
| saint-barthelemy | — | 27 | 26 | 0 | kept-existing | 54/0/0 | 26 |  | claude rate-limit (sauté); recall régresserait 27->26 |
| saint-blaise-sur-richelieu | — | 3 | 6 | 0 | kept-existing | 5/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 5->0 |
| saint-cesaire | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-charles-borromee | — | 13 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 13->0 |
| saint-christophe-darthabaska | — | 4 | 0 | 0 | error | 20/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| saint-chrysostome | — | 5 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 5->0 |
| saint-colomban | — | 2 | 0 | 0 | error | 7/0/0 | 0 |  | fetch failed |
| saint-come | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-come-liniere | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-constant | — | 1 | 0 | 0 | error | 5/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| saint-cuthbert | — | 27 | 0 | 0 | kept-existing | 0/0/141 | 0 |  | recall régresserait 27->0 |
| saint-dominique | — | 2 | 0 | 0 | kept-existing | 5/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-donat--matawinie | — | 1 | 0 | 0 | kept-existing | 7/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-elzear--la-nouvelle-beauce | — | 1 | 80 | 35 | ocr-4.0 | 0/123/131 | 0 | ✓ | recall 1->80, publié 0->123 |
| saint-esprit | — | 54 | 0 | 0 | error | 291/0/0 | 0 |  | fetch failed |
| saint-etienne-de-bolton | — | 14 | 22 | 0 | kept-existing | 35/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 35->0 |
| saint-eugene | — | 23 | 0 | 0 | kept-existing | 68/188/0 | 0 |  | claude rate-limit (sauté); recall régresserait 23->0 |
| saint-eustache | — | 28 | 37 | 3 | kept-existing | 2/0/13 | 0 |  | payload régresserait 2->0 |
| saint-fabien-de-panet | — | 13 | 0 | 0 | kept-existing | 3/0/3 | 0 |  | recall régresserait 13->0 |
| saint-felix-de-valois | — | 40 | 0 | 0 | error | 203/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| saint-francois-xavier-de-brompton | — | 5 | 226 | 6 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 5->226, publié 0->0 |
| saint-gabriel-de-brandon | — | 21 | 0 | 0 | kept-existing | 40/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-gabriel-de-valcartier | — | 2 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-georges | — | 13 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 13->0 |
| saint-germain-de-grantham | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-gilles | — | 25 | 24 | 0 | kept-existing | 44/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 25->24 |
| saint-henri | — | 94 | 0 | 0 | kept-existing | 283/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-hippolyte | — | 29 | 0 | 0 | error | 158/0/0 | 0 |  | fetch failed |
| saint-hugues | — | 17 | 0 | 0 | error | 62/0/0 | 0 |  | HTTP 404 |
| saint-hyacinthe | — | 1066 | 0 | 0 | error | 5671/0/0 | 0 |  | fetch failed |
| saint-isidore-de-clifton | — | 28 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-jacques | — | 71 | 0 | 0 | error | 398/0/0 | 0 |  | fetch failed |
| saint-jacques-le-mineur | — | 31 | 21 | 0 | kept-existing | 136/13/0 | 0 |  | claude rate-limit (sauté); recall régresserait 31->21 |
| saint-jean-de-matha | — | 1 | 0 | 0 | kept-existing | 7/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-jean-port-joli | — | 43 | 100 | 0 | kept-existing | 7/0/0 | 0 |  | payload régresserait 7->0 |
| saint-jean-sur-richelieu | — | 716 | 0 | 0 | kept-existing | 550/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-jerome | — | 108 | 0 | 0 | error | 30/0/0 | 0 |  | fetch failed |
| saint-joachim | — | 1 | 0 | 0 | error | 0/0/0 | 0 |  | fetch failed |
| saint-joseph-de-beauce | — | 3 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-joseph-de-lepage | — | 30 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 30->0 |
| saint-joseph-du-lac | — | 63 | 10 | 0 | kept-existing | 235/4/0 | 0 |  | claude rate-limit (sauté); recall régresserait 63->10 |
| saint-lambert | — | 158 | 186 | 0 | kept-existing | 584/4/0 | 0 |  | claude rate-limit (sauté); payload régresserait 584->4 |
| saint-laurent-de-lile-dorleans | — | 34 | 34 | 0 | kept-existing | 147/68/0 | 0 |  | claude rate-limit (sauté); payload régresserait 147->68 |
| saint-lazare-de-bellechasse | — | 82 | 150 | 0 | kept-existing | 106/3/0 | 0 |  | claude rate-limit (sauté); payload régresserait 106->3 |
| saint-leonard-de-portneuf | — | 30 | 179 | 0 | ocr-4.0 | 51/295/0 | 0 | ✓ | claude rate-limit (sauté); recall 30->179, publié 51->295 |
| saint-liguori | — | 46 | 46 | 0 | kept-existing | 259/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 259->0 |
| saint-louis-de-gonzague--beauharnois-salaberry | — | 66 | 0 | 0 | error | 331/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| saint-ludger | — | 71 | 72 | 0 | ocr-4.0 | 42/64/0 | 0 | ✓ | claude rate-limit (sauté); recall 71->72, publié 42->64 |
| saint-marc-sur-richelieu | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-mathias-sur-richelieu | — | 13 | 0 | 0 | error | 83/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| saint-mathieu-de-beloeil | — | 5 | 5 | 0 | ocr-4.0 | 9/17/0 | 5 | ✓ | claude rate-limit (sauté); recall 5->5, publié 9->17 |
| saint-mathieu-dharricana | — | 46 | 0 | 0 | kept-existing | 114/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 46->0 |
| saint-nazaire-dacton | — | 4 | 0 | 0 | error | 17/0/0 | 0 |  | fetch failed |
| saint-neree-de-bellechasse | — | 45 | 157 | 0 | kept-existing | 179/3/0 | 0 |  | claude rate-limit (sauté); payload régresserait 179->3 |
| saint-odilon-de-cranbourne | — | 52 | 46 | 52 | claude-4.8 | 0/0/130 | 52 | ✓ | recall 52->52, publié 0->130 |
| saint-ours | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-paul | — | 34 | 0 | 0 | error | 132/0/0 | 0 |  | fetch failed |
| saint-paul-de-lile-aux-noix | — | 76 | 0 | 0 | error | 223/0/0 | 0 |  | fetch failed |
| saint-polycarpe | — | 4 | 108 | 0 | ocr-4.0 | 0/3/0 | 0 | ✓ | recall 4->108, publié 0->3 |
| saint-prosper-de-champlain | — | 25 | 0 | 0 | error | 117/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| saint-raphael | — | 93 | 153 | 0 | kept-existing | 133/3/0 | 0 |  | claude rate-limit (sauté); payload régresserait 133->3 |
| saint-robert-bellarmin | — | 47 | 47 | 0 | kept-existing | 42/35/0 | 0 |  | claude rate-limit (sauté); payload régresserait 42->35 |
| saint-roch-de-richelieu | — | 1 | 6 | 0 | ocr-4.0 | 3/15/0 | 0 | ✓ | claude rate-limit (sauté); recall 1->6, publié 3->15 |
| saint-roch-des-aulnaies | — | 2 | 64 | 0 | kept-existing | 4/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 4->0 |
| saint-roch-ouest | — | 1 | 4 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 1->4, publié 0->0 |
| saint-rosaire | — | 1 | 10 | 10 | claude-4.8 | 0/0/35 | 0 | ✓ | recall 1->10, publié 0->35 |
| saint-sauveur | — | 144 | 0 | 0 | error | 820/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| saint-sebastien--le-haut-richelieu | — | 3 | 0 | 0 | kept-existing | 5/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-sixte | — | 23 | 0 | 0 | kept-existing | 101/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-stanislas-de-kostka | 48 | 47 | 0 | 0 | error | 380/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| saint-telesphore | — | 9 | 9 | 0 | kept-existing | 20/12/0 | 0 |  | claude rate-limit (sauté); payload régresserait 20->12 |
| saint-thomas | — | 4 | 0 | 0 | error | 25/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| saint-tite-des-caps | — | 2 | 49 | 0 | kept-existing | 7/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 7->0 |
| saint-valere | — | 47 | 7 | 0 | kept-existing | 209/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 47->7 |
| saint-valerien-de-milton | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-zotique | — | 86 | 0 | 0 | kept-existing | 154/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-adele | — | 22 | 0 | 0 | kept-existing | 57/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 22->0 |
| sainte-anne-des-lacs | — | 35 | 0 | 0 | error | 186/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| sainte-beatrix | — | 32 | 146 | 0 | kept-existing | 21/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 21->0 |
| sainte-brigide-diberville | — | 6 | 14 | 0 | kept-existing | 18/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 18->0 |
| sainte-brigitte-de-laval | — | 38 | 73 | 0 | ocr-4.0 | 113/149/0 | 0 | ✓ | claude rate-limit (sauté); recall 38->73, publié 113->149 |
| sainte-catherine-de-la-jacques-cartier | — | 59 | 0 | 0 | kept-existing | 143/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-cecile-de-levrard | — | 10 | 0 | 0 | kept-existing | 25/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-cecile-de-milton | 32 | 1 | 0 | 0 | kept-existing | 6/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-cecile-de-whitton | — | 96 | 99 | 0 | kept-existing | 90/89/0 | 0 |  | claude rate-limit (sauté); payload régresserait 90->89 |
| sainte-christine-dauvergne | — | 71 | 165 | 0 | ocr-4.0 | 44/240/0 | 0 | ✓ | claude rate-limit (sauté); recall 71->165, publié 44->240 |
| sainte-claire | — | 133 | 153 | 0 | kept-existing | 254/3/0 | 0 |  | claude rate-limit (sauté); payload régresserait 254->3 |
| sainte-clotilde-de-horton | — | 1 | 13 | 1 | ocr-4.0 | 0/4/1 | 0 | ✓ | recall 1->13, publié 0->4 |
| sainte-croix | — | 2 | 19 | 0 | ocr-4.0 | 5/35/0 | 0 | ✓ | claude rate-limit (sauté); recall 2->19, publié 5->35 |
| sainte-edwidge-de-clifton | — | 3 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| sainte-elizabeth-de-warwick | — | 13 | 0 | 0 | error | 86/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| sainte-emelie-de-lenergie | — | 10 | 105 | 0 | kept-existing | 16/7/0 | 0 |  | claude rate-limit (sauté); payload régresserait 16->7 |
| sainte-eulalie | — | 8 | 0 | 0 | kept-existing | 15/12/0 | 0 |  | claude rate-limit (sauté); recall régresserait 8->0 |
| sainte-felicite--la-matanie | — | 44 | 0 | 0 | kept-existing | 68/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 44->0 |
| sainte-felicite--lislet | — | 46 | 0 | 0 | kept-existing | 92/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-francoise--becancour | — | 15 | 0 | 0 | kept-existing | 34/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-henedine | — | 1 | 157 | 0 | kept-existing | 1/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 1->0 |
| sainte-julienne | — | 5 | 0 | 0 | error | 27/0/0 | 0 |  | fetch failed |
| sainte-louise | — | 4 | 6 | 0 | kept-existing | 15/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 15->0 |
| sainte-marcelline-de-kildare | — | 31 | 0 | 0 | kept-existing | 51/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-marguerite-du-lac-masson | — | 64 | 0 | 0 | error | 369/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| sainte-marie-salome | — | 9 | 0 | 0 | kept-existing | 36/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-marthe-sur-le-lac | — | 18 | 0 | 0 | error | 96/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| sainte-melanie | — | 50 | 0 | 0 | kept-existing | 195/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 50->0 |
| sainte-monique--lac-saint-jean-est | — | 2 | 0 | 0 | kept-existing | 6/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-paule | 5 | 0 | 0 | 0 | kept-existing | 35/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 35->0 |
| sainte-petronille | — | 5 | 1 | 0 | kept-existing | 20/2/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-seraphine | — | 26 | 139 | 0 | ocr-4.0 | 81/272/0 | 0 | ✓ | claude rate-limit (sauté); recall 26->139, publié 81->272 |
| sainte-sophie | — | 36 | 0 | 0 | error | 154/0/0 | 0 |  | fetch failed |
| sainte-thecle | — | 6 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| sainte-therese | — | 145 | 117 | 0 | kept-existing | 409/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 145->117 |
| sainte-therese-de-la-gatineau | — | 433 | 354 | 0 | kept-existing | 398/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 433->354 |
| sainte-victoire-de-sorel | 29 | 0 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | aucun gain strict (égalité) |
| scotstown | — | 14 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| scott | — | 4 | 103 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 4->103, publié 0->0 |
| senneville | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| shannon | — | 96 | 6 | 0 | kept-existing | 341/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 96->6 |
| shawinigan | — | 6 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| shefford | — | 7 | 7 | 0 | ocr-4.0 | 2/24/59 | 7 | ✓ | recall 7->7, publié 2->24 |
| stanbridge-east | — | 29 | 25 | 0 | kept-existing | 38/7/0 | 0 |  | claude rate-limit (sauté); recall régresserait 29->25 |
| stanstead--memphremagog | — | 49 | 70 | 0 | kept-existing | 16/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 16->0 |
| stanstead--memphremagog--2 | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| stoneham-et-tewkesbury | — | 1 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| stornoway | — | 8 | 67 | 0 | ocr-4.0 | 6/46/0 | 0 | ✓ | claude rate-limit (sauté); recall 8->67, publié 6->46 |
| stratford | 50 | 49 | 39 | 39 | kept-existing | 14/54/125 | 39 |  | recall régresserait 49->39 |
| sutton | 216 | 0 | 0 | 0 | kept-existing | 164/9/0 | 0 |  | claude rate-limit (sauté); payload régresserait 164->9 |
| tadoussac | — | 59 | 69 | 0 | ocr-4.0 | 248/305/0 | 0 | ✓ | claude rate-limit (sauté); recall 59->69, publié 248->305 |
| terrasse-vaudreuil | — | 29 | 0 | 0 | error | 136/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| tingwick | — | 3 | 66 | 0 | kept-existing | 6/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 6->0 |
| tres-saint-redempteur | — | 6 | 91 | 0 | ocr-4.0 | 0/3/0 | 0 | ✓ | recall 6->91, publié 0->3 |
| tring-jonction | — | 16 | 34 | 46 | claude-4.8 | 0/32/69 | 46 | ✓ | recall 16->46, publié 0->69 |
| trois-rives | — | 1 | 44 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 3->0 |
| ulverton | — | 7 | 172 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 7->172, publié 0->0 |
| upton | — | 29 | 148 | 0 | ocr-4.0 | 113/182/0 | 0 | ✓ | claude rate-limit (sauté); recall 29->148, publié 113->182 |
| val-alain | — | 6 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| val-des-bois | — | 5 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 5->0 |
| val-des-lacs | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| val-des-monts | — | 4 | 2 | 0 | kept-existing | 15/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| val-des-sources | — | 51 | 0 | 0 | kept-existing | 375/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| val-dor | — | 619 | 604 | 0 | kept-existing | 1921/165/0 | 0 |  | claude rate-limit (sauté); recall régresserait 619->604 |
| val-joli | — | 2 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| val-morin | — | 2 | 0 | 0 | kept-existing | 84/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| val-racine | — | 4 | 35 | 35 | claude-4.8 | 0/20/59 | 0 | ✓ | recall 4->35, publié 0->59 |
| valcourt--le-val-saint-francois | — | 15 | 162 | 0 | kept-existing | 9/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 9->0 |
| varennes | — | 26 | 24 | 0 | kept-existing | 81/2/0 | 0 |  | claude rate-limit (sauté); recall régresserait 26->24 |
| vaudreuil-dorion | — | 270 | 0 | 0 | error | 1121/0/0 | 0 |  | fetch failed |
| vaudreuil-sur-le-lac | — | 15 | 10 | 0 | kept-existing | 50/4/0 | 0 |  | claude rate-limit (sauté); recall régresserait 15->10 |
| venise-en-quebec | — | 61 | 67 | 0 | kept-existing | 240/166/0 | 0 |  | claude rate-limit (sauté); payload régresserait 240->166 |
| vercheres | — | 8 | 118 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 8->118, publié 0->0 |
| waterloo | — | 124 | 0 | 0 | kept-existing | 322/17/0 | 0 |  | claude rate-limit (sauté); recall régresserait 124->0 |
| waterville | — | 9 | 82 | 34 | ocr-4.0 | 0/4/170 | 0 | ✓ | recall 9->82, publié 0->4 |
| weedon | — | 8 | 20 | 0 | kept-existing | 2/0/0 | 0 |  | payload régresserait 2->0 |
| wentworth | — | 15 | 0 | 0 | kept-existing | 94/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| wentworth-nord | — | 145 | 0 | 0 | error | 851/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
| westmount | — | 4 | 0 | 0 | kept-existing | 7/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| wickham | — | 24 | 0 | 0 | error | 107/0/0 | 0 |  | Unknown system error -122: Unknown system error -122, write |
