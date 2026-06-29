# Registre de provenance — normes 2-moteurs (keep-best)

_Généré 2026-06-29T12:14:29.893Z — 70 villes._

**Gagnants:** OCR-4.0 = 20 · Claude-4.8 = 4 · existant gardé = 43 · déposés (apply) = 24

Recall = recoupement SIG si grille SIG dispo, sinon nb de zone_codes distincts. Anti-invention: garde `buildVisionField` partagée (verbatim ou null) → invention_ok partout.

| ville | grilleSIG | recall exist | recall OCR | recall Claude | gagnant | publié e/O/C | sig_ovlp | déposé | raison garde |
|---|---|---|---|---|---|---|---|---|---|
| ascot-corner | — | 126 | 115 | 0 | kept-existing | 52/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 126->115 |
| blue-sea | — | 12 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | moins de 3 zones extraites |
| deleage | — | 3 | 7 | 0 | kept-existing | 1/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 1->0 |
| dixville | — | 46 | 0 | 0 | kept-existing | 30/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| eastman | — | 112 | 109 | 27 | kept-existing | 1/0/70 | 0 |  | recall régresserait 112->109 |
| lac-des-seize-iles | — | 5 | 0 | 0 | kept-existing | 2/0/0 | 0 |  | claude rate-limit (sauté); recall régresserait 5->0 |
| lancienne-lorette | — | 8 | 15 | 0 | kept-existing | 4/1/0 | 0 |  | claude rate-limit (sauté); payload régresserait 4->1 |
| lile-perrot | — | 10 | 42 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 10->42, publié 0->0 |
| louiseville | — | 142 | 205 | 0 | kept-existing | 37/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 37->0 |
| melbourne | — | 8 | 219 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 8->219, publié 0->0 |
| mont-blanc | — | 3 | 3 | 1 | ocr-4.0 | 4/6/7 | 0 | ✓ | recall 3->3, publié 4->6 |
| mont-saint-gregoire | — | 67 | 69 | 0 | ocr-4.0 | 41/204/0 | 0 | ✓ | claude rate-limit (sauté); recall 67->69, publié 41->204 |
| montcalm | — | 1 | 6 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 1->6, publié 0->0 |
| montcerf-lytton | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| montebello | — | 40 | 103 | 0 | kept-existing | 1/0/0 | 0 |  | payload régresserait 1->0 |
| notre-dame-des-bois | — | 43 | 47 | 0 | ocr-4.0 | 28/40/0 | 0 | ✓ | claude rate-limit (sauté); recall 43->47, publié 28->40 |
| richmond | — | 26 | 104 | 83 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 26->104, publié 0->0 |
| riviere-rouge | — | 5 | 159 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 5->159, publié 0->0 |
| roxton-pond | — | 4 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 4->0 |
| saint-apollinaire | — | 22 | 0 | 0 | error | 1/0/0 | 0 |  | not a PDF |
| saint-cesaire | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-charles-borromee | — | 13 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 13->0 |
| saint-chrysostome | — | 5 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 5->0 |
| saint-come | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-come-liniere | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-cuthbert | — | 27 | 0 | 0 | kept-existing | 0/0/141 | 0 |  | recall régresserait 27->0 |
| saint-elzear--la-nouvelle-beauce | — | 1 | 80 | 35 | ocr-4.0 | 0/123/131 | 0 | ✓ | recall 1->80, publié 0->123 |
| saint-eustache | — | 28 | 37 | 3 | kept-existing | 2/0/13 | 0 |  | payload régresserait 2->0 |
| saint-fabien-de-panet | — | 13 | 0 | 0 | kept-existing | 3/0/3 | 0 |  | recall régresserait 13->0 |
| saint-francois-xavier-de-brompton | — | 5 | 226 | 6 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 5->226, publié 0->0 |
| saint-gabriel-de-valcartier | — | 2 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-georges | — | 13 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 13->0 |
| saint-germain-de-grantham | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-isidore-de-clifton | — | 28 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-jean-port-joli | — | 43 | 100 | 0 | kept-existing | 7/0/0 | 0 |  | payload régresserait 7->0 |
| saint-jerome | — | 108 | 0 | 0 | error | 30/0/0 | 0 |  | fetch failed |
| saint-joachim | — | 1 | 0 | 0 | error | 0/0/0 | 0 |  | fetch failed |
| saint-joseph-de-lepage | — | 30 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 30->0 |
| saint-ludger | — | 71 | 72 | 0 | ocr-4.0 | 42/64/0 | 0 | ✓ | claude rate-limit (sauté); recall 71->72, publié 42->64 |
| saint-marc-sur-richelieu | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-odilon-de-cranbourne | — | 52 | 46 | 52 | claude-4.8 | 0/0/130 | 52 | ✓ | recall 52->52, publié 0->130 |
| saint-ours | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| saint-polycarpe | — | 4 | 108 | 0 | ocr-4.0 | 0/3/0 | 0 | ✓ | recall 4->108, publié 0->3 |
| saint-roch-ouest | — | 1 | 4 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 1->4, publié 0->0 |
| saint-rosaire | — | 1 | 10 | 10 | claude-4.8 | 0/0/35 | 0 | ✓ | recall 1->10, publié 0->35 |
| saint-valerien-de-milton | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| sainte-clotilde-de-horton | — | 1 | 13 | 1 | ocr-4.0 | 0/4/1 | 0 | ✓ | recall 1->13, publié 0->4 |
| sainte-edwidge-de-clifton | — | 3 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| sainte-thecle | — | 6 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| sainte-victoire-de-sorel | 29 | 0 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | aucun gain strict (égalité) |
| scotstown | — | 14 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| scott | — | 4 | 103 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 4->103, publié 0->0 |
| senneville | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| shawinigan | — | 6 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| shefford | — | 7 | 7 | 0 | ocr-4.0 | 2/24/59 | 7 | ✓ | recall 7->7, publié 2->24 |
| stanstead--memphremagog | — | 49 | 70 | 0 | kept-existing | 16/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 16->0 |
| stanstead--memphremagog--2 | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| stratford | 50 | 49 | 39 | 39 | kept-existing | 14/54/125 | 39 |  | recall régresserait 49->39 |
| tres-saint-redempteur | — | 6 | 91 | 0 | ocr-4.0 | 0/3/0 | 0 | ✓ | recall 6->91, publié 0->3 |
| tring-jonction | — | 16 | 34 | 46 | claude-4.8 | 0/32/69 | 46 | ✓ | recall 16->46, publié 0->69 |
| ulverton | — | 7 | 172 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 7->172, publié 0->0 |
| val-alain | — | 6 | 0 | 0 | kept-existing | 3/0/0 | 0 |  | claude rate-limit (sauté); moins de 3 zones extraites |
| val-des-bois | — | 5 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 5->0 |
| val-des-lacs | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| val-joli | — | 2 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| val-racine | — | 4 | 35 | 35 | claude-4.8 | 0/20/59 | 0 | ✓ | recall 4->35, publié 0->59 |
| valcourt--le-val-saint-francois | — | 15 | 162 | 0 | kept-existing | 9/0/0 | 0 |  | claude rate-limit (sauté); payload régresserait 9->0 |
| vercheres | — | 8 | 118 | 0 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 8->118, publié 0->0 |
| waterville | — | 9 | 82 | 34 | ocr-4.0 | 0/4/170 | 0 | ✓ | recall 9->82, publié 0->4 |
| weedon | — | 8 | 20 | 0 | kept-existing | 2/0/0 | 0 |  | payload régresserait 2->0 |
