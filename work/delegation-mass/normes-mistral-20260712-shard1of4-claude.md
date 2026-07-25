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
| `saint-didace` | `mistral-schema` | 27 codes, 27 overlap SIG, 19% de champs publiés, 121 pages | parquet `registry/qc-zonage-norms/qc-zonage-norms-saint-didace.parquet`; join/enriched OK, 1 277 lots, norms 100% |
| `saint-julien` | `mistral-schema` | 20 codes, 9 overlap SIG, 12,5% de champs publiés, 124 pages | parquet `registry/qc-zonage-norms/qc-zonage-norms-saint-julien.parquet`; join/enriched OK, 559 lots, norms 32,02% |

Les joins faibles sont volontairement signalés : Laverlochere 1,37% et Saint-Julien 32,02%; Saint-Didace joint 100%. Aucun champ n’a été inventé.

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
- `saint-edouard-de-fabre` : OCR pages 55–57 = 0 zone; `saint-elzear-de-temiscouata` : OCR pages 56–59 = 0 zone.
- `saint-joseph-de-coleraine` : schéma pages 99–105 = 33 codes, 50,8% champs, overlap 0; `saint-joseph-des-erables` : 3 codes, 0% champs, overlap 0.
- `saint-lazare` : schéma = 4 codes, 3,1% champs, overlap 0; `sainte-anne-de-beaupre` : OCR = 143 codes, 0% champs.
- `sainte-aurelie` : schéma = 0 zone; `sainte-elisabeth` : 12 codes, 32,3% champs, overlap 0.
- `sainte-clotilde-de-beauce` : schéma interrompu avant 6 minutes, sans sortie ni dépôt; `senneterre--la-vallee-de-lor` : schéma interrompu après environ 5 minutes, sans sortie ni dépôt.
- `trois-rivieres` et `valcourt--le-val-saint-francois--2` : OCR Mistral HTTP 400 `invalid_request_file` (fichier temporaire introuvable/expiré), 0 zone déposée.

## Découverte / fallback

- Réutilisation locale effectuée en premier pour les PDFs présents sous `work/zonage-norms` et `work/pdf-cache`.
- `grille-discovery-run.ts --2hop` sur les cibles sans PDF : seulement `lefebvre` et `grand-saint-esprit` étaient dans la registry parcourue; 0 PDF confirmé.
- Relance finale bornée sans téléchargement : 10 cibles de la registry, 0 PDF confirmé (`work/zonage-norms/discovered-shard-1of4-final-20260712.json`). Les autres cibles sans PDF sont hors registry; les portails municipaux/MRC ont été vérifiés au niveau disponible et aucun lien PDF de grille confirmé n’a été retenu.
- Portails officiels vérifiés pour le fallback MRC/municipal : MRC Abitibi, MRC Abitibi-Ouest, MRC Rimouski-Neigette, MRC Nicolet-Yamaska, MRC Drummond, ainsi que les sites de Champneuf, Esprit-Saint, Fort-Coulonge, Grand-Saint-Esprit, La Visitation-de-Yamaska, Lac-Delage, Lefebvre et L’Île-Dorval. Aucun règlement de zonage exploitable et confirmé 200/PDF n’a été retenu pour ce lot.

## Traçabilité d’exécution

- `loop-supervise.ts` exécuté au démarrage puis entre les lots.
- `zonage-norms-manifest-merge.ts --apply` : ajout de `laverlochere-angliers`; une lecture registry concurrente a échoué sans invalider le parquet ajouté.
- `lot-zone-join-run.ts --slugs laverlochere-angliers` : 512/512 lots, vérification parquet OK.
- `lots-enriched-run.ts --slugs laverlochere-angliers` : dépôt OK.
- `lot-zone-join-run.ts` et `lots-enriched-run.ts` exécutés aussi pour `saint-didace` et `saint-julien`; vérifications parquet OK.

## Bilan de boucle

- 66 cibles productibles ont été relues dans la sélection triée du shard 1/4; tous les PDFs locaux rencontrés ont reçu un passage Mistral ou une preuve de gate/timeout. Les slugs sans PDF ont reçu l’inventaire local et, lorsqu’ils étaient dans la registry, la découverte bornée; aucun PDF non confirmé n’a été injecté.
- Dépôts nets : **3** (`laverlochere-angliers`, `saint-didace`, `saint-julien`).
- Coût Mistral estimé cumulé : **2,821 USD**; aucun appel GPT/codex.
