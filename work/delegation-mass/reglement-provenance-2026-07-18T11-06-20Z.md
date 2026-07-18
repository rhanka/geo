# Provenance règlement — SHARD 1/2 — 2026-07-18T11:06:20Z

Règle de shard appliquée: liste triée `served && !reglement`, index `% 2 == 1`.

## Re-pioche et avant/après

- Avant le lot: 252 cibles, 126 dans ce shard; registre: 121 `HOLD-NULL`, 5 numéros curés, 0 `TODO-URL` vierge.
- Après le lot: même résultat de re-pioche (`TODO-URL=0`). Le shard est épuisé de toute source URL non encore curée; les nulls restants sont des décisions motivées, pas des numéros manquants à déduire.
- Changement durable: `baie-des-sables` reste `null/null/null`, mais reçoit l’URL source réellement servie et une raison vérifiée. L’ancien motif «aucune source_url / aucun PDF local» était périmé.
- Pliage des cinq entrées numérotées déjà curées: `charette`, `duhamel`, `fassett`, `ogden`, `saint-anicet`. Avant/après S3: `cellsChanged=0` pour chacune — les quatre champs étaient déjà sur les polygones. Vérification API après pliage: `2023-02`, `2023-04`, `2023-16`, `2025-05`, `585` respectivement.

## Villes null relues dans ce lot

| Slug | Raison du null — preuve verbatim |
| --- | --- |
| `ange-gardien` | La grille servie dit seulement «Municipalité d’Ange-Gardien / grille des usages principaux et des normes»; aucune ligne de numéro de règlement dans les pages lues. Le corps identifié précédemment est celui de l’homonyme, donc aucun numéro ne se transfère. |
| `baie-des-sables` | La grille porte «Cette grille fait partie intégrante du règlement no. ______» (numéro vide). Les seules valeurs sont sous le titre «AMENDEMENTS»: «Règlement numéro 2008-06-1, 13 mai 2010» à «Règlement numéro 2008-06-8, 26-10-2023». Ce ne sont pas la base; `2008-06` du nom de fichier n’est pas un numéro lu. |
| `coaticook` | La grille ne donne que des amendements, par exemple «ajout mini-entreposage, règl. 6-1(2002)-1» et «règl. 6-1-81 (2022)». Le règlement consolidé en vigueur reste sans numéro; le `6-1` URL est le règlement abrogé. |
| `crabtree` | Chaque page dit «Annexe 2 du Règlement de zonage» et le tableau «No. de règlement» est vide. Le nom de fichier `va-2024-421` ne constitue pas une lecture dans le document. |
| `escuminac` | Le document dit «GRILLES DE SPÉCIFICATIONS / MUNICIPALITÉ D’ESCUMINAC» et ne porte ni numéro ni date d’adoption/entrée en vigueur. `2021-003` est uniquement dans le nom de fichier source. |
| `lac-sergent` | Le cahier dit «VILLE DE LAC-SERGENT / Grille des usages et normes / Annexe B». Les colonnes «AMENDEMENTS / NUMÉRO / DATE» sont vides; aucune occurrence de `314` ni de date d’adoption dans le PDF. |
| `saint-andre-de-kamouraska` | Bien que la couverture porte «Règlement numéro 251», elle laisse «ADOPTION DU RÈGLEMENT XXXX 2025» et «ENTRÉE EN VIGUEUR XXXX 2025»: projet non adopté, donc non stampable. |
| `saint-edouard-de-lotbiniere` | Le document dit «Municipalité de Saint-Édouard», puis «MRC les Jardins de Napierville»; il n’est pas celui de Saint-Édouard-de-Lotbinière. Ses `2015-259`/`2015-258` ne sont pas attribuables à ce slug. |
| `saint-eusebe` | L’extrait de deux pages commence directement par «Zones R» et «Classes d’usages»; il ne nomme ni municipalité ni règlement, donc aucun numéro ne peut être rattaché à Saint-Eusèbe. |

## Sources et garde-fous

- Les PDFs ouverts étaient uniquement les URLs déjà minées et leurs copies locales sous `work/zonage-norms/`.
- Aucun numéro n’a été déduit d’une URL ou d’un nom de fichier.
- Aucune source sans numéro de base en vigueur n’a été pliée vers les polygones.
