# Normes Mistral — shard 2/4 — 2026-07-12

## Périmètre

Sélection déterministe exécutée avec `n=4`, `shard=2` : slugs triés dont
`index % 4 == 2`, et seulement `zones.status=done` / `normes.status!=done`.
La sélection initiale comptait 43 cibles; une progression concurrente l'a
ramenée à 42 avant traitement. Les 42 cibles de trois lots ont été éprouvées,
sans moteur GPT/codex.

Routes utilisées : Mistral OCR (`route=ocr`, `--auto-grid-page`,
`--budget-usd 1`, parquet-only), puis Mistral `document_annotation`
(`engine=mistral-schema`) pour les PDFs transposés/scannés ou rejetés par la
première route. Les gates appliqués sont : au moins 3 codes, overlap SIG non nul
lorsqu'une grille SIG existe, et `publishedFieldPct != 0`; toute valeur reste
verbatim ou null.

## Dépôts acceptés

- `saint-pierre` — Mistral schema, 110 pages, 14 codes, 79,5 % de champs
  publiés, SIG 11 codes, overlap 5; parquet déposé.
- `guerin` — Mistral schema, 55 pages, 17 codes, 30,9 % de champs publiés,
  SIG 17 codes, overlap 1; parquet déposé.

Les deux dépôts ont été fusionnés via `zonage-norms-manifest-merge.ts --apply`
avec `droppedStock=0`. Le listing global a signalé la clé technique
`registry` absente; elle n'a pas empêché les ajouts.

## Rafraîchissements post-dépôt

- `saint-pierre` : `lot-zone-join-run` OK, 21 322 lots, 1,26 % assignés,
  48,13 % de match zone; `lots-enriched-run` OK, 0,61 % de lots avec normes.
- `guerin` : `lot-zone-join-run` OK, 689 lots, 100 % assignés, 0,29 % de match
  zone; `lots-enriched-run` OK, 0,29 % de lots avec normes.

Les avertissements de faible couverture métier ont été conservés, sans élargir
les gates.

## Preuves d'échec / non-dépôt

- Lot 01 : `batiscan` PDF invalide pour `pdftotext`; `brebeuf`, `clerval`,
  `dundee`, `esterel`, `godbout`, `latulipe-et-gaboury`, `laval` et
  `martinville` n'ont pas produit de grille publiable; `lac-saint-joseph` a
  produit 12 codes mais 0 % de champs; `guerin` a d'abord échoué OCR puis a
  réussi via schema. `gallichan`, `lile-du-grand-calumet`, `pointe-a-la-croix`
  et `quebec` n'avaient pas de PDF local vérifié; le crawler borné n'a reconnu
  que `lile-du-grand-calumet` et a été interrompu avant émission d'un
  manifeste.
- Lot 02 : `ripon` et `saint-émile-de-suffolk` rejetés à 0 % de champs;
  `saint-augustin-de-desmaures` rejeté à overlap 0 (labels OCR);
  `saint-célestin--nicolet-yamaska`, `saint-godefroi` et `saint-pamphile`
  sans zone extraite. La voie schema a confirmé le rejet de saint-augustin;
  saint-pierre a été accepté. L'inventaire complémentaire a trouvé trois
  PDFs image-only pour `saint-ferdinand`; la première partie est restée sans
  réponse après environ cinq minutes et a été arrêtée avant la limite de six
  minutes, sans dépôt.
- Lot 03 : `saint-paul-de-montminy` rejeté à overlap 0;
  `saint-rené`, `saint-simon`, `sainte-anne-des-plaines` et
  `sainte-brigitte-des-saults` sans dépôt; `saint-venant-de-paquette` et
  `sainte-hélène-de-bagot` à 0 % de champs. La voie schema a confirmé ces
  gates. `saint-pierre-de-lamy`, `sainte-angèle-de-Mérici`,
  `sainte-Geneviève-de-Berthier` et `sainte-Madeleine` n'avaient pas de PDF
  local vérifié.

## État final

La supervision finale confirme 40 cibles encore productibles dans ce shard
selon la matrice, sans dépôt local supplémentaire exploitable dans les lots
traités. L'inventaire final trouve un PDF local pour 24/40 des cibles restantes
(et une entrée de découverte pour 23/40); les autres restent documentées comme
non-PDF/non-découvertes dans les sorties des outils read-only. Les manifestes de lots ajoutés sont
`discovered-shard-2-lot02-local.json` et `discovered-shard-2-lot03-local.json`.
