# Normes Mistral — shard 1/4 — 2026-07-11T112329Z

Périmètre strict : municipalités productibles de `coverage-matrix.json` dont l'index dans la liste triée vérifie `index % 4 == 1`. Six lots successifs ont couvert le résidu du shard. Extraction exclusivement Mistral (`mistral-ocr-4-0` puis `mistral-schema`/`document_annotation` pour les grilles transposées), budget inférieur à 1 USD par ville, dépôts parquet-only.

## Dépôt net

| slug | moteur | zone_codes | overlap SIG | publishedFieldPct | coût Schema | résultat |
|---|---|---:|---:|---:|---:|---|
| duhamel-ouest | `ocr/mistral-schema` | 16 | 1/31 | 10,9% | 0,201 USD | déposé |

Produit : `registry/qc-zonage-norms/qc-zonage-norms-duhamel-ouest.parquet`.

La fusion du manifeste est passée de 614 à 616 entrées et a ajouté `duhamel-ouest` ainsi qu'un parquet concurrent déjà présent (`saint-charles-de-bellechasse`). Une clé parasite `registry` était absente et a été rapportée sans bloquer la fusion.

Post-traitements Duhamel-Ouest :

- `lot-zone-join-run` : 973 lots, zones assignées 100%, match normes 0,21%, 99,79% sans normes; vérifications parquet/stats OK.
- `lots-enriched-run` : 973 lots, `zone_code` 100%, normes 0,21%, surface 100%, code postal 100%, adresse 94,45%; dépôt OK.

La couverture de normes très faible est conservée explicitement : elle découle de l'unique code recoupé et n'est pas présentée comme une couverture municipale complète.

## Rejets avec preuve de gate

| slug | preuve principale |
|---|---|
| denholm | OCR : 3 codes, overlap 1, `publishedFieldPct=0`; Schema pages 91–95 : 0 code |
| dosquet | OCR : 2 codes, overlap 0; Schema : 32 codes et 70,3% de champs, mais overlap 0 |
| fugereville | Schema : 14 codes, overlap 5, `publishedFieldPct=0` |
| lassomption | OCR : 91 codes, overlap 0; pont numérique sans correspondance; Schema : overlap 0 |
| lery | 0 zone OCR; aucune fenêtre de grille dimensionnelle localisée |
| mont-carmel | 0 zone OCR; aucune fenêtre de grille dimensionnelle localisée |
| perce | OCR : 14 codes, overlap 8, `publishedFieldPct=0`; Schema : 0 code |
| pont-rouge | 12 pseudo-codes, overlap 0 |
| princeville | 15 codes, overlap 0 |
| saint-didace | 0 zone OCR |
| saint-elzear-de-temiscouata | 0 zone OCR |
| saint-gedeon-de-beauce | OCR : 49 codes, overlap 48, `publishedFieldPct=0`; deux fenêtres Schema : overlap 22, champs 0% |
| saint-joseph-de-coleraine | 0 zone OCR |
| saint-remi-de-tingwick | 67 codes, overlap 0 |
| sainte-monique--nicolet-yamaska | OCR échoué par dépassement `maxBuffer`, 0 zone |
| trois-rivieres | Schema : 1 code réel, overlap 1, champs 62,5%, rejet strict `<3 codes` |
| valcourt--le-val-saint-francois--2 | PDF direct : overlap 7 en OCR et Schema, mais `publishedFieldPct=0` |

Autres documents écartés sans extraction : `macamic` confirmé HTTP 404 avec corps HTML de 1 014 octets; `saint-alphonse` était un faux hit de préfixe vers Saint-Alphonse-Rodriguez; `saint-benjamin`, `saint-lazare`, `sainte-anne-de-beaupre`, `sainte-aurelie` et `sainte-flavie` n'avaient pas de provenance officielle exploitable.

## Découverte et résidu

Le crawler 2-hop, isolé dans `work/zonage-norms/discovered-shard-1of4-20260711-batch1.json`, ne connaissait que Courcelles-Saint-Évariste et Grand-Saint-Esprit dans ce lot et n'a confirmé aucune grille. Les portails MRC Témiscamingue ont fourni les règlements déjà staged de Duhamel-Ouest et Fugèreville. Denholm a été résolu sur le site municipal : le PDF officiel téléchargé est byte-identique au fichier local (SHA-256 `f538369690c408cc838968062d8a48aaa5616db22d199efa0c2ff2e7698b953b`).

Les six inventaires successifs ont examiné l'ensemble du résidu trié du shard. Les villes restantes sans PDF local officiel confirmé ont été classées « découverte sans source productible »; aucune URL ni valeur n'a été inventée.

Coût Mistral observé de cette passe : environ 1,7 USD au total; aucune ville n'a dépassé 1 USD ni 6 minutes.
