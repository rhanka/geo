# NORMES via Mistral — shard 2/4 — 2026-07-12

## Périmètre

- Source: `work/coverage/coverage-matrix.json`.
- Sélection déterministe: villes triées, `zones.status=done`, `normes.status!=done`, puis `sorted-index % 4 == 2`.
- Sélection initiale: 58 éligibles, lot de 15. Après les dépôts, 56 restaient dans la matrice (la matrice n'a pas rafraîchi les dépôts distants); les segments suivants ont été pris par position dans cette même liste triée.
- Moteur d'extraction: Mistral OCR-4.0 Document-AI; document_annotation `mistral-schema` pour les essais transposés. Aucun moteur GPT/codex.
- Dépôts: parquet-only (`--no-manifest`), puis fusion de manifeste.

## Dépôts conformes

| slug | source PDF officiel | zones uniques | overlap SIG | champs publiés | coût OCR estimé | résultat |
|---|---|---:|---:|---:|---:|---|
| bonsecours | `https://municipalites-du-quebec.ca/bonsecours/custom/zonage.pdf` | 37 | 37 | 54,1 % | 0,021 USD | déposé |
| franquelin | `https://municipalites-du-quebec.ca/franquelin/pdf_reglements/2025-03_Re%CC%80glements%20de%20zonage.pdf` | 18 | 7 | 50 % | 0,004 USD | déposé |

Les deux dépôts ont passé les gates: au moins trois codes réels, overlap non nul, champs normatifs publiés et valeurs verbatim/null.

## Post-traitement

- `zonage-norms-manifest-merge.ts --apply`: Bonsecours et Franquelin ajoutés au manifeste; un artefact distant `registry` a été signalé absent, sans bloquer les deux ajouts.
- `lot-zone-join-run.ts --slugs bonsecours,franquelin`: deux lots vérifiés et assignés à 100 %. Bonsecours match normes 58,89 %; Franquelin match 0 % (signal SIG conservé, pas de réinterprétation).
- `lots-enriched-run.ts --slugs bonsecours,franquelin`: deux dépôts enrichis réussis.

## Échecs et preuves anti-invention

- `brebeuf`: PDF officiel de 33 pages, Mistral OCR 0,033 USD, 0 zone.
- `dundee`: six PDF image-only du portail officiel testés par OCR (3 à 13 pages; coûts cumulés ~0,036 USD), 0 zone à chaque fois.
- `lac-frontiere`: annexe PDF 1 page, OCR 0,001 USD, 0 zone; règlement complet 6 pages sans grille détectée.
- `lac-saint-joseph`: règlement 206 pages; passe large 12 codes mais `publishedFieldPct=0`; annexe pages 205–206 en OCR (0 zone) et `mistral-schema` (0 zone). Aucun dépôt.
- `ripon`: annexe officielle 1 page; OCR 1 003 codes mais `publishedFieldPct=0`, puis `mistral-schema` 0 zone. Gate strict rejeté.
- `saint-francois-dassise`: pages 165–182, 5 codes mais `publishedFieldPct=0`.
- `saint-just-de-bretenieres`: pages 1–80 dans la fenêtre budgétaire, 6 codes, overlap SIG 0.
- `saint-felix-de-dalquier`: règlement PDF 3 pages, 0 zone.
- `saint-edouard-de-lotbiniere`: voie vision Mistral lancée sur les pages 29–72; arrêtée après environ 6 minutes sans sortie, aucun dépôt.
- `esterel`: PDF 2 pages identifié comme amendement de zonage, pas la grille de base.
- `clerval`: les candidats vérifiés étaient un règlement d'emprunt et un règlement de construction image-only, pas une grille de zonage.
- `saint-rene`: candidat vérifié = amendement 2023-06 du règlement de zonage, pas l'annexe de base.
- `sainte-anne-des-plaines`: seul PDF confirmé = grille tarifaire urbanisme, hors périmètre normes.

Les crawlers officiels ont aussi produit zéro candidat pour les autres villes parcourues du shard; les portails MRC/AO testés n'exposaient pas de PDF de grille exploitable. Aucun échec n'a été converti en valeur ou dépôt partiel.

## Fichiers de découverte

Les sorties dédiées sont dans `work/zonage-norms/discovered-shard-2-lot01-seed.json`, `discovered-shard-2-lot01.json`, `discovered-shard-2-lot02.json`, `discovered-shard-2-lot04.json` et `discovered-shard-2-lot05.json`. Le lot 3 a été interrompu sur Île-du-Grand-Calumet après le plafond de temps; Ripon a été traité depuis son URL confirmée.

