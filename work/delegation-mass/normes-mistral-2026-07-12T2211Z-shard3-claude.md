# NORMES via Mistral — shard 3/4 — 2026-07-12T22:11Z

## Portée et règles appliquées

- Branche de travail: `feat/cadre-acquisition`.
- Sélection: `coverage-matrix.json`, liste des villes avec `zones.status == done` et `normes.status != done`, tri lexicographique, garde `index % 4 == 3`.
- Spécification lue: `docs/spec/normes-extraction-retenu.md`.
- Supervision exécutée au début, entre les lots et à la fin par `acquisition/src/loop-supervise.ts`.
- Extraction exclusivement Mistral: `mistral-ocr-4-0` et `ocr/mistral-schema` (`document_annotation`). Aucun GPT-5.5/codex n’a été utilisé pour l’extraction.
- Tous les dépôts ont été demandés en Parquet-only; chaque dépôt a passé les gates du runner: au moins 3 codes, overlap SIG non nul, `publishedFieldPct` non nul, valeurs verbatim ou null.
- Plafond observé: inférieur à 1 USD par ville. La voie npm Mistral a retourné une erreur de fichier temporaire sur le premier essai; le même Document-AI Mistral a ensuite été appelé par HTTP avec data URL, sans changer de moteur.

## Dépôts nets de cette passe

| slug | voie Mistral | coût OCR/schema | codes | champs publiés | overlap SIG | résultat |
|---|---|---:|---:|---:|---:|---|
| `lac-frontiere` | `mistral-schema` | 0,003 USD | 19 | 55,3% | 1 | déposé |
| `lile-danticosti` | `mistral-schema` | 0,213 USD | 16 | 76,6% | 3 | déposé |
| `landrienne` | OCR puis `mistral-schema` | 0,662 USD | 51 | 42,2% | 41 | déposé |
| `manseau` | OCR puis `mistral-schema` | 0,731 USD | 21 | 70,8% | 3 | déposé |
| `sainte-germaine-boule` | OCR puis `mistral-schema` | 0,578 USD | 59 | 58,5% | 17 | déposé |
| `thetford-mines` | `mistral-ocr` | 0,053 USD | 399 | 1,7% | 273 | déposé |

Sources utilisées: lac-frontiere annexe A officielle, règlement PDF d’Ile-d’Anticosti déjà présent, règlement municipal de Landrienne, règlement MRC de Manseau, règlement 242-21 de Sainte-Germaine-Boule et grille officielle 02-01 de Thetford Mines.

## Aval exécuté

- `zonage-norms-manifest-merge.ts --apply` exécuté après les dépôts. Les dépôts `landrienne`, `manseau`, `sainte-germaine-boule` et `thetford-mines` ont été reconstruits/ajoutés; `lac-frontiere` et `lile-danticosti` étaient déjà présents au moment de la fusion.
- Le merge signale encore la clé parasite `registry` absente (`The specified key does not exist`) mais écrit le manifeste sans supprimer d’entrée stock.
- `lot-zone-join-run.ts` et `lots-enriched-run.ts` exécutés pour les six dépôts nets.
- Résultats aval notables: Landrienne 858/858 lots normés; Sainte-Germaine-Boule 769 lots, 15,86% de matches normés; Thetford Mines 11 746 lots, code de zone 99,99% mais normes 0% car les codes SIG ne recoupent pas les 399 codes extraits; Manseau 764 lots avec 0,52% de matches; Lac-Frontière 464 lots avec 3,02%; Ile-d’Anticosti n’a pas de polygones cadastraux.

## Gates refusés et preuves principales

- `auclair`, `dunham`, `esterel`, `la-visitation-de-lile-dupas`, `moffet`, `namur`, `normandin`, `saint-celestin--nicolet-yamaska`, `saint-godefroi`: 0 zone publiée après OCR/schema.
- `beaulac-garthby`, `lassomption`, `notre-dame-des-prairies`, `princeville`, `godbout`, `kinnears-mills`, `martinville`, `new-richmond`, `notre-dame-des-pins`, `ripon`, `sacre-coeur-de-jesus`, `saint-cyprien-de-napierville`, `saint-joseph-de-coleraine`, `saint-simon-de-rimouski`, `saint-zephirin-de-courval`, `sainte-euphemie-sur-riviere-du-sud`: overlap nul ou champs publiés nuls; aucun dépôt forcé.
- `la-guadeloupe`, `lile-danticosti` en OCR standard, `les-iles-de-la-madeleine`, `sainte-euphemie-sur-riviere-du-sud`: codes trouvés mais `publishedFieldPct == 0` ou structure non exploitable; les voies schema ont été tentées lorsque le budget et la borne le permettaient.
- `laval`: 2 codes recoupés et 75% de champs, refus strict du seuil de 3 codes.
- `saint-prosper`: schema 27 codes, 59,7% de champs mais overlap nul; le pont numérique SIG a aussi été tenté sans dépôt.
- `ivry-sur-le-lac`: règlement 287 pages; OCR initial sans grille, schema complet arrêté proprement avant dépassement de la borne de 6 minutes, aucun dépôt partiel.

## Découverte et résidu

- Le crawler 2-hop a confirmé la limite de la registry PV pour les petites municipalités: aucun muni exploitable dans les sous-lots sans source connue.
- Des recherches web ciblées ont trouvé et contrôlé plusieurs PDF officiels supplémentaires; cinq téléchargements ont été valides puis refusés par gates, deux URLs ont répondu 403, et les liens hors municipalité/plans/projets ambigus ont été écartés.
- À la dernière lecture de la matrice: 219 villes candidates globales, 54 dans le shard `index % 4 == 3`. Les cibles restant sans extraction dans cette passe sont: `biencourt`, `champneuf`, `cloridorme`, `honfleur`, `la-reine`, `lile-du-grand-calumet`, `palmarolle`, `pointe-a-la-croix`, `saint-alphonse`, `saint-bonaventure`, `saint-edmond-les-plaines`, `saint-elzear--bonaventure`, `saint-epiphane`, `saint-fortunat`, `saint-ignace-de-loyola`, `saint-jean-de-brebeuf`, `saint-juste-du-lac`, `saint-marc-du-lac-long`, `saint-philippe-de-neri`, `sainte-anne-de-sorel`, `sainte-aurelie`, `sainte-justine`, `sainte-rose-de-watford`, `valcourt--le-val-saint-francois--2`.

Les cibles comme `saint-joseph-de-coleraine`, `saint-simon-de-rimouski`, `saint-zephirin-de-courval` et `sainte-euphemie-sur-riviere-du-sud` ont bien été tentées et refusées par gate; `sainte-germaine-boule` et `thetford-mines` sont déposées ci-dessus.

Les entrées déjà tentées avec refus sont conservées comme preuves; aucune valeur n’a été inventée pour satisfaire un gate.

## Worktree partagé

- État initial très sale et partagé par d’autres agents, notamment `.claude/*`, `.track/*`, `coverage-matrix.json` et de nombreux artefacts `work/`.
- Cette passe n’a pas touché aux secrets, `.claude/` ou `.track/` et n’a jamais utilisé `git add .`.
