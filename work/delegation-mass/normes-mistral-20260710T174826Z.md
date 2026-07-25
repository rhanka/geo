# Normes Mistral shard 3/4 - 20260710T174826Z

Mission: traiter uniquement les slugs dont index trie % 4 == 3.

Contraintes respectees:
- extraction par Mistral uniquement: ocr-4.0, mistral-schema, ou route zoneheader Mistral/native;
- aucun GPT/codex utilise pour extraire des normes;
- depot parquet-only, puis merge manifeste;
- gates stricts: au moins 3 codes, overlap SIG non nul, publishedFieldPct non nul, verbatim-or-null.

## Resultat net

Depot ajoute:
- saint-nazaire-de-dorchester
  - route: zoneheader
  - methode: native-text/zoneheader
  - pages: 124..143
  - lignes normes: 20
  - zone_codes uniques: 20
  - overlap SIG: 20/20, recoup SIG 100%
  - publishedFieldPct: 50
  - parquet: registry/qc-zonage-norms/qc-zonage-norms-saint-nazaire-de-dorchester.parquet

Post-traitements:
- zonage-norms-manifest-merge --apply: ajoute saint-nazaire-de-dorchester au manifeste.
- lot-zone-join-run: 536 lots, assigned 99.81%, match normes 100%, without_norms 0%.
- lots-enriched-run: 536 lots, norms 99.81%, surface 100%, code_postal 100%, adresse 86.19%.

## Lots parcourus

Selection shard:
- 76 cibles productibles zones=done et normes!=done.
- Les lots ont ete repioches par blocs tries de 15, plus le dernier slug.

Decouverte:
- crawler 2-hop lance sur le lot 1: 4 munis registry, 0 PDF grille confirme.
- crawler 2-hop lance sur le lot 2: Pierreville et Parisville; Pierreville confirme uniquement des amendements/plans rejetes comme non-grille, Parisville sans grille confirmee.
- Pour les petites municipalites hors registry, aucune URL n'a ete inventee; les PDF locaux existants ont ete privilegies.

## Echecs de gate principaux

- belleterre: OCR 58 pages, 0 zone extraite.
- kinnears-mills: 4 codes extraits, overlap SIG 0.
- dunham: auto-grid pages 174..178, Mistral 500, pas de depot.
- la-guadeloupe: 13 codes, overlap 1, publishedFieldPct 0.
- lac-megantic: fichier local grille.pdf est HTML, pas PDF.
- notre-dame-du-nord: 3 codes, overlap SIG 0.
- pierreville: PDF court/amendement, 0 zone.
- parisville: 222 pages, fenetre par defaut 1..80, 0 zone.
- notre-dame-du-bon-conseil--drummond: 0 zone.
- notre-dame-de-stanbridge: plan 1 page, 0 zone.
- saint-camille: 0 zone.
- saint-damien-de-buckland: fenetre normes 132..205 detectee; OCR lit MIN/MAX comme codes, zoneheader ne trouve aucun en-tete natif.
- saint-felix-de-kingsey: fenetre faible 117..119, 0 zone sur passe ciblee.
- saint-anaclet-de-lessard: schema Mistral lit 13 codes et overlap 4, mais publishedFieldPct 0.
- saint-lin-laurentides: schema Mistral 8 codes, overlap SIG 0, publishedFieldPct 0.
- saint-guillaume: fenetre 26..29, zoneheader 0 zone.
- saint-jude: schema 0 zone sur 56..59; zoneheader 1 code sur 150..152, overlap 0.
- saint-simon-de-rimouski: 32 zones natives, overlap SIG 0.
- saint-romain: fenetre 140..142, 0 zone.
- westbury: fenetre 60..62, 0 zone.
- sainte-anne-de-sorel: fenetre 26..29, 0 zone.
- wotton: fenetre 38..40, 0 zone.

Budget Mistral consomme estime: environ 0.64 USD, aucun slug au-dessus de 1 USD.

## Notes

Les gates ont evite plusieurs faux positifs: codes OCR sans normes, overlap SIG nul, ou fichiers qui etaient des plans/amendements au lieu de la grille dimensionnelle. Le depot utile du shard est saint-nazaire-de-dorchester; il est maintenant merge dans le manifeste et replie dans les lots enrichis.
