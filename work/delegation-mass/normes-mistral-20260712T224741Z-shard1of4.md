# Normes Mistral — shard 1/4 — 2026-07-12

## Périmètre et moteur

- Sélection déterministe : coverage-matrix.json, zones.status=done et normes.status!=done, liste triée, index modulo 4 égal à 1.
- Sélection initiale : 64 candidats frais. Plusieurs lots ont été repiochés avec le même sélecteur; aucune cible des autres shards n’a été traitée.
- Supervision loop-supervise exécutée avant le premier lot et entre les lots.
- Moteurs payants utilisés exclusivement : Mistral OCR-4.0 et Mistral document_annotation via mistral-schema.
- Aucun GPT-5.5, Codex ou moteur Claude utilisé pour l’extraction.
- Tous les dépôts sont parquet-only; réconciliation par zonage-norms-manifest-merge.ts --apply.

## Dépôts validés

1. berry
   - Source : règlement de zonage 149, PDF officiel confirmé.
   - Pages Mistral schema : 147–180.
   - 34 codes réels, overlap SIG 33, publishedFieldPct 36,8 %.
   - Dépôt : registry/qc-zonage-norms/qc-zonage-norms-berry.parquet.
   - lot-zone-join : 194 lots, 100 % assignés, 100 % avec normes.
   - lots-enriched : 194 lots, zone_code 100 %, normes 100 %.

2. lac-delage
   - Source : annexe B officielle, document xJlPZ8JQyS du portail municipal.
   - Pages Mistral schema : 1–30, une grille par page.
   - 30 codes réels, overlap SIG 30, publishedFieldPct 22,1 %.
   - Dépôt : registry/qc-zonage-norms/qc-zonage-norms-lac-delage.parquet.
   - lot-zone-join : 436 lots, 100 % assignés, 100 % avec normes.
   - lots-enriched : 436 lots, zone_code 100 %, normes 100 %.

3. montmagny
   - Source : règlement 1100, grille des spécifications officielle.
   - Pages Mistral schema validées : 1–4; tentative plus large refusée silencieusement par le format Mistral.
   - Dépôt retenu : 5 codes réels, overlap SIG 3, publishedFieldPct 10 %; deux codes hors SIG conservés verbatim mais non utilisés pour l’overlap.
   - Dépôt : registry/qc-zonage-norms/qc-zonage-norms-montmagny.parquet.
   - lot-zone-join : 6 626 lots, 100 % assignés, 2,67 % avec normes; avertissement de couverture basse conservé.
   - lots-enriched : 6 626 lots, zone_code 100 %, normes 2,67 %.

## Échecs documentés, aucun dépôt

- courcelles-saint-evariste : PDF officiel de 159 pages sans feuillets de grille; OCR pages 1–80 puis auto-grid n’a produit aucune zone. La grille annoncée en annexe n’est pas incluse dans le PDF.
- lassomption : OCR plein document a produit 91 codes avec overlap SIG 0; document_annotation pages-image 3–4 a produit 0 code. Rejet anti-invention.
- authier-nord : le PDF trouvé est celui d’Authier, pas Authier-Nord; document_annotation pages 135–137 a produit 5 codes, overlap SIG 0 et publishedFieldPct 0. Rejet.
- la-visitation-de-yamaska : PDF officiel de 20 pages-image; document_annotation a produit 0 code. Rejet sous le seuil de 3 codes.
- esprit-saint : URL MRC officielle découverte mais téléchargement normal échoué; récupération TLS de secours a renvoyé une page HTML de 3 087 octets, non PDF. Aucun feed Mistral effectué.
- macamic : artefact local de 1 014 octets sans signature PDF; non traité.
- pont-rouge : document_annotation de l’annexe 2 page 216 a produit 52 codes, overlap SIG 0, publishedFieldPct 0. Rejet.
- princeville : document_annotation des pages 293–294 a produit 0 code. Rejet sous le seuil.
- saint-elzear-de-temiscouata : document_annotation pages 57–58 a produit 0 code. Rejet sous le seuil.
- notre-dame-des-prairies : document_annotation pages 571–575 a produit 5 codes, publishedFieldPct 85 %, mais overlap SIG 0. Rejet.
- Montmagny, tentative pages 1–333 puis 1–8 : aucune écriture parquet détectée; la tentative minimale pages 1–4 est la seule retenue et passée par les gates.
- Le crawler registry 2-hop sur le premier lot n’a confirmé aucun PDF; il n’a visité que Lefebvre, Courcelles-Saint-Évariste et Grand-Saint-Esprit. Les recherches MRC/municipales ont donc été utilisées comme fallback.

## Réconciliation et état

- Les merges ont écrit les entrées Berry, Lac-Delage et Montmagny; l’erreur registry « The specified key does not exist » est externe aux dépôts ajoutés et a été conservée dans la sortie du merge.
- Les fichiers .claude et .track, ainsi que les modifications préexistantes, n’ont pas été touchés.
- Les cibles restées sans dépôt demeurent éligibles dans la matrice si leur statut normes n’est pas passé à done; elles constituent le backlog du prochain passage shard 1/4.
