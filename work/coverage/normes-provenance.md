# Registre de provenance — normes 2-moteurs (keep-best)

_Généré 2026-06-29T11:00:54.727Z — 12 villes._

**Gagnants:** OCR-4.0 = 1 · Claude-4.8 = 0 · existant gardé = 10 · déposés (apply) = 1

Recall = recoupement SIG si grille SIG dispo, sinon nb de zone_codes distincts. Anti-invention: garde `buildVisionField` partagée (verbatim ou null) → invention_ok partout.

| ville | grilleSIG | recall exist | recall OCR | recall Claude | gagnant | publié e/O/C | sig_ovlp | déposé | raison garde |
|---|---|---|---|---|---|---|---|---|---|
| austin | — | 9 | 16 | 3 | ocr-4.0 | 0/0/0 | 0 | ✓ | recall 9->16, publié 0->0 |
| ayers-cliff | — | 4 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 4->0 |
| beauceville | — | 3 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 3->0 |
| brigham | — | 7 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| bromont | — | 5 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | recall régresserait 5->0 |
| cap-saint-ignace | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| chateauguay | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| cheneville | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| hatley-township-municipality | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| havelock | — | 1 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
| hemmingford--les-jardins-de-napierville--2 | 38 | 0 | 0 | 0 | error | 0/0/0 | 0 |  | fetch failed |
| inverness | — | 8 | 0 | 0 | kept-existing | 0/0/0 | 0 |  | moins de 3 zones extraites |
