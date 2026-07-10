# Normes Mistral - shard 1/4 - 2026-07-10T16:55:17Z

Shard applique: slugs dont index trie modulo 4 egale 1.

## Depots nets

- grosses-roches
  - Source: https://www.municipalite.grossesroches.ca/images/Upload/Files/Permis/GR_307_zonage_grilles_320_22-09-2016.pdf
  - Moteur: Mistral OCR, route ocr, parquet-only
  - Resultat: depose registry/qc-zonage-norms/qc-zonage-norms-grosses-roches.parquet
  - Gates: 37 zones, SIG 38, overlap 37, publishedFieldPct 49.7, cout 0.001 USD
  - Suite: manifest merge applique; lot-zone-join OK 790 lots, assignes 100 %, match 99.37 %; lots-enriched OK, normes 99.37 %

- lac-drolet
  - Source: https://lacdrolet.ca/download/grille-de-specification-annexe-reglement-491-sur-le-zonage/?wpdmdl=8208
  - Moteur: Mistral route ocr avec texte natif grille-native-first, parquet-only
  - Resultat: depose registry/qc-zonage-norms/qc-zonage-norms-lac-drolet.parquet
  - Gates: 59 zones, SIG 70, overlap 52, publishedFieldPct 12.5, cout 0 USD
  - Suite: manifest merge applique; lot-zone-join OK 1242 lots, assignes 99.68 %, match 75.85 % avec avertissement; lots-enriched OK, normes 75.6 %

## Echecs gates ou non productibles

- duhamel-ouest: reglement officiel MRC Temiscamingue, Mistral OCR 67 pages, 0 zones extraites, pas de depot.
- fugereville: reglement officiel MRC Temiscamingue, Mistral OCR 55 pages, 0 zones extraites, pas de depot.
- denholm: reglement officiel municipal 2025, Mistral OCR 80 pages, 3 zones et overlap 1, mais publishedFieldPct 0, rejet gate, pas de depot.
- biencourt: reglement officiel municipal, Mistral OCR 80 pages, 0 zones extraites, pas de depot.
- adstock: PDF de reglement de zonage accessible. OCR pages 1-80: 0 zones. OCR pages 260-285: 8 codes, overlap 0. Mistral schema pages 260-285: 76 codes, publishedFieldPct 40.8, overlap 0. Rejet gate, pas de depot.
- fermont: PDF officiel MRC Caniapiscau normes-durbanisme-2018-1.pdf inspecte; brochure generale, pas une grille par zone, pas d'extraction.
- frontenac: page urbanisme officielle inspectee; formulaires seulement, pas de grille trouvee.
- lepiphanie: page urbanisme officielle inspectee; sections reglement de zonage indiquees A VENIR, pas de grille exploitable.
- caplan, chute-aux-outardes, beaulac-garthby, marieville: pas de source officielle PDF/grille trouvee dans les sondes rapides de ce passage.

## Decouverte

- Lot 1 initial: authier-nord, berry, biencourt, champneuf, chazel, courcelles-saint-evariste, denholm, dosquet, duhamel-ouest, dupuy, esprit-saint, fort-coulonge, fugereville, grand-saint-esprit, grosses-roches.
- Crawler fallback lot 1: registry limitee a courcelles-saint-evariste, grand-saint-esprit, denholm, dosquet; 0 PDF grille confirme.
- Lot 2: adstock, beaulac-garthby, caplan, chute-aux-outardes, dundee, elgin, fermont, frontenac, godbout, guerin, irlande, la-pocatiere, la-visitation-de-lile-dupas, lac-drolet, landrienne.
- Crawler fallback lot 2: dundee sans PDF grille confirme; passage interrompu sur elgin apres stagnation, car fallback non productif.
- Note manifeste: la premiere fusion a aussi reconstruit la-macaza et notre-dame-de-pontmain depuis des parquets preexistants. Ces slugs ne sont pas comptes comme depots de ce shard.

## Cout Mistral observe

- grosses-roches: 0.001 USD
- duhamel-ouest: 0.067 USD
- fugereville: 0.055 USD
- denholm: 0.080 USD
- biencourt: 0.080 USD
- adstock: 0.080 + 0.026 + 0.078 USD
- lac-drolet: 0 USD

Total observe sur ce passage: environ 0.467 USD.
