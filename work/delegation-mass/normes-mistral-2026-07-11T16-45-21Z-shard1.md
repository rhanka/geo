# NORMES via Mistral — shard 1/4 — 2026-07-11T16:45:21Z

## Portée

- Sélection: `coverage-matrix.json`, `zones.status == done`, `normes.status != done`, liste globale des slugs triée, `index % 4 == 1`.
- Productibles au départ: 78.
- Moteurs utilisés: Mistral OCR 4.0 et Mistral `document_annotation` (`mistral-schema`) seulement. Aucun GPT/Codex.
- Dépôts: parquet seulement pendant l'extraction, puis fusion explicite du manifeste.
- Budget OCR/schema estimé de ce shard: environ 2,38 USD; aucun slug n'a dépassé 1 USD.

## Résultat net

### Déposé

- `saint-gedeon-de-beauce`
  - source officielle: `https://www.st-gedeon-de-beauce.qc.ca/_files/ugd/d4d74a_14cd45e0795c4aacafc151e544d6cf75.pdf`
  - méthode: `ocr/mistral-schema`
  - pages: 122; coût schema: 0,366 USD, coût OCR préalable: 0,080 USD
  - 252 `zone_code` distincts, 55/55 codes SIG recoupés, `publishedFieldPct=2.5`
  - parquet: `registry/qc-zonage-norms/qc-zonage-norms-saint-gedeon-de-beauce.parquet`
  - manifeste fusionné: `normes.status=done`, `doneTrack=qc-zonage-norms-saint-gedeon-de-beauce`
  - join lots: 1 577 lots, 100 % assignés, 100 % match, 0 % sans normes
  - lots enrichis: 1 577 lots, `zone_code=100 %`, `norms=100 %`, dépôt réussi

### Rejets Mistral documentés

- `dosquet`: 2 codes extraits, overlap 0/34.
- `dupuy`: 3 codes extraits, overlap 0/41.
- `fugereville`: 0 zone.
- `denholm`: pages 1–80, 3 codes mais `publishedFieldPct=0`; pages 81–134, overlap 0/15. Le règlement officiel confirmé par SHA-256 renvoie à une annexe absente du PDF.
- `lassomption`: 91 codes numériques, overlap 0/359; `sig-recode` strict: 0 pont.
- `laverlochere-angliers`: 0 zone.
- `lery`: 0 zone; diagnostic local sans bande de codes.
- `mont-carmel`: 0 zone; diagnostic local sans bande de codes.
- `notre-dame-des-prairies`: OCR 0 zone; schema pages 94–110, 0 zone.
- `perce`: OCR 14 codes, overlap 8/194, mais `publishedFieldPct=0`; schema pages 219–223, 0 zone.
- `pont-rouge`: 12 pseudo-codes, overlap 0/77.
- `princeville`: 15 codes, overlap 0/116; schema pages 211–215, 0 zone.
- `saint-elzear-de-temiscouata`: 0 zone.
- `saint-edouard-de-fabre`: 0 zone.
- `saint-cyrille-de-lessard`: 0 zone.
- `saint-remi-de-tingwick`: schema 54 zones, `publishedFieldPct=39.4`, mais overlap 0/26.
- `trois-rivieres`: schema 3 catégories `I/J/R`, `publishedFieldPct=62.5`, mais overlap 0/1664.
- `valcourt--le-val-saint-francois--2`: schema 152 pages, 0 zone.
- `saint-joseph-de-coleraine`: 0 zone.
- `saint-lazare`: 0 zone.
- `saint-joseph-des-erables`: règlement officiel HTTP 200; 124 nombres de ligne, overlap 0/5; `sig-recode` strict: 0 pont.

Tous ces rejets ont laissé le parquet absent ou inchangé. Aucun gate n'a été contourné.

## Découverte et preuves d'échec

- Réemploi local prioritaire: tous les `work/zonage-plans/<slug>*` et `work/zonage-norms/<slug>/grille.pdf` du shard ont été inventoriés.
- Crawler registry, lot 1: 0/3 PDF confirmé (`courcelles-saint-evariste`, `grand-saint-esprit`, `denholm`).
- Crawler registry, lot 2: 0/2 PDF confirmé (`lefebvre`, `montmagny`).
- Crawler registry résiduel: 0/11 PDF confirmé.
- Crawl direct des domaines officiels MAMH du lot 1: source Denholm retrouvée et identité SHA-256 confirmée; aucun autre PDF grille.
- Crawl direct des 25 domaines officiels absents de la registry: un règlement de base plausible, `saint-joseph-des-erables`, confirmé HTTP 200 puis rejeté par les gates Mistral. Roxton-Falls et Saint-Pacôme ne publiaient que des amendements/plans dans les pages découvertes.
- `macamic`: le cache local est byte-identique à une réponse HTTP 404 HTML (`1014` octets), donc pas un PDF.
- Les autres slugs sans couple PDF/source officiel sont clos avec preuve `absent registry` plus crawl du domaine MAMH sans grille confirmée, ou site officiel injoignable dans la fenêtre bornée.

## Couverture du shard

- Lot 1: `authier-nord, berry, biencourt, champneuf, chazel, courcelles-saint-evariste, denholm, dosquet, dupuy, esprit-saint, fort-coulonge, fugereville, grand-saint-esprit, la-visitation-de-yamaska, lac-delage`.
- Lot 2: `lassomption, laverlochere-angliers, lefebvre, lery, lile-dorval, macamic, maria, mont-carmel, montmagny, namur, nedelec, normetal, notre-dame-des-prairies, palmarolle, perce`.
- Lot 3: `pohenegamook, pont-rouge, poularies, princeville, rapide-danseur, roxton-falls, saint-alphonse, saint-benjamin, saint-cyrille-de-lessard, saint-didace, saint-edouard-de-fabre, saint-eloi, saint-elzear-de-temiscouata, saint-eusebe, saint-fortunat`.
- Lot 4: `saint-gedeon-de-beauce, saint-honore-de-temiscouata, saint-ignace-de-loyola, saint-isidore--roussillon, saint-jacques-le-majeur-de-wolfestown, saint-jean-de-brebeuf, saint-jean-de-lile-dorleans, saint-joseph-de-coleraine, saint-joseph-des-erables, saint-julien, saint-lazare, saint-marc-du-lac-long, saint-marcellin, saint-michel-de-bellechasse, saint-pacome`.
- Lot 5: `saint-pie-de-guire, saint-pierre-de-la-riviere-du-sud, saint-remi-de-tingwick, saint-wenceslas, saint-zephirin-de-courval, sainte-anne-de-beaupre, sainte-anne-des-monts, sainte-aurelie, sainte-clotilde-de-beauce, sainte-euphemie-sur-riviere-du-sud, sainte-flavie, sainte-helene-de-mancebourg, sainte-marie-de-blandford, senneterre--la-vallee-de-lor, taschereau`.
- Lot 6: `trois-rivieres, valcourt--le-val-saint-francois--2, yamaska`.

## Incident non bloquant

- La fusion du manifeste a aussi vu un pseudo-slug `registry` sans clé correspondante (`failed=[registry]`); elle a néanmoins ajouté uniquement `saint-gedeon-de-beauce` et écrit un manifeste de 625 entrées.
