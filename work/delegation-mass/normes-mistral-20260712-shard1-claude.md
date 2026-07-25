# Normes Mistral — shard 1/4 — 2026-07-12

## Périmètre

- Sélection déterministe: `zones.status == done` et `normes.status != done`, liste triée, `index % 4 == 1`.
- Cibles initiales: 60; quatre lots traités de 15 (`authier-nord` à `namur`, puis `nedelec` à `saint-honore-de-temiscouata`, puis `saint-ignace-de-loyola` à `saint-wenceslas`, puis `saint-zephirin-de-courval` à `yamaska`).
- `loop-supervise.ts` relancé avant le premier lot et entre les lots; le sélecteur final confirme l’épuisement du shard.
- Extraction exclusivement Mistral (`mistral-ocr-4-0` ou `mistral-schema`/`document_annotation`); aucune route GPT/codex utilisée.
- Aucun secret, `.claude` ou `.track` touché par cette opération.

## Découverte

Les PDF officiels réutilisés ou confirmés sont consignés dans les manifests suivants:

- `work/zonage-norms/discovered-shard1-lot01-mistral-20260712.json`
- `work/zonage-norms/discovered-shard1-lot01-mrc-20260712.json`
- `work/zonage-norms/discovered-shard1-lot01-vplus-20260712.json`
- `work/zonage-norms/discovered-shard1-lot01-crawler-20260712.json`
- `work/zonage-norms/discovered-shard1-lot02-official-20260712.json`
- `work/zonage-norms/discovered-shard1-lot02-crawler-20260712.json`

Les recherches MRC/municipales ont été privilégiées. Les amendements seuls, plans seuls, pages sans PDF, PDF d’une autre municipalité ou document sans URL officielle traçable ont été conservés comme preuves négatives et non injectés.

## Dépôt conforme

Un seul dépôt net a passé tous les gates:

- `saint-eusebe`: `mistral-schema`, 29 codes, `publishedFieldPct=10.3%`, overlap SIG=2; parquet `registry/qc-zonage-norms/qc-zonage-norms-saint-eusebe.parquet`.
- `zonage-norms-manifest-merge.ts --apply`: Saint-Eusèbe ajouté au manifeste; avertissement externe `registry: The specified key does not exist` conservé comme preuve de registre, sans fabrication locale.
- `lot-zone-join-run.ts --slugs saint-eusebe`: 908 lots, parquet/statistiques vérifiés, 99.56% affectés.
- `lots-enriched-run.ts --slugs saint-eusebe`: dépôt réussi, 908 lots, `zone_code=99.56%`, `norms=1.32%`, surface et code postal 100%.

## Rejets Mistral et preuves principales

- Lot 1: `lassomption`, `maria` et `namur` ont produit des codes sans overlap SIG; `authier-nord`, `biencourt`, `la-visitation-de-yamaska`, `lefebvre` et d’autres fenêtres ont produit zéro zone ou moins de trois codes; les champs publiés étaient nuls sur les essais schema ciblés.
- Lot 2: `notre-dame-des-prairies` (`overlap=0`/`publishedFieldPct=0`), `pohenegamook` (`23` codes, overlap=0), `pont-rouge` (`2` codes, `publishedFieldPct=0`), `princeville` (overlap=0), `poularies` (0 code) et `nedelec` (0 zone) rejetés. Le PDF de Normétal/Palmarolle était explicitement un règlement des territoires non organisés; le fichier local de `saint-alphonse` était un faux positif `saint-alphonse-rodriguez`.
- Lot 3: `saint-joseph-des-erables` a donné `A/F/R`, overlap=0 et `publishedFieldPct=0`; le fichier de `saint-joseph-de-coleraine` était un amendement de schéma MRC; Saint-Lazare n’avait qu’un amendement; Saint-Pacôme n’avait pas de source officielle traçable pour le règlement complet.
- Lot 4: `trois-rivieres` (`I/J/R`, overlap=0), `valcourt--le-val-saint-francois--2` (66 codes mais `publishedFieldPct=0`) rejetés. Senneterre était un scan de 33 MB; l’appel schema a été interrompu avant six minutes après absence de sortie, sans dépôt. Les autres fichiers étaient amendements, procès-verbaux, plans, scans sans provenance ou liens absents.

## État final

- Dépôts nets: **1** (`saint-eusebe`).
- Gates appliqués: au moins 3 codes réels, overlap SIG non nul, champ publié non nul, verbatim-or-null; aucun résultat sous gate n’a été déposé.
- Commit/push ciblé à effectuer uniquement pour les fichiers de ce lot; les modifications préexistantes du worktree restent hors périmètre.
