# NORMES via Mistral — shard 2/4 — 2026-07-12T0235Z

## Périmètre

Sélection déterministe avec `normes-shard-select.ts --n 4 --shard 2`: liste triée, index `% 4 == 2`. La sélection initiale comptait 60 cibles productibles (`zones=done`, `normes!=done`). Après le dépôt validé ci-dessous, la re-sélection compte 59 cibles restantes; aucune cible d’un autre shard n’a été traitée.

Provenance relue avec `loop-supervise.ts` au début, entre les lots et après le dépôt. Extraction payante: Mistral uniquement (`mistral-ocr-4-0` et `mistral-schema`); aucun moteur GPT/codex.

## Dépôt net

| muni | source confirmée | moteur | résultat strict |
|---|---|---|---|
| `sainte-barbe` | page municipale officielle; `2003-05-Grilles-des-specifications-janvier-2026.pdf` confirmé HTTP 200/PDF | Mistral OCR, 77 pages, 0,077 USD | 43 codes réels, 42 chevauchements SIG, 39,5 % de champs publiés, dépôt Parquet-only accepté |

Produit: `registry/qc-zonage-norms/qc-zonage-norms-sainte-barbe.parquet`, 43 lignes. Gates: `>=3 zone_codes` OK, `overlap=42` OK, `publishedFieldPct=39.5` OK, champs verbatim-or-null OK.

`zonage-norms-manifest-merge.ts --apply` a ajouté `sainte-barbe` au manifeste (`rows=43`, `uzc=43`). L’outil signale aussi `registry: The specified key does not exist` pour une entrée préexistante indépendante; cela n’a pas empêché l’ajout de Sainte-Barbe.

Post-traitement réussi:

- `lot-zone-join-run.ts --slugs sainte-barbe`: 1 559 lots, 99,68 % assignés, 93,05 % de match zone_code; vérification Parquet OK.
- `lots-enriched-run.ts --slugs sainte-barbe`: normes 92,75 %, surface 100 %, dépôt OK.

## Découverte et gates négatifs du passage

- `adstock`: PDF officiel/miroir confirmé; OCR Mistral 80 puis 285 pages = 0 zone; schema auto 116..147 = 0 zone. Aucun dépôt. Les tentatives antérieures relues indiquent aussi des codes schema non SIG (`overlap=0`); aucune reprise GPT.
- `batiscan`: `work/zonage-norms/batiscan/grille.pdf` commence par `<!DOCTYPE html>` (2 630 octets), donc faux PDF écarté.
- `bonsecours`: URL connue `municipalites-du-quebec.ca/bonsecours/custom/zonage.pdf`, téléchargement échoué; aucun octet utilisé.
- `brebeuf`: crawler 2-hop a trouvé un PDF HTTP 200, mais le classifieur l’a rejeté comme règlement sans en-tête de code de zone; pas de grille productible.
- `dundee`, `elgin`: découverte bornée interrompue sur `elgin` après absence de progression afin de rester sous 6 minutes/slug; aucun PDF de grille confirmé dans la sortie obtenue.
- `saint-edouard-de-lotbiniere`: règlement officiel HTTP 200/PDF; OCR 1..80 a lu 2 pseudo-codes (`*RAMPEPOURHANDICAPÉS*`, `4`), `overlap=0/34`, rejet anti-invention. Schema interrompu avant le plafond de 6 minutes sans résultat exploitable.
- `saint-francois-dassise`: règlement officiel du portail MRC Matapédia, fichier WPFD 24140 confirmé HTTP 200/PDF; OCR 1..80 = 0 zone. Schema transposé interrompu avant le plafond de 6 minutes, aucun dépôt.
- `saint-just-de-bretenieres`: grille officielle HTTP 200/PDF; OCR = 6 codes, `overlap=0/39`; schema auto pages 17..22 = 6 zones, 56,3 % champs, mais `overlap=0/39`; rejet strict.
- `saint-felix-de-dalquier`: R-285 officiel HTTP 200/PDF, 3 pages, classifié règlement et non-grille; OCR = 0 zone.
- `saint-rene`: PDF officiel trouvé et confirmé, mais classifié règlement sans grille; aucune extraction lancée.

Les autres cibles de la sélection (notamment `clerval`, `franquelin`, `gallichan`, `godbout`, `guerin`, `howick`, `la-trinite-des-monts`, `lac-frontiere`, `laval`, `nantes`, `pointe-a-la-croix`, `quebec`, `saint-adrien`, `saint-antonin`, `saint-cyprien--les-etchemins`, et les résiduelles suivantes) restent dans les 59 productibles. Les preuves Mistral déjà présentes dans les rapports de délégation ont été réutilisées pour éviter de payer deux fois les mêmes PDF; aucune grille sans preuve officielle n’a été inventée.

## État final

Un seul dépôt net dans cette passe: `sainte-barbe`. Les gates ont empêché les autres dépôts. Le manifeste a été réconcilié et les lots de Sainte-Barbe ont été enrichis. Un commit ciblé a été créé puis poussé (`1de8bce`, `origin/feat/cadre-acquisition`) uniquement pour ce rapport et les quatre seeds; les modifications concurrentes, dont `coverage-matrix.json`, `.claude` et `.track`, restent intactes. Le dépôt Parquet est publié côté registre.
