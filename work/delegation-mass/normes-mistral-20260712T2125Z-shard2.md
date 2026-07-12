# NORMES via Mistral — shard 2/4 — 2026-07-12T2125Z

## Périmètre et supervision

- Branche : `feat/cadre-acquisition`.
- Spécification lue : `docs/spec/normes-extraction-retenu.md`.
- Sélection : `coverage-matrix.json`, villes triées, `zones.status == done`, `normes.status != done`, conservation stricte de `index % 4 == 2`.
- Sélection initiale : 46 cibles. Après le dépôt de Saint-Félix, 45 cibles restent dans la matrice; les autres shards ont été ignorés.
- `loop-supervise.ts` exécuté au début et après les lots. Le premier lancement sandboxé a échoué uniquement sur le socket IPC de `tsx` (`EPERM`), puis la relance autorisée a réussi.
- Extraction payante exclusivement Mistral OCR-4.0 et Mistral `document_annotation` (`mistral-schema`). Aucun GPT-5.5/Codex d’extraction.
- Dépôts parquet-only; aucun secret, `.claude` ou `.track` touché.

## Dépôt net

| slug | source officielle | voie Mistral | résultat des gates | aval |
| --- | --- | --- | --- | --- |
| `saint-felix-de-dalquier` | `https://stfelixdedalquier.ca/wp-content/uploads/2021/05/R-285.pdf` | `mistral-schema`, 3 pages, 0,009 USD après OCR exploratoire à 0,003 USD | 5 codes, overlap SIG 4, `publishedFieldPct=12,5%`, gate OK | join 936 lots; enrichi |

Le dépôt est `registry/qc-zonage-norms/qc-zonage-norms-saint-felix-de-dalquier.parquet`. Le merge a ajouté 5 lignes au manifeste (`manifestAfter=688`); il a aussi signalé la clé concurrente indépendante `registry` absente, sans empêcher l’ajout.

Aval : `lot-zone-join-run.ts --slugs saint-felix-de-dalquier` a vérifié 936 lots, 89,1 % assignés et 8,51 % de correspondance zone/normes. `lots-enriched-run.ts` a déposé l’enrichissement : surface 100 %, code postal 100 %, normes 7,59 %. L’adresse reste nulle faute de `code_geo` candidat; aucune valeur n’a été inventée.

## Lots et gates négatifs

- `ripon` : règlement/grille officiel HTTP 200; OCR Mistral 1 page, 1003 codes mais `publishedFieldPct=0`; rejet strict.
- `saint-augustin-de-desmaures` : OCR Mistral fenêtre 98–157, 4 pseudo-codes, overlap SIG 0; rejet.
- `saint-celestin--nicolet-yamaska` : schema Mistral sur 4 pages image, 0 zone (`sig=33`); rejet sous le seuil de 3.
- `saint-pamphile` : grille officielle ciblée, schema Mistral 8 codes et plusieurs valeurs verbatim, mais overlap SIG 0; rejet anti-invention.
- `saint-pierre` : page 62 identifiée comme annexe image, schema Mistral 5 codes dont 4 recoupés, mais `publishedFieldPct=0`; rejet.
- `saint-felix-de-dalquier` : l’OCR initial à 0 zone a été retenté par schema sur le PDF court; cette seconde voie a passé les gates et est le seul dépôt net de la présente passe.
- `batiscan`, `brebeuf`, `clerval`, `dundee`, `esterel`, `gallichan`, `godbout`, `guerin`, `lac-frontiere`, `lac-saint-joseph`, `latulipe-et-gaboury`, `laval`, `lile-du-grand-calumet`, `martinville`, `pointe-a-la-croix` : discovery bornée et/ou preuves antérieures relues. Les documents confirmés sont faux PDF, règlement/amendement sans annexe, plan image, URLs 404, absence de grille ou sorties Mistral sous-gate; aucun dépôt forcé.
- `laval` : la seule piste web HTTP 200 retrouvée (`annexe-I-2-de-12.pdf`) est explicitement une carte de zonage, pas une grille de normes; aucun appel Mistral.
- Les résiduelles sans PDF local (`quebec`, `saint-adrien`, `saint-antonin`, `saint-cyprien--les-etchemins`, `saint-edmond-de-grantham`, `saint-elphege`, `saint-ferdinand`, `saint-germain-de-kamouraska`, `saint-lambert--abitibi-ouest`, `saint-luc-de-bellechasse`, `saint-pierre-de-lamy`, `sainte-angele-de-merici`, `sainte-genevieve-de-berthier`, `sainte-madeleine`) n’ont pas fourni de PDF officiel confirmé par web-search; les liens génériques ont été écartés.

## Coût et intégrité

Coût Mistral observé pour les essais de cette passe : environ **0,091 USD** (Ripon 0,001; Saint-Augustin 0,060; Saint-Célestin 0,012; Saint-Félix 0,012; Saint-Pamphile 0,003; Saint-Pierre 0,003), sans dépasser 1 USD par ville. Les champs publiés du dépôt accepté restent issus des cellules verbatim ou `null`.

Artefacts de découverte ciblés : `work/zonage-norms/seed-shard-2-laval-20260712.json`, `discovered-shard-2-laval-20260712.json` et les sorties dédiées du lot Ripon. Les changements préexistants et concurrents du worktree sont laissés intacts.
