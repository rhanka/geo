# NORMES via MISTRAL — shard 3/4 — 2026-07-12

## Périmètre et provenance

- Sélection déterministe: coverage-matrix.json, zones.status=done, normes.status!=done, liste triée, index modulo 4 = 3.
- Supervision loop-supervise exécutée au démarrage et entre les lots.
- Norme de référence lue: docs/spec/normes-extraction-retenu.md.
- Moteurs utilisés uniquement: Mistral OCR-4.0 et Mistral document_annotation via mistral-schema. Aucun GPT-5.5/Codex d’extraction.
- Dépôts tentés en Parquet-only, sans écriture de manifeste pendant les extractions. Budget maximal par ville et par exécution: 1 USD.
- Garde-fous: au moins 3 zone_codes, overlap SIG non nul, publishedFieldPct non nul, valeurs verbatim ou null.

## Résultat net

| slug | moteur | codes distincts | overlap SIG | publishedFieldPct | résultat |
|---|---|---:|---:|---:|---|
| trecesson | Mistral document_annotation | 71 | 62 | 42.3% | DÉPOSÉ Parquet |

Dépôt: registry/qc-zonage-norms/qc-zonage-norms-trecesson.parquet. Le manifeste a été fusionné avec --apply sans perte d’entrées: 656 → 657, 1 entrée ajoutée, 0 supprimée. Un artefact S3 existant nommé registry a été signalé absent par le merge et laissé intact.

Post-traitement trecesson effectué:

- lot-zone-join-run: 741 lots, assigned 100%, match normes 100%, without_norms 0%, Parquet vérifié.
- lots-enriched-run: 741 lots, zone_code 100%, normes 100%, surface 100%, dépôt vérifié.

## Lots et preuves

### Lot 1 — 15 slugs

aston-jonction, beaulac-garthby, belleterre, cascapedia-saint-jules, dunham, fermont, grand-metis, honfleur, irlande, kinnears-mills, la-guadeloupe, la-redemption, lac-megantic, landrienne, launay.

- beaulac-garthby: OCR 0 zone; schema 23 zones, publishedFieldPct 17.9%, overlap 0/91 — rejet anti-invention.
- belleterre: OCR 0 zone; schema 16 zones, publishedFieldPct 32%, overlap 0/29 — rejet anti-invention.
- fermont: OCR 0 zone; schema 0 zone — gate nombre de codes.
- kinnears-mills: OCR 0 zone; schema 8 zones, publishedFieldPct 0%, overlap 0/67 — rejet.
- aston-jonction: règlement 218 schema 2 codes, gate nombre; règlement 200 schema 8 codes, publishedFieldPct 0%, overlap 0/19.
- cascapedia-saint-jules, grand-metis, honfleur, irlande, la-guadeloupe, la-redemption, lac-megantic, landrienne, launay: aucune grille PDF confirmée; inventaire/crawl et pages officielles sans lien PDF de grille exploitable. Dunham: crawl 2-hop, aucune grille PDF confirmée.

### Lot 2 — 15 slugs

les-hauteurs, manseau, marieville, moffet, montreal, new-carlisle, notre-dame-de-stanbridge, notre-dame-du-nord, parisville, pierreville, saint-adrien-dirlande, saint-alexandre-de-kamouraska, saint-anaclet-de-lessard, saint-bruno-de-guigues, saint-camille.

- OCR batch Mistral exécuté pour moffet, new-carlisle, notre-dame-de-stanbridge, notre-dame-du-nord, pierreville, saint-alexandre-de-kamouraska, saint-anaclet-de-lessard, saint-camille: 0 zones sauf new-carlisle (4 codes, overlap 4, publishedFieldPct 0%) — aucun dépôt.
- Schema Mistral exécuté pour ces 8 slugs: moffet overlap 0/10; new-carlisle overlap 0/46; notre-dame-de-stanbridge 0 code; notre-dame-du-nord 0 code; pierreville 0 code; saint-alexandre 0 code; saint-anaclet 0 code; saint-camille 0 code.
- Parisville: OCR 0 zone; schema 345 zones mais overlap 0/24 — rejet anti-invention.
- saint-bruno-de-guigues: OCR 0 zone; schema 15 zones, publishedFieldPct 0%, overlap 1/30 — rejet.
- les-hauteurs, manseau, marieville, montreal, saint-adrien-dirlande: aucun PDF local ou officiel confirmé dans les niveaux découverte exécutés.

### Lot 3 — 15 slugs

saint-celestin--nicolet-yamaska--2, saint-cleophas-de-brandon, saint-dominique-du-rosaire, saint-edmond-les-plaines, saint-elzear--bonaventure, saint-ephrem-de-beauce, saint-felix-de-kingsey, saint-francois-de-la-riviere-du-sud, saint-gabriel, saint-guillaume, saint-honore, saint-jean-de-dieu, saint-juste-du-lac, saint-leonard-daston, saint-lin-laurentides.

- saint-guillaume: OCR 0 zone sur la fenêtre 27..28; schema 0 code.
- saint-lin-laurentides: OCR 0 zone sur 121..141; schema 8 zones, overlap 0/115 — rejet.
- saint-felix-de-kingsey: OCR 7 codes non réglementaires, overlap 0; schema 25 zones, publishedFieldPct 55%, overlap 0/8 — rejet.
- saint-juste-du-lac: OCR maxBuffer; schema 2 codes, overlap 0/30 — gate nombre.
- saint-honore: PDFs locaux uniquement plans de zonage; la source officielle expose les grilles en XLSX, non alimentées par cette lane PDF Mistral.
- Les 10 autres slugs: inventaire sans PDF de grille confirmé.

### Lot 4 — 15 slugs

saint-louis-de-gonzague--les-etchemins, saint-marcel, saint-medard, saint-michel-du-squatec, saint-philippe-de-neri, saint-pierre-de-lile-dorleans, saint-rene-de-matane, saint-romain, saint-simon-de-rimouski, saint-sylvestre, saint-theophile, sainte-anne-de-sorel, sainte-germaine-boule, shigawake, trecesson.

- saint-simon-de-rimouski: OCR 0 zone; schema 32 zones, publishedFieldPct 48%, overlap 0/43 — rejet.
- sainte-anne-de-sorel: OCR 0 zone; schema 0 code.
- trecesson: OCR 3 codes OCR parasites, overlap 0; schema 71 codes, overlap 62/62, publishedFieldPct 42.3% — dépôt réussi.
- saint-pierre-de-lile-dorleans: artefact local plan de zonage, non grille de normes.
- Les autres slugs: aucun PDF de grille confirmé.

### Finalisation shard courant — 4 slugs

trois-pistoles, val-saint-gilles, westbury, wotton.

- westbury: OCR 0 zone sur page 61; schema complet 1 code, publishedFieldPct 37.5%, overlap 0/47 — rejet.
- wotton: OCR 0 zone; schema 2 codes, publishedFieldPct 0%, overlap 1/58 — gate nombre.
- trois-pistoles: artefact local de 3 KB identifié comme HTML, pas PDF; aucune alimentation Mistral.
- val-saint-gilles: aucun PDF local ou officiel confirmé.

## État final

- 1 dépôt Mistral net: trecesson.
- Tous les dépôts refusés ont conservé la preuve du gate bloquant; aucune valeur non verbatim n’a été publiée.
- Aucun fichier secret, .claude ou .track modifié par cette lane.
