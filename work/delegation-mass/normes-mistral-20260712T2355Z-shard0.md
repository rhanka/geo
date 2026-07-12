# Normes via Mistral — shard 0/4 — 2026-07-12

## Périmètre

- Sélection déterministe: `zones.status == done` et `normes.status != done`, liste productible triée, `index % 4 == 0`.
- Supervision initiale et inter-lots exécutée par `acquisition/src/loop-supervise.ts`.
- Spécification lue: `docs/spec/normes-extraction-retenu.md`.
- Aucun appel GPT/codex d’extraction; les routes utilisées sont Mistral OCR, Mistral schema `document_annotation` et Mistral vision du runner existant.
- Aucun fichier `.claude`, `.track` ou secret modifié.

## Dépôts nets

| slug | source | moteur / fenêtre | résultat gate | coût annoncé |
|---|---|---|---|---:|
| `esterel` | règlement de zonage refondu officiel | `mistral-schema`, p. 44–64 | 6 codes, overlap 5/66, publishedFieldPct 29,2 %, déposé parquet-only | $0,063 |
| `saint-edouard-de-fabre` | PDF local déjà staging; URL non disponible dans la provenance existante | runner Mistral vision, p. 1–60 | 3 codes, overlap 1/47, publishedFieldPct 4,2 %, déposé parquet-only | $0,1728 |

Les deux dépôts ont été fusionnés avec `zonage-norms-manifest-merge.ts --apply`. Le join lots-zones et `lots-enriched-run.ts` ont été exécutés pour les deux villes; Saint-Édouard signale un match normes de 0 % côté lots, conséquence attendue de l’overlap minimal, sans altérer le dépôt validé.

## Échecs conservés comme preuves

- `kinnears-mills`: schéma p. 129–132, 16 codes et 9,4 % de champs, mais overlap 0/67; la grille documente des catégories `AF2a…`, alors que le SIG expose les codes individuels `AF-2A1…`. Rejet anti-invention.
- `godbout`: OCR/schema/multizone sur les fenêtres candidates, 0 zone; batch OCR p. 1–60 également 0 zone.
- `lac-saint-joseph`: 12 codes, overlap 6/35 mais publishedFieldPct 0; rejet.
- `les-iles-de-la-madeleine`: 2 codes, overlap 0/167; rejet.
- `princeville`: 15 codes, overlap 0/116; rejet.
- `saint-pamphile`: 8 codes, publishedFieldPct 62,5 %, overlap 0/48; rejet.
- `saint-marcel-de-richelieu`: 8 codes, publishedFieldPct 0, overlap 0/2; rejet.
- `saint-bruno-de-guigues`: 2 codes après 59 pages, sous le seuil de 3.
- `ripon`: 1 code, sous le seuil de 3.
- `fermont`, `la-guadeloupe`, `la-visitation-de-lile-dupas`, `laval`, `new-richmond`, `notre-dame-des-pins`, `saint-celestin--nicolet-yamaska--2`, `saint-damase--les-maskoutains`, `saint-elzear-de-temiscouata`, `saint-godefroi`, `saint-simon`, `sainte-anne-de-beaupre`, `sainte-rose-de-watford`: 0 zone après route Mistral ciblée ou schéma.
- Découverte officielle sans PDF exploitable pour `hope`, `maria`, `montreal`, `padoue`, `pointe-a-la-croix`, `saint-eusebe`, `saint-francois-de-la-riviere-du-sud`, et les cibles restantes non staging du shard.

## Lots traités

- Lot 1: `abercorn` à `macamic`; découverte crawler 2-hop (4 villes crawlables, 0 PDF), puis découverte directe des règlements officiels; dépôt Estérel, rejet Kinnear’s Mills.
- Lot 2: 15 cibles suivantes; 10 PDF locaux inspectés et batch Mistral, aucun dépôt.
- Lot 3: 15 cibles suivantes; 8 PDF locaux inspectés et batch Mistral, dépôt Saint-Édouard.
- Lot 4: 15 cibles suivantes; 5 PDF locaux inspectés, aucun dépôt.
- Segment final: 9 cibles restantes productibles au moment du repêchage, aucun dépôt.

## État final

Le repêchage final du shard 0/4 ne laissait plus de cible fraîche avec PDF officiel exploitable: les slugs restants avaient une preuve d’échec ou une absence de source/PDF. Les manifestes de lot ignorés par Git sont conservés localement pour traçabilité; les dépôts de vérité sont les Parquet du registre et le manifeste fusionné.
