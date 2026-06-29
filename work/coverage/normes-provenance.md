# Registre de provenance — normes 2-moteurs (keep-best)

_Généré 2026-06-29T13:01:48.995Z — 174 villes._

**Gagnants:** OCR-4.0 = 33 · Claude-4.8 = 4 · existant gardé = 125 · déposés (apply) = 37

Recall = recoupement SIG si grille SIG dispo, sinon nb de zone_codes distincts. Anti-invention: garde `buildVisionField` partagée (verbatim ou null) → invention_ok partout.

| ville | grilleSIG | recall exist | recall OCR | recall Claude | gagnant | publié e/O/C | sig_ovlp | déposé | raison garde |
|---|---|---|---|---|---|---|---|---|---|
| amqui | — | 228 | 0 | 0 | kept-existing | 398/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 228->0 |
| ascot-corner | — | 126 | 115 | 0 | kept-existing | 52/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 126->115 |
| becancour | — | 17 | 61 | 0 | kept-existing | 69/57/0 | 0 |  | claude rate-limit (sauté); payload régresserait 69->57 |
| berthier-sur-mer | — | 1 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 1->0 |
| blue-sea | — | 12 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | moins de 3 zones extraites |
| boischatel | — | 29 | 5 | 0 | kept-existing | 53/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 29->5 |
| bolton-est | — | 16 | 48 | 0 | ocr-4.0 | 31/48/0 | 0 | ✓ | claude rate-limit (sauté); recall 16->48, publié 31->48 |
| brossard | — | 55 | 4 | 0 | kept-existing | 53/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 55->4 |
| bury | — | 73 | 72 | 0 | kept-existing | 100/14/0 | 0 |  | claude rate-limit (sauté); recall régresserait 73->72 |
| chambly | — | 247 | 20 | 0 | kept-existing | 789/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 247->20 |
| chateau-richer | — | 66 | 95 | 0 | kept-existing | 144/51/0 | 0 |  | claude rate-limit (sauté); payload régresserait 144->51 |
| chesterville | — | 1 | 18 | 0 | ocr-4.0 | 6/18/0 | 0 | ✓ | claude rate-limit (sauté); recall 1->18, publié 6->18 |
| contrecoeur | — | 15 | 0 | 0 | kept-existing | 81/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| deleage | — | 3 | 7 | 0 | kept-existing | 1/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 1->0 |
| deschaillons-sur-saint-laurent | — | 33 | 0 | 0 | kept-existing | 79/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| dixville | — | 46 | 0 | 0 | kept-existing | 30/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| duhamel | — | 49 | 0 | 0 | kept-existing | 76/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| eastman | — | 112 | 109 | 27 | kept-existing | 1/0/70 | 0 |  | recall régresserait 112->109 |
| egan-sud | — | 4 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| fassett | — | 30 | 90 | 0 | kept-existing | 46/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 46->0 |
| fossambault-sur-le-lac | — | 1 | 0 | 0 | kept-existing | 2/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| frelighsburg | — | 6 | 0 | 0 | kept-existing | 6/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| ham-sud | — | 9 | 0 | 0 | kept-existing | 8/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 9->0 |
| herouxville | — | 88 | 0 | 0 | kept-existing | 151/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| joliette | — | 10 | 0 | 0 | kept-existing | 28/6/0 | 0 |  | claude rate-limit (sauté); recall régresserait 10->0 |
| kingsey-falls | — | 43 | 0 | 0 | error | 132/0/0 | 0 |  | HTTP 404 |
| la-motte | — | 29 | 0 | 0 | kept-existing | 30/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 29->0 |
| lac-beauport | — | 80 | 0 | 0 | error | 154/0/0 | 0 |  | HTTP 404 |
| lac-des-aigles | — | 2 | 0 | 0 | kept-existing | 5/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| lac-des-seize-iles | — | 5 | 0 | 0 | kept-existing | 2/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 5->0 |
| lac-sainte-marie | — | 57 | 0 | 0 | error | 169/0/0 | 0 |  | HTTP 404 |
| lac-simon | 74 | 1 | 0 | 0 | kept-existing | 221/8/0 | 0 |  | claude rate-limit (sauté); recall régresserait 1->0 |
| lac-tremblant-nord | — | 28 | 6 | 0 | kept-existing | 59/18/0 | 0 |  | claude rate-limit (sauté); recall régresserait 28->6 |
| lacolle | — | 92 | 0 | 0 | error | 91/0/0 | 0 |  | fetch failed |
| lancienne-lorette | — | 8 | 15 | 0 | kept-existing | 4/1/0 | 0 |  | claude rate-limit (sauté); payload régresserait 4->1 |
| lanoraie | — | 32 | 0 | 0 | kept-existing | 25/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 32->0 |
| laurier-station | — | 52 | 0 | 0 | kept-existing | 88/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| lebel-sur-quevillon | — | 408 | 154 | 0 | kept-existing | 548/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 408->154 |
| lejeune | — | 2 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| les-coteaux | — | 130 | 9 | 0 | kept-existing | 206/2/0 | 0 |  | claude rate-limit (sauté); recall régresserait 130->9 |
| lile-perrot | — | 10 | 42 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 10->42, publié 0->0 |
| louiseville | — | 142 | 205 | 0 | kept-existing | 37/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 37->0 |
| magog | — | 23 | 0 | 0 | kept-existing | 32/4/0 | 0 |  | claude rate-limit (sauté); recall régresserait 23->0 |
| maniwaki | — | 288 | 332 | 0 | kept-existing | 290/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 290->0 |
| marston | — | 46 | 45 | 0 | kept-existing | 45/35/0 | 0 |  | claude rate-limit (sauté); recall régresserait 46->45 |
| mascouche | — | 8 | 116 | 0 | kept-existing | 7/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 7->0 |
| matane | — | 40 | 844 | 0 | kept-existing | 108/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 108->0 |
| melbourne | — | 8 | 219 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 8->219, publié 0->0 |
| metis-sur-mer | — | 73 | 0 | 0 | kept-existing | 80/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 73->0 |
| milan | — | 9 | 47 | 0 | ocr-4.0 | 9/45/0 | 0 | ✓ | claude rate-limit (sauté); recall 9->47, publié 9->45 |
| mont-blanc | — | 3 | 3 | 1 | ocr-4.0 | 4/6/7 | 0 | ✓ | recall 3->3, publié 4->6 |
| mont-saint-gregoire | — | 67 | 69 | 0 | ocr-4.0 | 41/204/0 | 0 | ✓ | claude rate-limit (sauté); recall 67->69, publié 41->204 |
| montcalm | — | 1 | 6 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 1->6, publié 0->0 |
| montcerf-lytton | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| montebello | — | 40 | 103 | 0 | kept-existing | 1/0/0 | 0 |  | payload régresserait 1->0 |
| montreal-est | — | 75 | 0 | 0 | kept-existing | 326/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| notre-dame-des-bois | — | 43 | 47 | 0 | ocr-4.0 | 28/40/0 | 0 | ✓ | claude rate-limit (sauté); recall 43->47, publié 28->40 |
| plessisville | — | 4 | 8 | 0 | kept-existing | 4/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 4->0 |
| preissac | 25 | 12 | 0 | 0 | kept-existing | 25/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 12->0 |
| prevost | — | 32 | 0 | 0 | error | 53/0/0 | 0 |  | fetch failed |
| richmond | — | 26 | 104 | 83 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 26->104, publié 0->0 |
| riviere-beaudette | — | 41 | 8 | 0 | kept-existing | 115/9/0 | 0 |  | claude rate-limit (sauté); recall régresserait 41->8 |
| riviere-rouge | — | 5 | 159 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 5->159, publié 0->0 |
| rougemont | — | 75 | 0 | 0 | error | 178/0/0 | 0 |  | fetch failed |
| roxton-pond | — | 4 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 4->0 |
| saint-adolphe-dhoward | — | 1 | 43 | 0 | ocr-4.0 | 3/208/0 | 43 | ✓ | claude rate-limit (sauté); recall 1->43, publié 3->208 |
| saint-agapit | — | 22 | 0 | 0 | kept-existing | 66/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-alexis | — | 11 | 0 | 0 | error | 16/0/0 | 0 |  | HTTP 404 |
| saint-antoine-de-lisle-aux-grues | — | 6 | 0 | 0 | kept-existing | 6/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 6->0 |
| saint-apollinaire | — | 22 | 0 | 0 | error | 1/0/0 | 0 |  | not a PDF |
| saint-augustin-de-woburn | — | 18 | 49 | 0 | ocr-4.0 | 30/33/0 | 0 | ✓ | claude rate-limit (sauté); recall 18->49, publié 30->33 |
| saint-barthelemy | — | 27 | 26 | 0 | kept-existing | 54/0/0 | 26 |  | claude rate-limit (sauté); recall régresserait 27->26 |
| saint-blaise-sur-richelieu | — | 3 | 6 | 0 | kept-existing | 5/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 5->0 |
| saint-cesaire | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-charles-borromee | — | 13 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 13->0 |
| saint-chrysostome | — | 5 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 5->0 |
| saint-colomban | — | 2 | 0 | 0 | error | 7/0/0 | 0 |  | fetch failed |
| saint-come | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-come-liniere | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-cuthbert | — | 27 | 0 | 0 | kept-existing | 0/0/141 | 0 |  | recall régresserait 27->0 |
| saint-dominique | — | 2 | 0 | 0 | kept-existing | 5/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-elzear--la-nouvelle-beauce | — | 1 | 80 | 35 | ocr-4.0 | 0/123/131 | 0 | ✓ | recall 1->80, publié 0->123 |
| saint-etienne-de-bolton | — | 14 | 22 | 0 | kept-existing | 35/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 35->0 |
| saint-eugene | — | 23 | 0 | 0 | kept-existing | 68/188/0 | 0 |  | claude rate-limit (sauté); recall régresserait 23->0 |
| saint-eustache | — | 28 | 37 | 3 | kept-existing | 2/0/13 | 0 |  | payload régresserait 2->0 |
| saint-fabien-de-panet | — | 13 | 0 | 0 | kept-existing | 3/0/3 | 0 |  | recall régresserait 13->0 |
| saint-francois-xavier-de-brompton | — | 5 | 226 | 6 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 5->226, publié 0->0 |
| saint-gabriel-de-brandon | — | 21 | 0 | 0 | kept-existing | 40/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-gabriel-de-valcartier | — | 2 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-georges | — | 13 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 13->0 |
| saint-germain-de-grantham | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-gilles | — | 25 | 24 | 0 | kept-existing | 44/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 25->24 |
| saint-henri | — | 94 | 0 | 0 | kept-existing | 283/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-isidore-de-clifton | — | 28 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-jean-port-joli | — | 43 | 100 | 0 | kept-existing | 7/0/0 | 0 |  | payload régresserait 7->0 |
| saint-jean-sur-richelieu | — | 716 | 0 | 0 | kept-existing | 550/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-jerome | — | 108 | 0 | 0 | error | 30/0/0 | 0 |  | fetch failed |
| saint-joachim | — | 1 | 0 | 0 | error | 0/0/0 | 0 |  | fetch failed |
| saint-joseph-de-beauce | — | 3 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-joseph-de-lepage | — | 30 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 30->0 |
| saint-lazare-de-bellechasse | — | 82 | 150 | 0 | kept-existing | 106/3/0 | 0 |  | claude rate-limit (sauté); payload régresserait 106->3 |
| saint-leonard-de-portneuf | — | 30 | 179 | 0 | ocr-4.0 | 51/295/0 | 0 | ✓ | claude rate-limit (sauté); recall 30->179, publié 51->295 |
| saint-ludger | — | 71 | 72 | 0 | ocr-4.0 | 42/64/0 | 0 | ✓ | claude rate-limit (sauté); recall 71->72, publié 42->64 |
| saint-marc-sur-richelieu | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-mathieu-de-beloeil | — | 5 | 5 | 0 | ocr-4.0 | 9/17/0 | 5 | ✓ | claude rate-limit (sauté); recall 5->5, publié 9->17 |
| saint-mathieu-dharricana | — | 46 | 0 | 0 | kept-existing | 114/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 46->0 |
| saint-odilon-de-cranbourne | — | 52 | 46 | 52 | claude-4.8 | 0/0/130 | 52 | ✓ | recall 52->52, publié 0->130 |
| saint-ours | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-paul-de-lile-aux-noix | — | 76 | 0 | 0 | error | 223/0/0 | 0 |  | fetch failed |
| saint-polycarpe | — | 4 | 108 | 0 | ocr-4.0 | 0/3/0 | 0 | ✓ | recall 4->108, publié 0->3 |
| saint-raphael | — | 93 | 153 | 0 | kept-existing | 133/3/0 | 0 |  | claude rate-limit (sauté); payload régresserait 133->3 |
| saint-robert-bellarmin | — | 47 | 47 | 0 | kept-existing | 42/35/0 | 0 |  | claude rate-limit (sauté); payload régresserait 42->35 |
| saint-roch-de-richelieu | — | 1 | 6 | 0 | ocr-4.0 | 3/15/0 | 0 | ✓ | claude rate-limit (sauté); recall 1->6, publié 3->15 |
| saint-roch-des-aulnaies | — | 2 | 64 | 0 | kept-existing | 4/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 4->0 |
| saint-roch-ouest | — | 1 | 4 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 1->4, publié 0->0 |
| saint-rosaire | — | 1 | 10 | 10 | claude-4.8 | 0/0/35 | 0 | ✓ | recall 1->10, publié 0->35 |
| saint-sebastien--le-haut-richelieu | — | 3 | 0 | 0 | kept-existing | 5/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| saint-telesphore | — | 9 | 9 | 0 | kept-existing | 20/12/0 | 0 |  | claude rate-limit (sauté); payload régresserait 20->12 |
| saint-valerien-de-milton | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-zotique | — | 86 | 0 | 0 | kept-existing | 154/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-adele | — | 22 | 0 | 0 | kept-existing | 57/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 22->0 |
| sainte-beatrix | — | 32 | 146 | 0 | kept-existing | 21/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 21->0 |
| sainte-brigitte-de-laval | — | 38 | 73 | 0 | ocr-4.0 | 113/149/0 | 0 | ✓ | claude rate-limit (sauté); recall 38->73, publié 113->149 |
| sainte-catherine-de-la-jacques-cartier | — | 59 | 0 | 0 | kept-existing | 143/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-cecile-de-levrard | — | 10 | 0 | 0 | kept-existing | 25/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-cecile-de-whitton | — | 96 | 99 | 0 | kept-existing | 90/89/0 | 0 |  | claude rate-limit (sauté); payload régresserait 90->89 |
| sainte-christine-dauvergne | — | 71 | 165 | 0 | ocr-4.0 | 44/240/0 | 0 | ✓ | claude rate-limit (sauté); recall 71->165, publié 44->240 |
| sainte-claire | — | 133 | 153 | 0 | kept-existing | 254/3/0 | 0 |  | claude rate-limit (sauté); payload régresserait 254->3 |
| sainte-clotilde-de-horton | — | 1 | 13 | 1 | ocr-4.0 | 0/4/1 | 0 | ✓ | recall 1->13, publié 0->4 |
| sainte-croix | — | 2 | 19 | 0 | ocr-4.0 | 5/35/0 | 0 | ✓ | claude rate-limit (sauté); recall 2->19, publié 5->35 |
| sainte-edwidge-de-clifton | — | 3 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| sainte-emelie-de-lenergie | — | 10 | 105 | 0 | kept-existing | 16/7/0 | 0 |  | claude rate-limit (sauté); payload régresserait 16->7 |
| sainte-eulalie | — | 8 | 0 | 0 | kept-existing | 15/12/0 | 0 |  | claude rate-limit (sauté); recall régresserait 8->0 |
| sainte-felicite--la-matanie | — | 44 | 0 | 0 | kept-existing | 68/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 44->0 |
| sainte-felicite--lislet | — | 46 | 0 | 0 | kept-existing | 92/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-francoise--becancour | — | 15 | 0 | 0 | kept-existing | 34/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-henedine | — | 1 | 157 | 0 | kept-existing | 1/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 1->0 |
| sainte-marcelline-de-kildare | — | 31 | 0 | 0 | kept-existing | 51/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-monique--lac-saint-jean-est | — | 2 | 0 | 0 | kept-existing | 6/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| sainte-paule | 5 | 0 | 0 | 0 | kept-existing | 35/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 35->0 |
| sainte-seraphine | — | 26 | 139 | 0 | ocr-4.0 | 81/272/0 | 0 | ✓ | claude rate-limit (sauté); recall 26->139, publié 81->272 |
| sainte-thecle | — | 6 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| sainte-therese | — | 145 | 117 | 0 | kept-existing | 409/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 145->117 |
| sainte-therese-de-la-gatineau | — | 433 | 354 | 0 | kept-existing | 398/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 433->354 |
| sainte-victoire-de-sorel | 29 | 0 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | aucun gain strict (égalité) |
| scotstown | — | 14 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| scott | — | 4 | 103 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 4->103, publié 0->0 |
| senneville | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| shawinigan | — | 6 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| shefford | — | 7 | 7 | 0 | ocr-4.0 | 2/24/59 | 7 | ✓ | recall 7->7, publié 2->24 |
| stanbridge-east | — | 29 | 25 | 0 | kept-existing | 38/7/0 | 0 |  | claude rate-limit (sauté); recall régresserait 29->25 |
| stanstead--memphremagog | — | 49 | 70 | 0 | kept-existing | 16/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 16->0 |
| stanstead--memphremagog--2 | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| stoneham-et-tewkesbury | — | 1 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| stornoway | — | 8 | 67 | 0 | ocr-4.0 | 6/46/0 | 0 | ✓ | claude rate-limit (sauté); recall 8->67, publié 6->46 |
| stratford | 50 | 49 | 39 | 39 | kept-existing | 14/54/125 | 39 |  | recall régresserait 49->39 |
| tingwick | — | 3 | 66 | 0 | kept-existing | 6/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 6->0 |
| tres-saint-redempteur | — | 6 | 91 | 0 | ocr-4.0 | 0/3/0 | 0 | ✓ | recall 6->91, publié 0->3 |
| tring-jonction | — | 16 | 34 | 46 | claude-4.8 | 0/32/69 | 46 | ✓ | recall 16->46, publié 0->69 |
| trois-rives | — | 1 | 44 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 3->0 |
| ulverton | — | 7 | 172 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 7->172, publié 0->0 |
| val-alain | — | 6 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| val-des-bois | — | 5 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 5->0 |
| val-des-lacs | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| val-joli | — | 2 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| val-morin | — | 2 | 0 | 0 | kept-existing | 84/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| val-racine | — | 4 | 35 | 35 | claude-4.8 | 0/20/59 | 0 | ✓ | recall 4->35, publié 0->59 |
| valcourt--le-val-saint-francois | — | 15 | 162 | 0 | kept-existing | 9/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 9->0 |
| varennes | — | 26 | 24 | 0 | kept-existing | 81/2/0 | 0 |  | claude rate-limit (sauté); recall régresserait 26->24 |
| vercheres | — | 8 | 118 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 8->118, publié 0->0 |
| waterloo | — | 124 | 0 | 0 | kept-existing | 322/17/0 | 0 |  | claude rate-limit (sauté); recall régresserait 124->0 |
| waterville | — | 9 | 82 | 34 | ocr-4.0 | 0/4/170 | 0 | ✓ | recall 9->82, publié 0->4 |
| weedon | — | 8 | 20 | 0 | kept-existing | 2/0/0 | 0 |  | payload régresserait 2->0 |
| westmount | — | 4 | 0 | 0 | kept-existing | 7/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
