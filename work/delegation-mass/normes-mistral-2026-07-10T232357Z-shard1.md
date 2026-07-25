# Normes Mistral - shard 1/4 - 2026-07-10T232357Z

Contexte: slugs productibles coverage-matrix avec zones.status=done et normes.status!=done, filtre index % 4 == 1. Extraction uniquement via Mistral OCR route ocr, budget <= 1 USD par ville, depots parquet-only puis merge manifest.

## Depot net

| slug | depot | moteur | rows | unique zone_codes | overlap SIG | publishedFieldPct | cout OCR |
|---|---:|---|---:|---:|---:|---:|---:|
| saint-cyrille-de-wendover | oui | ocr/mistral-ocr | 49 | 49 | 16/17 | 13 | 0.012 USD |

Produit S3: registry/qc-zonage-norms/qc-zonage-norms-saint-cyrille-de-wendover.parquet.

Manifest merge: manifest 598 -> 599, added=1, dropped=0. Note: une entree parasite registry a echoue en lecture, sans bloquer le merge.

Post-traitements:

| slug | lot-zone-join | lots-enriched |
|---|---|---|
| saint-cyrille-de-wendover | OK, 2842 lots, assigned=99.89%, match=99.96%, without_norms=0.04% | OK, 2842 lots, zone_code=99.89%, norms=99.86%, surface=100%, code_postal=100%, adresse=90.15% |

## Extractions tentees sans depot

| slug | preuve gate / resultat |
|---|---|
| adstock | 80 pages OCR, 0 zone extraite |
| esterel | auto-grid 19..53, 35 pages OCR, 0 zone extraite |
| gatineau | 1 code reel, rejet < 3 zone_codes |
| grosse-ile | 2 codes, overlap=0 vs 39 codes SIG, rejet anti-invention |
| la-guadeloupe | 13 codes, overlap=1, publishedFieldPct=0, rejet |
| lac-des-plages | 1 page OCR, 0 zone extraite |
| lepiphanie | PDF local illisible par pdftotext; seed officiel HTTP 200 mais runner skip, pas de remplacement fiable |
| lile-danticosti | 13 codes, overlap=1, publishedFieldPct=0, rejet |
| namur | 27 pages OCR, 0 zone extraite |
| notre-dame-du-nord | 3 codes, overlap=0 vs 107 codes SIG, rejet |
| papineauville | 7 codes OCR garbage, overlap=0 vs 56 codes SIG, rejet |
| pierreville | 2 pages OCR, 0 zone extraite |
| ripon | 1003 codes, overlap SIG complet, publishedFieldPct=0, rejet |
| saint-alphonse-de-granby | auto-grid 152..158, 0 zone extraite |
| saint-damien-de-buckland | 4 codes, overlap=3, publishedFieldPct=0, rejet |
| saint-guillaume | fenetre 27..28, 0 zone extraite |
| saint-jude | page 73, 0 zone extraite |
| saint-paul-de-montminy | 3 codes, overlap=0 vs 79 codes SIG, rejet |
| saint-simon-de-rimouski | pages 1..32, 0 zone extraite |
| saint-ulric | 4 codes, overlap=1, publishedFieldPct=0, rejet |
| sainte-anne-de-beaupre | 143 codes, sig=0, publishedFieldPct=0, rejet |
| sainte-helene-de-bagot | 2 pages OCR, 0 zone extraite |
| sainte-rose-de-watford | 1 page OCR, 0 zone extraite |
| valcourt--le-val-saint-francois--2 | pages 1..18, 0 zone extraite |
| ragueneau | 80 pages OCR, 0 zone extraite |
| saint-anaclet-de-lessard | 80 pages OCR, 0 zone extraite |
| saint-emile-de-suffolk | 10 codes, overlap=7, publishedFieldPct=0, rejet |
| saint-lin-laurentides | pages 121..141, 0 zone extraite |
| sainte-anne-de-sorel | 80 pages OCR, 0 zone extraite |
| sainte-lucie-de-beauregard | OCR API 400 fichier expire, 0 zone extraite |
| lorrainville | PDF officiel telecharge, 57 pages OCR, 0 zone extraite |

## Decouverte

PDFs confirmes et telecharges par seed:

| slug | source |
|---|---|
| lorrainville | https://www.mrctemiscamingue.org/app/uploads/2024/01/lorrainville-reglement-de-zonage.pdf |
| saint-cyrille-de-wendover | https://stcyrille.qc.ca/wp-content/uploads/bsk-pdf-manager/2025/12/Reglement-437-Grilles-usagesNotes-2025-12-04-AMENDEE.pdf |

Seed echec:

| slug | preuve |
|---|---|
| saint-rene-de-matane | HTTP 404 sur URL connue |

Crawler PV / residual:

| slug | preuve |
|---|---|
| dundee | no confirmed grille PDF |
| elgin | no confirmed grille PDF |
| courcelles-saint-evariste | no confirmed grille PDF |
| saint-cleophas-de-brandon | no confirmed grille PDF |
| warden | no confirmed grille PDF |
| saint-zephirin-de-courval | no confirmed grille PDF |
| sainte-monique--nicolet-yamaska | passe coupee par timeout global avant confirmation |

Conclusion: 1 depot net Mistral sur le shard, post-traitements faits. Les autres PDFs/productibles traites ont ete bloques par les gates stricts, principalement 0 zone extraite, overlap SIG nul, ou publishedFieldPct=0.
