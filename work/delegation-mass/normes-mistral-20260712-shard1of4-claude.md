# Normes Mistral — shard 1/4 — 2026-07-12

## Périmètre

- Sélection : `coverage-matrix.json`, liste triée, `zones.status=done`, `normes.status!=done`, index modulo 4 égal à 1.
- Cibles traitées : lots 1 à 3, sans réutiliser les shards des autres agents.
- Moteur : Mistral OCR-4.0 et Mistral `document_annotation` (`mistral-schema`) uniquement. Aucun GPT/codex.
- Dépôt : parquet-only; manifeste fusionné après le dépôt accepté.
- Dépense Mistral estimée : **1,728 USD**; aucune ville au-dessus de 1 USD.

## Dépôt accepté

| slug | moteur | preuve des gates | dépôt / suites |
|---|---|---|---|
| `laverlochere-angliers` | `mistral-schema` | 41 codes, 13 overlap SIG, 17,1% de champs publiés, 72 pages | parquet `registry/qc-zonage-norms/qc-zonage-norms-laverlochere-angliers.parquet`; manifeste fusionné; join/enriched OK, 512 lots |

Le join est volontairement signalé comme faible : 1,37% des lots joignent une norme, sans échec de vérification parquet. Aucun champ n’a été inventé.

## Preuves de refus strict

- `courcelles-saint-evariste` : OCR 80 pages = 0 zone; `mistral-schema` ciblé pages 129–133 = 0 zone.
- `denholm` : OCR initial = 3 codes et 0% champs; OCR ciblé pages 14–119 = 5 codes et 0% champs; refus `publishedFieldPct=0`.
- `lassomption` : OCR = 91 codes, overlap 0; schéma = 71 codes, 42,3% champs, overlap 0.
- `mont-carmel` : OCR pages 136–138 = 0 zone.
- `namur` : schéma = 25 codes, 63% champs, overlap 0 avec les 4 codes SIG `[A,B,C,D]`.
- `notre-dame-des-prairies` : OCR auto-grid pages 258–500 = 97 codes, 0% champs; schéma pages 233–324 = 8 codes, 0% champs, overlap 0.
- `pont-rouge` : OCR pages 62–185 = 95 codes, 0% champs; schéma pages 183–185 = 0 zone.
- `princeville` : OCR pages 50–214 = 17 codes, overlap 0.
- `saint-alphonse` : PDF image de 2 pages, OCR = 0 zone.
- `macamic` : artefact local de 1 014 octets sans en-tête PDF; non alimenté.

## Découverte / fallback

- Réutilisation locale effectuée en premier pour les PDFs présents sous `work/zonage-norms` et `work/pdf-cache`.
- `grille-discovery-run.ts --2hop` sur les cibles sans PDF : seulement `lefebvre` et `grand-saint-esprit` étaient dans la registry parcourue; 0 PDF confirmé.
- Portails officiels vérifiés pour le fallback MRC/municipal : MRC Abitibi, MRC Abitibi-Ouest, MRC Rimouski-Neigette, MRC Nicolet-Yamaska, MRC Drummond, ainsi que les sites de Champneuf, Esprit-Saint, Fort-Coulonge, Grand-Saint-Esprit, La Visitation-de-Yamaska, Lac-Delage, Lefebvre et L’Île-Dorval. Aucun règlement de zonage exploitable et confirmé 200/PDF n’a été retenu pour ce lot.

## Traçabilité d’exécution

- `loop-supervise.ts` exécuté au démarrage puis entre les lots.
- `zonage-norms-manifest-merge.ts --apply` : ajout de `laverlochere-angliers`; une lecture registry concurrente a échoué sans invalider le parquet ajouté.
- `lot-zone-join-run.ts --slugs laverlochere-angliers` : 512/512 lots, vérification parquet OK.
- `lots-enriched-run.ts --slugs laverlochere-angliers` : dépôt OK.

