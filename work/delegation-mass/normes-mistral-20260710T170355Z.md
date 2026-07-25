# Rapport normes Mistral - shard 0/4 - 20260710T170355Z

## Contexte

- Branche: feat/cadre-acquisition
- Shard: 0/4, seulement les slugs dont index trie modulo 4 vaut 0.
- Cible: coverage-matrix, villes avec zones.status=done et normes.status!=done.
- Moteur utilise: Mistral uniquement. Routes executees: mistral-ocr-4.0, mistral-vision, mistral-schema.
- Budget: max 1 USD par ville. Depense estimee du lot: environ 0.39 USD.
- Spec lue: docs/spec/normes-extraction-retenu.md.

## Supervision initiale

- SCOREBOARD /1106: pv=1057, normes=588, zones=803, cadastre=1106, role-foncier=1106, tod=39.
- PROVENANCE NORMES: 323 villes, deposes=43, OCR environ 27.290 USD.
- Focus-30 zonage: servi 29/30, manquant lile-dorval.

## Depots nets

### saint-bruno-de-kamouraska

- Source: work/zonage-norms/saint-bruno-de-kamouraska/grille.pdf.
- Route: mistral-vision, pages 227..249, no-manifest.
- Depot: registry/qc-zonage-norms/qc-zonage-norms-saint-bruno-de-kamouraska.parquet.
- Lignes: 22.
- Codes uniques: 22.
- publishedFieldPct: 47.7.
- Crossval: grid=true, sig=17, extracted=22, overlap=17, recoupSig=100%, recoupExtracted=77%.
- Cout estime vision: 0.06624 USD.
- Post-depot: lot-zone-join OK, lots=1552, assigned=100%, match=100%, without_norms=0%; lots-enriched OK, norms=100%, surface=100%, adresse=90.66%.

### saint-edouard

- Source: work/zonage-norms/saint-edouard/grille.pdf.
- Route: mistral-vision, pages 28..50, no-manifest.
- Depot: registry/qc-zonage-norms/qc-zonage-norms-saint-edouard.parquet.
- Lignes: 22.
- Codes uniques: 22.
- publishedFieldPct: 72.7.
- Crossval: grid=false, sig=0, extracted=22. Gate SIG non applicable car aucun code SIG trouve.
- Cout estime vision: 0.06624 USD.
- Post-depot: manifest merge a ajoute saint-edouard; lot-zone-join a saute saint-edouard car zones introuvables sous normalized/ca-qc-zonage.

## Manifest et enrichissement

- zonage-norms-manifest-merge --apply: manifest entries=592, parquet slugs=594, new=2, addedToManifest=1, manifestAfter=593.
- Ajoute au manifest: saint-edouard.
- Echec merge restant: registry, cle indiquee inexistante par le registre.
- saint-bruno-de-kamouraska n'apparait pas dans la liste addedSlugs du merge, mais le parquet distant est exploitable: lot-zone-join puis lots-enriched ont reussi sur ce slug.

## Echecs et preuves de gate

- saint-cyprien-de-napierville: OCR page 81 puis vision page 81 sur le reglement officiel; 0 zone extraite, pas de depot.
- notre-dame-du-bon-conseil--drummond--2: OCR pages 1..44; 0 zone, pas de depot.
- normandin: OCR auto-grid sur pages 169..209; 0 zone, pas de depot.
- sainte-perpetue--nicolet-yamaska: OCR pages 125..128 interrompu par maxBuffer; pas de depot.
- saint-pierre-de-broughton: OCR reglement complet pages 1..80; 0 zone, pas de depot.
- saint-damase--les-maskoutains: OCR 0 zone; vision 32 zones, mais overlap SIG=0 contre 44 codes SIG, rejet anti-invention.
- lascension-de-patapedia: OCR puis vision page 21; 0 zone, pas de depot.
- bedford--brome-missisquoi--2: OCR pages 58..60, schema Mistral pages 58..60 puis page 83; distinctZones=0, gate fail.
- saint-jean-de-la-lande: vision pages 57..60; 0 zone, pas de depot.
- gatineau: vision pages 1..2; 1 code unique, overlap=1, rejet car moins de 3 zone_codes reels.

## Decouverte et prochains leviers

- Le crawler avec download, route-guess et 2hop a ete lance sur le premier lot shard 0; il n'a pas produit de manifest avant timeout. Aucun PDF grille confirme pour abercorn, east-broughton, gatineau ou barnston-ouest durant ce passage.
- Les meilleurs candidats restants sont ceux avec PDF local deja present et fenetre detectee par probe: saint-edouard et saint-bruno ont ete traites; bedford et saint-jean-de-la-lande demandent une extraction image plus ciblee; les autres echecs exigent de retrouver l'annexe grille exacte plutot que le reglement general.
- Aucun depot GPT/Codex n'a ete effectue.
