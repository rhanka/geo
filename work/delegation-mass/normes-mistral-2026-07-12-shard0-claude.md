# NORMES via MISTRAL — shard 0/4 — 2026-07-12

## Périmètre et méthode

- Dépôt: `feat/cadre-acquisition`, sélection déterministe `Object.keys(cities).sort()` puis `index % 4 == 0`.
- Snapshot initial: 56 villes productibles (`zones.status == done` et `normes.status != done`). Les 56 ont été couvertes en quatre lots: 15 + 15 + 15 + 11.
- Supervision exécutée avant le premier lot et entre les lots avec `acquisition/src/loop-supervise.ts`.
- Spécification lue: `docs/spec/normes-extraction-retenu.md`.
- Découverte appliquée: inventaire des PDF locaux, crawler `grille-discovery-run` pour les slugs registry, puis pages/portails municipaux officiels et seeds MRC/municipaux. Aucun URL non confirmé n'a été envoyé à Mistral.
- Extraction: uniquement `mistral-ocr-4-0` (`route ocr`) et `ocr/mistral-schema` (`document_annotation`). Aucun moteur GPT/codex.
- Dépôt: `--no-manifest` / parquet-only; aucune écriture `.claude` ou `.track`.

## Dépôt net

| slug | source officielle | extraction | résultat gate |
|---|---|---|---|
| `bedford--brome-missisquoi--2` | `https://ville.bedford.qc.ca/wp-content/uploads/2020/02/699-Annexe-B-grilles-des-usages-et-des-normes.pdf` | Mistral OCR, 1 page billed, 0,001 USD | OK: 72 codes réels, `publishedFieldPct=55.6%`, SIG `73`, overlap `71`, recoup `97.3%` |

Parquet déposé: `registry/qc-zonage-norms/qc-zonage-norms-bedford--brome-missisquoi--2.parquet`.

`zonage-norms-manifest-merge.ts --apply` a ajouté Bedford au manifeste. Puis:

- `lot-zone-join-run`: 644 lots, match codes `94.44%`, assigned `5.59%` (warnings conservés).
- `lots-enriched-run`: 644 lots, normes `5.28%`, dépôt OK.

## Échecs / preuves conservées

- Abercorn: PDF R-234 confirmé; auto-grid pages 34–38 mais OCR puis schema = `0 zones`; le PDF de base n'embarque pas la grille exploitable.
- Albanel, Auclair, La Visitation-de-l'Île-du-Pas, New Richmond, L'Épiphanie et Saint-Hilaire-de-Dorset: PDF officiels confirmés mais `0 zones`.
- Ivry-sur-le-Lac, Normandin et Rivière-Bleue: PDF de règlement confirmé; OCR/schema ciblé sans zone publiable (`0 zones` ou champs nuls).
- La Pocatière: OCR = 1 code, overlap `0`; gate strict refusé. Route vision arrêtée à environ 5 min 30 sans résultat pour respecter la limite de 6 min/slug.
- Notre-Dame-des-Pins, Rémigny, Saint-Marcel-de-Richelieu et Sainte-Lucie-de-Beauregard: codes détectés mais overlap nul ou `publishedFieldPct=0`; aucun dépôt forcé.
- Saint-Cyprien-de-Napierville, Saint-Camille-de-Lellis, Saint-Jules et Saint-Jacques-de-Leeds: fenêtres officielles ciblées, OCR/schema = `0 zones`; Saint-Jacques a en plus échoué à la découpe PDF.
- Saint-Damase: PDF d'amendement officiel confirmé mais `0 zones`; il ne remplace pas le règlement de base + annexe.
- Frontenac: le PDF 378-2008 confirmé est un règlement de colportage, pas le zonage; écarté. Grosse-Île: PDF publics testés = évaluation/incendie, pas zonage.
- Les autres slugs des quatre lots ont été recherchés via leurs portails officiels/MRC; absence de PDF règlement de base + grille confirmée dans la fenêtre opérationnelle, ou aucun PDF local. Aucun appel Mistral sur URL inventée.

Gates appliqués partout: au moins 3 `zone_code` verbatim, overlap SIG non nul, `publishedFieldPct` non nul, valeurs verbatim-or-null. Les refus restent des preuves et n'ont produit aucun parquet.

## État final

- Dépôts nets de cette passe: `1`.
- Coût Mistral de la passe: inférieur à 1 USD par ville; aucun budget ville dépassé.
- Shard 0/4 épuisé pour le snapshot de 56 cibles; les slugs non déposés restent productibles si une nouvelle source officielle base + annexe est découverte.
